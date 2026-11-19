from django.conf import settings
from django.middleware.csrf import CsrfViewMiddleware
from rest_framework import exceptions
from rest_framework_simplejwt.authentication import JWTAuthentication


def enforce_csrf(request):
    """Validates the CSRF token (double cookie) on cookie-authenticated requests."""
    check = CsrfViewMiddleware(lambda r: None)
    check.process_request(request)
    reason = check.process_view(request, None, (), {})
    if reason:
        raise exceptions.PermissionDenied(f"CSRF Failed: {reason}")


def enforce_device(request, validated_token):
    """La sesion con claim de dispositivo solo es valida desde ese dispositivo registrado."""
    from users.devices import DEVICE_CLAIM, find_device

    claimed = validated_token.get(DEVICE_CLAIM)
    if claimed is None:  # sesiones anteriores a esta version: se ligan al renovarlas
        return
    if find_device(request, validated_token.get("user_id"), claimed) is None:
        raise exceptions.AuthenticationFailed("Device not recognized.")


# Con clave inicial (password_change_required) solo se permiten estas rutas (nombres de URL de users/urls.py).
PASSWORD_CHANGE_ALLOWED = {"me", "password-change", "logout", "csrf-token"}


class PasswordChangeRequired(exceptions.PermissionDenied):
    default_detail = "Debes cambiar tu contraseña inicial antes de continuar."
    default_code = "password_change_required"


def enforce_password_change(request, user):
    """Una cuenta con la clave inicial (conocida por todos) no puede usar la app hasta cambiarla."""
    if not getattr(user, "password_change_required", False):
        return
    match = getattr(request, "resolver_match", None)
    if match is None or match.url_name not in PASSWORD_CHANGE_ALLOWED:
        raise PasswordChangeRequired()


# CSRF solo se valida en la rama de cookie; con header Authorization el navegador no adjunta credenciales solo.
class CookieJWTAuthentication(JWTAuthentication):
    """Accepts the Authorization header and, if missing, the access token from an httpOnly cookie."""

    def authenticate(self, request):
        if self.get_header(request) is not None:
            result = super().authenticate(request)
            if result is not None:
                enforce_device(request, result[1])
                enforce_password_change(request, result[0])
            return result

        raw_token = request.COOKIES.get(settings.AUTH_COOKIE_ACCESS_NAME)
        if not raw_token:  # ausente o vacia (cookie borrada): sin sesion
            return None

        validated_token = self.get_validated_token(raw_token)
        enforce_csrf(request)
        enforce_device(request, validated_token)
        user = self.get_user(validated_token)
        enforce_password_change(request, user)
        return user, validated_token
