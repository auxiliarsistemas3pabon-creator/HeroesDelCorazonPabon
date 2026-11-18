"""Vistas de autenticación, cuentas y directorios de usuarios para /api/v1/."""


from axes.utils import reset as reset_login_attempts
from django.conf import settings
from django.contrib.auth import authenticate
from django.contrib.auth.backends import ModelBackend
from django.core.exceptions import PermissionDenied
from django.db import transaction
from django.middleware.csrf import get_token
from django.utils.translation import gettext as _
from rest_framework import generics, status
from rest_framework.parsers import MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken

from audit.mixins import AuditLogMixin
from common.permissions import IsBossOrSuperAdmin, IsSuperAdmin
from common.security import UNAUTHORIZED_MESSAGE, log_unauthorized, looks_malicious

from . import mfa
from .areas import is_removed_area
from .devices import DEVICE_CLAIM, find_device, register_device, set_device_cookie
from .models import User
from .serializers import (
    AdminUserSerializer,
    AuthenticatedUserSerializer,
    LoginSerializer,
    PasswordChangeSerializer,
    RegisterSerializer,
    UserSerializer,
)
from .staff_import import StaffFileError, import_staff

# La cookie de refresh solo viaja a /api/v1/auth/*, reduciendo su exposicion al resto de la API.
REFRESH_COOKIE_PATH = "/api/v1/auth/"


def _set_auth_cookies(response, refresh: RefreshToken):
    """Escribe access y refresh como cookies httpOnly; el JS del frontend nunca ve los tokens."""
    common = {
        "httponly": True,
        "secure": settings.AUTH_COOKIE_SECURE,
        "samesite": settings.AUTH_COOKIE_SAMESITE,
    }
    response.set_cookie(
        settings.AUTH_COOKIE_ACCESS_NAME,
        str(refresh.access_token),
        max_age=int(settings.SIMPLE_JWT["ACCESS_TOKEN_LIFETIME"].total_seconds()),
        **common,
    )
    response.set_cookie(
        settings.AUTH_COOKIE_REFRESH_NAME,
        str(refresh),
        max_age=int(settings.SIMPLE_JWT["REFRESH_TOKEN_LIFETIME"].total_seconds()),
        path=REFRESH_COOKIE_PATH,
        **common,
    )


def _start_session(request, user, device, raw_device):
    """Emite las cookies JWT ligadas al dispositivo (solo tras contrasena + dispositivo de confianza o 2FA)."""
    get_token(request)  # forces the csrftoken cookie for the frontend
    response = Response(AuthenticatedUserSerializer(user).data)
    refresh = RefreshToken.for_user(user)
    refresh[DEVICE_CLAIM] = device.pk
    _set_auth_cookies(response, refresh)
    set_device_cookie(response, raw_device, user.pk)
    return response


def _clear_auth_cookies(response):
    """Borra las cookies de sesion; el path debe coincidir con el usado al crearlas o el navegador no las elimina."""
    response.delete_cookie(settings.AUTH_COOKIE_ACCESS_NAME)
    response.delete_cookie(settings.AUTH_COOKIE_REFRESH_NAME, path=REFRESH_COOKIE_PATH)


