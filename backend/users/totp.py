"""TOTP (RFC 6238) con la libreria estandar: codigos de 6 digitos cada 30 s, compatibles con
Google Authenticator, Microsoft Authenticator y similares."""

import base64
import hashlib
import hmac
import secrets
import struct
import time
from urllib.parse import quote, urlencode

DIGITS = 6
PERIOD = 30
# Tolerancia de reloj: se acepta el codigo anterior y el siguiente (+-30 s).
VALID_WINDOW = 1
ISSUER = "Heroes del Corazon"


def generate_secret() -> str:
    """Secreto aleatorio de 160 bits en base32 (sin relleno), el formato que esperan las apps."""
    return base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")


def _code_at(secret: str, step: int) -> str:
    key = base64.b32decode(secret + "=" * (-len(secret) % 8), casefold=True)
    digest = hmac.new(key, struct.pack(">Q", step), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    value = struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF
    return str(value % 10**DIGITS).zfill(DIGITS)


def current_step(now: float | None = None) -> int:
    return int((time.time() if now is None else now) // PERIOD)


def code_for(secret: str, now: float | None = None) -> str:
    return _code_at(secret, current_step(now))


def verify(secret: str, code: str, last_step: int = -1, now: float | None = None) -> int | None:
    """Devuelve el paso de tiempo del codigo si es valido y posterior a `last_step` (anti-reutilizacion)."""
    code = (code or "").strip().replace(" ", "")
    if not secret or len(code) != DIGITS or not code.isdigit():
        return None
    step = current_step(now)
    for candidate in range(step - VALID_WINDOW, step + VALID_WINDOW + 1):
        if candidate > last_step and hmac.compare_digest(_code_at(secret, candidate), code):
            return candidate
    return None


def provisioning_uri(secret: str, account: str) -> str:
    """URI otpauth:// que se muestra como QR para registrar la cuenta en la app."""
    label = quote(f"{ISSUER}:{account}")
    query = urlencode({"secret": secret, "issuer": ISSUER, "digits": DIGITS, "period": PERIOD})
    return f"otpauth://totp/{label}?{query}"
