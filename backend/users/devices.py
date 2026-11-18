"""Registro y validacion de dispositivos de confianza ligados a la sesion."""

import hashlib
import secrets

from django.conf import settings
from django.utils import timezone

from .models import TrustedDevice

DEVICE_COOKIE_NAME = "device_id"
DEVICE_CLAIM = "did"
MAX_ACTIVE_DEVICES = 5
DEVICE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365


def _hash(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def _client_ip(request) -> str:
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
    return (forwarded.split(",")[0].strip() if forwarded else request.META.get("REMOTE_ADDR", ""))[:64]


def find_device(request, user_id, device_id=None):
    """Dispositivo activo que corresponde a la cookie de la peticion (o None)."""
    raw = request.COOKIES.get(DEVICE_COOKIE_NAME)
    if not raw:
        return None
    qs = TrustedDevice.objects.filter(token_hash=_hash(raw), user_id=user_id, revoked=False)
    if device_id is not None:
        qs = qs.filter(pk=device_id)
    return qs.first()


def register_device(request, user):
    """Reutiliza el dispositivo conocido del usuario o registra uno nuevo.

    Devuelve (device, raw_token); raw_token solo viene cuando hay que (re)emitir la cookie.
    Los usuarios registrados nunca se bloquean por estrenar dispositivo: se registra y listo.
    """
    device = find_device(request, user.pk)
    if device:
        TrustedDevice.objects.filter(pk=device.pk).update(last_seen=timezone.now())
        return device, None
    raw = secrets.token_urlsafe(32)
    active = list(TrustedDevice.objects.filter(user=user, revoked=False).order_by("last_seen"))
    for old in active[: max(0, len(active) - (MAX_ACTIVE_DEVICES - 1))]:
        old.revoked = True
        old.save(update_fields=["revoked"])
    device = TrustedDevice.objects.create(
        user=user,
        token_hash=_hash(raw),
        user_agent=request.META.get("HTTP_USER_AGENT", "")[:300],
        ip_address=_client_ip(request),
    )
    return device, raw


def has_active_session_elsewhere(request, user):
    """True si el usuario tiene una sesion abierta en OTRO navegador/dispositivo.

    Una sesion cuenta como activa si no se cerro (session_jti) y tuvo actividad (login/refresh)
    dentro de la vida del access token: el frontend renueva al menos con esa frecuencia mientras
    se usa, asi que una ventana cerrada sin "Cerrar sesion" deja de bloquear pasado ese tiempo.
    """
    cutoff = timezone.now() - settings.SIMPLE_JWT["ACCESS_TOKEN_LIFETIME"]
    active = TrustedDevice.objects.filter(user=user, revoked=False, last_seen__gte=cutoff).exclude(session_jti="")
    current = find_device(request, user.pk)
    if current:
        active = active.exclude(pk=current.pk)
    return active.exists()


def open_session(device, refresh):
    """Marca la sesion (refresh token) como abierta en el dispositivo y renueva su actividad."""
    TrustedDevice.objects.filter(pk=device.pk).update(session_jti=refresh["jti"], last_seen=timezone.now())


def close_session(request, refresh):
    """Cierra la sesion del dispositivo dueño del refresh token (solo si la peticion trae su cookie)."""
    claimed = refresh.get(DEVICE_CLAIM)
    if claimed is None:
        return
    device = find_device(request, refresh.get("user_id"), claimed)
    if device:
        TrustedDevice.objects.filter(pk=device.pk).update(session_jti="")


def set_device_cookie(response, raw):
    if raw:
        response.set_cookie(
            DEVICE_COOKIE_NAME,
            raw,
            max_age=DEVICE_COOKIE_MAX_AGE,
            httponly=True,
            secure=settings.AUTH_COOKIE_SECURE,
            samesite=settings.AUTH_COOKIE_SAMESITE,
            path="/",
        )
