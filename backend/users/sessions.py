"""Capa 21: revocación de sesiones cuando cambia la contraseña.

Cambiar la clave porque alguien más la conoce no sirve si esa persona ya tiene una sesión abierta. Al cambiarla:
- todos los refresh tokens de la cuenta pasan a la lista negra (no se pueden renovar), y
- todos los dispositivos de confianza se revocan; como cada access token está ligado a su dispositivo
  (common.authentication.enforce_device), las sesiones abiertas en otros equipos dejan de valer de inmediato.
El dispositivo desde el que el propio usuario cambia su clave se conserva (`keep_device_id`) y se le emiten
cookies nuevas, para no sacarlo de la app.
"""

from rest_framework_simplejwt.token_blacklist.models import (
    BlacklistedToken,
    OutstandingToken,
)

from .models import TrustedDevice


def revoke_all_sessions(user, keep_device_id=None) -> int:
    """Revoca las sesiones de `user` salvo el dispositivo `keep_device_id`. Devuelve cuántos dispositivos revocó."""
    pending = OutstandingToken.objects.filter(user=user).exclude(blacklistedtoken__isnull=False)
    BlacklistedToken.objects.bulk_create([BlacklistedToken(token=token) for token in pending], ignore_conflicts=True)
    devices = TrustedDevice.objects.filter(user=user, revoked=False)
    if keep_device_id is not None:
        devices = devices.exclude(pk=keep_device_id)
    return devices.update(revoked=True)
