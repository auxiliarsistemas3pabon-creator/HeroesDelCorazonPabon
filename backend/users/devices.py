"""Dispositivo fijo: cada cuenta queda ligada a un unico navegador registrado.

El primer navegador donde el usuario inicia sesion queda como su dispositivo. Cualquier otro
navegador (incluidas las ventanas privadas/incognito, que nunca conservan la cookie) se rechaza
hasta que un superadmin libere el dispositivo.
"""

import hashlib
import secrets

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from .models import TrustedDevice, User

DEVICE_COOKIE_NAME = "device_id"
DEVICE_CLAIM = "did"
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


class DeviceNotAllowed(Exception):
    """La cuenta ya esta ligada a otro navegador."""


def register_device(request, user):
    """Reutiliza el dispositivo del usuario o, si aun no tiene ninguno, registra este navegador.

    Devuelve (device, raw_token); raw_token solo viene cuando hay que emitir la cookie.
    Lanza DeviceNotAllowed si la cuenta ya tiene un dispositivo activo distinto a este navegador.
    """
    device = find_device(request, user.pk)
    if device:
        TrustedDevice.objects.filter(pk=device.pk).update(last_seen=timezone.now())
        return device, None
    with transaction.atomic():
        # Bloquea la fila del usuario: dos primeros logins simultaneos no pueden registrar dos dispositivos.
        User.objects.select_for_update().filter(pk=user.pk).first()
        if TrustedDevice.objects.filter(user=user, revoked=False).exists():
            raise DeviceNotAllowed
        raw = secrets.token_urlsafe(32)
        device = TrustedDevice.objects.create(
            user=user,
            token_hash=_hash(raw),
            user_agent=request.META.get("HTTP_USER_AGENT", "")[:300],
            ip_address=_client_ip(request),
        )
    return device, raw


def has_device(user) -> bool:
    return TrustedDevice.objects.filter(user=user, revoked=False).exists()


def release_devices(user) -> int:
    """Libera la cuenta: revoca su dispositivo (su sesion actual deja de valer) y el proximo login registra uno nuevo."""
    return TrustedDevice.objects.filter(user=user, revoked=False).update(revoked=True)


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
