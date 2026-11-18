"""Doble autenticacion condicionada por dispositivo.

Un navegador que supero el codigo TOTP queda como dispositivo de confianza durante MFA_TRUST_DAYS
(cookie httpOnly por cuenta, ver devices.py). Cualquier otro navegador -computador nuevo, cookies
borradas o ventana privada, que no comparte cookies- debe volver a superar el segundo factor.
No se intenta detectar el modo incognito: se detecta la ausencia del dispositivo de confianza.
"""

from datetime import timedelta

from django.conf import settings
from django.core import signing
from django.utils import timezone

from . import totp
from .models import TrustedDevice, User

CHALLENGE_SALT = "users.mfa.challenge"
CHALLENGE_MAX_AGE = 5 * 60  # segundos para escribir el codigo tras la contrasena
MAX_FAILED_ATTEMPTS = 5
LOCK_MINUTES = 15


def trust_days() -> int:
    return int(getattr(settings, "MFA_TRUST_DAYS", 30))


def is_trusted(device) -> bool:
    """El dispositivo supero el segundo factor y su confianza no ha vencido."""
    return bool(
        device
        and device.mfa_verified_at
        and device.mfa_verified_at >= timezone.now() - timedelta(days=trust_days())
    )


def issue_challenge(user) -> dict:
    """Desafio firmado (sin estado) que prueba que la contrasena ya fue validada.

    Incluye el hash de sesion del usuario: si cambia la contrasena, los desafios pendientes dejan de valer.
    Si la cuenta aun no tiene 2FA, prepara (o reutiliza) un secreto pendiente para registrarlo en la app.
    """
    payload = {"mfa_required": True, "mfa_token": signing.dumps(
        {"uid": user.pk, "auth": user.get_session_auth_hash()}, salt=CHALLENGE_SALT,
    )}
    if not user.totp_enabled:
        if not user.totp_secret:
            user.totp_secret = totp.generate_secret()
            user.save(update_fields=["totp_secret"])
        payload["enrollment"] = {
            "secret": user.totp_secret,
            "otpauth_uri": totp.provisioning_uri(user.totp_secret, user.username),
        }
    return payload


def load_challenge(token):
    """Usuario del desafio, o None si es invalido, vencio o la contrasena cambio desde entonces."""
    try:
        data = signing.loads(token or "", salt=CHALLENGE_SALT, max_age=CHALLENGE_MAX_AGE)
    except signing.BadSignature:
        return None
    user = User.objects.filter(pk=data.get("uid"), is_active=True).first()
    if user is None or data.get("auth") != user.get_session_auth_hash():
        return None
    return user


def is_locked(user) -> bool:
    return bool(user.mfa_locked_until and user.mfa_locked_until > timezone.now())


def check_code(user, code) -> bool:
    """Valida el codigo TOTP; cuenta los fallos y bloquea temporalmente tras MAX_FAILED_ATTEMPTS."""
    step = totp.verify(user.totp_secret, code, last_step=user.totp_last_step)
    if step is None:
        user.mfa_failed_attempts += 1
        fields = ["mfa_failed_attempts"]
        if user.mfa_failed_attempts >= MAX_FAILED_ATTEMPTS:
            user.mfa_failed_attempts = 0
            user.mfa_locked_until = timezone.now() + timedelta(minutes=LOCK_MINUTES)
            fields.append("mfa_locked_until")
        user.save(update_fields=fields)
        return False
    user.totp_last_step = step
    user.totp_enabled = True
    user.mfa_failed_attempts = 0
    user.mfa_locked_until = None
    user.save(update_fields=["totp_last_step", "totp_enabled", "mfa_failed_attempts", "mfa_locked_until"])
    return True


def mark_verified(device) -> None:
    now = timezone.now()
    TrustedDevice.objects.filter(pk=device.pk).update(mfa_verified_at=now, last_seen=now)
    device.mfa_verified_at = now


def reset_mfa(user) -> None:
    """Reinicia el 2FA (celular perdido): el proximo login vuelve a mostrar el QR y se cierran sus sesiones."""
    user.totp_secret = ""
    user.totp_enabled = False
    user.totp_last_step = -1
    user.mfa_failed_attempts = 0
    user.mfa_locked_until = None
    user.save(update_fields=["totp_secret", "totp_enabled", "totp_last_step", "mfa_failed_attempts", "mfa_locked_until"])
    TrustedDevice.objects.filter(user=user, revoked=False).update(revoked=True)