class LoginView(AuditLogMixin, APIView):
    """POST /auth/login/: autentica con username y contraseña y emite cookies JWT httpOnly.

    Es pública, limitada por tasa y protegida contra intentos repetidos por django-axes.
    No incluye los tokens en el cuerpo de respuesta; registra el resultado sin registrar credenciales.
    """
    authentication_classes: list = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"

    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        if not serializer.is_valid():
            log_unauthorized(request, "invalid_login_payload")
            return Response(
                {"detail": UNAUTHORIZED_MESSAGE, "code": "unauthorized_access"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        credentials = serializer.validated_data
        username = credentials["username"]
        password = credentials["password"]

        if looks_malicious(username):
            log_unauthorized(request, "malicious_username")
            return Response(
                {"detail": UNAUTHORIZED_MESSAGE, "code": "unauthorized_access"},
                status=status.HTTP_403_FORBIDDEN,
            )

        # Axes locks a username/IP pair after repeated failures. Check a valid
        # password against Django's normal backend first so a stale lockout
        # cannot reject the account owner; invalid credentials still pass
        # through Axes below and continue to count toward brute-force limits.
        # Un usuario inexistente no necesita la primera verificacion (evita un hash de clave extra).
        registered = User.objects.filter(username=username).exists()
        user = None
        if registered:
            candidate = ModelBackend().authenticate(request=request, username=username, password=password)
            if candidate is not None and candidate.is_active:
                reset_login_attempts(username=candidate.username)
                user = candidate
        try:
            if user is None:
                user = authenticate(request=request, username=username, password=password)
        except PermissionDenied:  # django-axes: account temporarily locked
            log_unauthorized(request, "locked_out")
            return Response(
                {"detail": _("Too many failed attempts. Try again later.")},
                status=status.HTTP_403_FORBIDDEN,
            )
        if user is None or not user.is_active:
            log_unauthorized(request, "wrong_password" if registered else "unknown_user")
            if not registered:
                return Response(
                    {"detail": _("User not found."), "code": "user_not_found"},
                    status=status.HTTP_401_UNAUTHORIZED,
                )
            return Response(
                {"detail": UNAUTHORIZED_MESSAGE, "code": "unauthorized_access"},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        # Contrasena correcta. Navegador de confianza (2FA superado hace menos de MFA_TRUST_DAYS): entra.
        # Cualquier otro (computador nuevo, cookies borradas, ventana privada): se pide el codigo TOTP
        # y NO se emite ninguna sesion hasta validarlo en /auth/mfa/verify/.
        device = find_device(request, user.pk)
        if not mfa.is_trusted(device):
            return Response(mfa.issue_challenge(user))
        device, raw_device = register_device(request, user)
        return _start_session(request, user, device, raw_device)


class MfaVerifyView(AuditLogMixin, APIView):
    """POST /auth/mfa/verify/: segundo paso del login. Valida el codigo TOTP del desafio y abre la sesion.

    El navegador queda como dispositivo de confianza durante MFA_TRUST_DAYS.
    """
    authentication_classes: list = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"

    def post(self, request):
        user = mfa.load_challenge(request.data.get("mfa_token"))
        if user is None:
            log_unauthorized(request, "mfa_challenge_invalid")
            return Response({"detail": _("Verification expired. Sign in again."), "code": "mfa_expired"},
                            status=status.HTTP_401_UNAUTHORIZED)
        if mfa.is_locked(user):
            log_unauthorized(request, "mfa_locked")
            return Response({"detail": _("Too many failed attempts. Try again later."), "code": "mfa_locked"},
                            status=status.HTTP_403_FORBIDDEN)
        if not mfa.check_code(user, request.data.get("code")):
            log_unauthorized(request, "mfa_invalid_code")
            return Response({"detail": _("Invalid verification code."), "code": "mfa_invalid"},
                            status=status.HTTP_401_UNAUTHORIZED)
        device, raw_device = register_device(request, user)
        mfa.mark_verified(device)
        return _start_session(request, user, device, raw_device)


class CsrfTokenView(APIView):
    """Provides the CSRF token to credentialed frontends on a separate origin."""
    authentication_classes: list = []
    permission_classes = [AllowAny]

    def get(self, request):
        return Response({"csrfToken": get_token(request)})


class RefreshView(AuditLogMixin, APIView):
    """POST /auth/refresh/: invalida el refresh token anterior y emite cookies JWT nuevas."""
    authentication_classes: list = []
    permission_classes = [AllowAny]

    def post(self, request):
        raw = request.COOKIES.get(settings.AUTH_COOKIE_REFRESH_NAME)
        if not raw:
            return Response({"detail": _("No active session.")}, status=status.HTTP_401_UNAUTHORIZED)
        try:
            old = RefreshToken(raw)
            user = User.objects.get(pk=old["user_id"], is_active=True)
            # La sesion solo se renueva desde su mismo navegador y mientras siga siendo de confianza (2FA vigente).
            # Las sesiones sin dispositivo (anteriores al 2FA) no se renuevan: obligan a entrar con codigo.
            claimed_device = old.get(DEVICE_CLAIM)
            device = find_device(request, user.pk, claimed_device) if claimed_device is not None else None
            if not mfa.is_trusted(device):
                log_unauthorized(request, "device_mismatch")
                response = Response({"detail": _("Session expired.")}, status=status.HTTP_401_UNAUTHORIZED)
                _clear_auth_cookies(response)
                return response
            old.blacklist()
        except (TokenError, User.DoesNotExist):
            return Response({"detail": _("Session expired.")}, status=status.HTTP_401_UNAUTHORIZED)

        device, raw_device = register_device(request, user)
        response = Response({"detail": "ok"})
        new_refresh = RefreshToken.for_user(user)
        new_refresh[DEVICE_CLAIM] = device.pk
        _set_auth_cookies(response, new_refresh)
        set_device_cookie(response, raw_device, user.pk)
        return response


class LogoutView(AuditLogMixin, APIView):
    """POST /auth/logout/: invalida el refresh token si existe y elimina las cookies de sesión."""
    authentication_classes: list = []
    permission_classes = [AllowAny]

    def post(self, request):
        raw = request.COOKIES.get(settings.AUTH_COOKIE_REFRESH_NAME)
        if raw:
            try:
                RefreshToken(raw).blacklist()
            except TokenError:
                pass
        response = Response(status=status.HTTP_204_NO_CONTENT)
        _clear_auth_cookies(response)
        return response


class MeView(AuditLogMixin, APIView):
    """GET /auth/me/: devuelve el usuario de sesión, o null si no hay sesión."""

    permission_classes = [AllowAny]

    def get(self, request):
        get_token(request)
        if not request.user.is_authenticated:
            return Response(None)
        return Response(AuthenticatedUserSerializer(request.user).data)


class RegisterView(AuditLogMixin, generics.CreateAPIView):
    """POST /users/register/: permite que un superadmin cree una cuenta colaboradora."""

    serializer_class = RegisterSerializer
    permission_classes = [IsSuperAdmin]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"


class AdminUsersView(AuditLogMixin, APIView):
    """Lista usuarios y permite actualizar rol o restablecer contraseña."""
    permission_classes = [IsSuperAdmin]

    def get(self, request):
        users = User.objects.all().order_by("username")
        return Response(AdminUserSerializer(users, many=True).data)

    def patch(self, request, user_id):
        try:
            user = User.objects.get(pk=user_id)
        except User.DoesNotExist:
            return Response({"detail": _("User not found.")}, status=status.HTTP_404_NOT_FOUND)
        if "role" in request.data:
            role = request.data["role"]
            if role not in User.Role.values:
                return Response({"role": [_ ("Select a valid role.")]}, status=status.HTTP_400_BAD_REQUEST)
        if user.pk == request.user.pk and "role" in request.data and request.data["role"] != User.Role.SUPERADMIN:
            return Response({"detail": _("You cannot remove your own superadmin role.")}, status=status.HTTP_400_BAD_REQUEST)
        active = request.data.get("is_active", user.is_active)
        if "is_active" in request.data and not isinstance(active, bool):
            return Response({"is_active": [_ ("Expected a boolean value.")]}, status=status.HTTP_400_BAD_REQUEST)
        if "is_active" in request.data and active:
            return Response({"detail": _("This action only disables accounts.")}, status=status.HTTP_400_BAD_REQUEST)
        if user.pk == request.user.pk and not active:
            return Response({"detail": _("You cannot disable your own account.")}, status=status.HTTP_400_BAD_REQUEST)
        next_role = request.data.get("role", user.role)
        if user.role == User.Role.SUPERADMIN and user.is_active and (next_role != User.Role.SUPERADMIN or not active):
            other_active_admins = User.objects.filter(role=User.Role.SUPERADMIN, is_active=True).exclude(pk=user.pk).exists()
            if not other_active_admins:
                return Response({"detail": _("At least one active superadmin account must remain.")}, status=status.HTTP_400_BAD_REQUEST)
        user.role = next_role
        if "new_password" in request.data:
            serializer = PasswordChangeSerializer(data={"new_password": request.data["new_password"]}, context={"target_user": user})
            serializer.is_valid(raise_exception=True)
            user.set_password(serializer.validated_data["new_password"])
            user.password_change_required = False
            reset_login_attempts(username=user.username)
        if "is_active" in request.data:
            user.is_active = active
        user.save()
        return Response(AdminUserSerializer(user).data)


class ResetMfaView(AuditLogMixin, APIView):
    """POST /users/admin/<id>/reset-mfa/: reinicia el 2FA de una cuenta (p. ej. celular perdido).

    Sus sesiones se cierran y el proximo inicio de sesion vuelve a mostrar el QR para registrar la app.
    """
    permission_classes = [IsSuperAdmin]

    def post(self, request, user_id):
        user = User.objects.filter(pk=user_id).first()
        if user is None:
            return Response({"detail": _("User not found.")}, status=status.HTTP_404_NOT_FOUND)
        mfa.reset_mfa(user)
        return Response(AdminUserSerializer(user).data)


class StaffImportView(AuditLogMixin, APIView):
    """POST /users/import/: superadmin importa personal desde Excel dentro de una transacción.

    Los documentos existentes se omiten; errores de formato se devuelven como HTTP 400.
    """

    permission_classes = [IsSuperAdmin]
    parser_classes = [MultiPartParser]

    def post(self, request):
        file = request.FILES.get("file")
        if file is None:
            return Response({"detail": _("Attach an Excel file (.xlsx).")}, status=status.HTTP_400_BAD_REQUEST)
        try:
            with transaction.atomic():
                result = import_staff(file)
        except StaffFileError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(result)


class AreasView(AuditLogMixin, APIView):
    """GET /users/areas/: lista áreas activas para sugerencias del formulario de registro."""

    authentication_classes: list = []
    permission_classes = [AllowAny]

    def get(self, request):
        areas = (
            User.objects.filter(role__in=[User.Role.COLLABORATOR, User.Role.PERSONAL], is_active=True)
            .exclude(area="")
            .order_by("area")
            .values_list("area", flat=True)
            .distinct()
        )
        return Response([area for area in areas if not is_removed_area(area)])


class StaffCandidatesView(AuditLogMixin, APIView):
    """GET /users/staff-candidates/: jefe o superadmin consulta personas activas que pueden evaluarse."""

    permission_classes = [IsBossOrSuperAdmin]

    def get(self, request):
        staff = (
            User.objects.filter(
                role__in=[User.Role.COLLABORATOR, User.Role.PERSONAL],
                is_active=True,
            )
            .exclude(area="")
            .order_by("first_name", "last_name", "id")
            .values("id", "first_name", "last_name", "area")
        )
        return Response([person for person in staff if not is_removed_area(person["area"])])


class EvaluatorsView(AuditLogMixin, APIView):
    """GET /users/evaluators/: jefe o superadmin consulta colaboradores activos para programar evaluadores."""

    permission_classes = [IsBossOrSuperAdmin]

    def get(self, request):
        evaluators = (
            User.objects.filter(role=User.Role.COLLABORATOR, is_active=True)
            .exclude(area="")
            .order_by("first_name", "last_name", "id")
            .values("id", "first_name", "last_name", "area")
        )
        return Response([person for person in evaluators if not is_removed_area(person["area"])])


class CollaboratorsView(generics.ListAPIView):
    """GET /users/collaborators/: lista compañeros activos de la misma área, excluyendo al usuario actual."""

    serializer_class = UserSerializer
    pagination_class = None

    def get_queryset(self):
        user = self.request.user
        # Sin area asignada no se lista a nadie, para no exponer colaboradores de otras areas.
        qs = User.objects.filter(role__in=[User.Role.COLLABORATOR, User.Role.PERSONAL], is_active=True).exclude(pk=user.pk)
        return qs.filter(area=user.area) if user.area else qs.none()
