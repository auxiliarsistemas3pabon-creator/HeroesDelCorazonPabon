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
