"""Detección de entradas maliciosas (inyección SQL / scripts) y middleware de bloqueo.

El ORM de Django ya parametriza todas las consultas, así que esta capa es defensa en
profundidad: rechaza cargas útiles de ataque evidentes antes de que lleguen a las vistas
y deja constancia en el log de seguridad. Los patrones son deliberadamente estrechos para
no bloquear comentarios legítimos de las evaluaciones.
"""

import json
import logging
import re
from urllib.parse import unquote_plus

from django.http import JsonResponse

security_logger = logging.getLogger("django.security")

UNAUTHORIZED_MESSAGE = "Acceso no autorizado."
CONSOLE_MESSAGE = "Permiso no autorizado"

_FLAGS = re.IGNORECASE | re.DOTALL
_MALICIOUS_PATTERNS = [
    # Scripts / XSS
    r"<\s*/?\s*(script|iframe|object|embed|svg|img|body|style|link|meta)\b[^>]*",
    r"javascript\s*:",
    r"vbscript\s*:",
    r"data\s*:\s*text/html",
    r"\bon(error|load|click|mouseover|focus|submit)\s*=",
    # SQL injection
    r"['\"`)]\s*(or|and)\s+['\"`(]?\s*\w+\s*['\"`)]?\s*(=|like|>|<)\s*['\"`(]?\s*\w*",
    r"(?<![\w.])\d+\s+(or|and)\s+\d+\s*=\s*\d+",
    r"\bunion\b\s+(all\s+)?\bselect\b",
    r"\bselect\b[\s\S]{0,80}\bfrom\b[\s\S]{0,80}\b(information_schema|pg_catalog|sqlite_master|sys\.|users?|auth_user)",
    r";\s*(drop|alter|truncate|delete|insert|update|create|exec|shutdown)\b",
    r"\b(drop|truncate)\s+table\b",
    r"\b(sleep|pg_sleep|benchmark|waitfor\s+delay|load_file|xp_cmdshell)\s*\(",
    r"['\"]\s*;\s*--",
    r"'\s*(--|#|/\*)",
    r"\binformation_schema\b",
]
_MALICIOUS = [re.compile(p, _FLAGS) for p in _MALICIOUS_PATTERNS]


def looks_malicious(value) -> bool:
    """True si el texto contiene una carga útil típica de inyección SQL o de scripts."""
    if not isinstance(value, str) or not value:
        return False
    candidates = {value, unquote_plus(value)}
    return any(p.search(text) for text in candidates for p in _MALICIOUS)


def _iter_strings(node, depth=0):
    if depth > 8:
        return
    if isinstance(node, str):
        yield node
    elif isinstance(node, dict):
        for key, item in node.items():
            yield str(key)
            yield from _iter_strings(item, depth + 1)
    elif isinstance(node, (list, tuple)):
        for item in node:
            yield from _iter_strings(item, depth + 1)


def client_ip(request) -> str:
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
    return (forwarded.split(",")[0].strip() if forwarded else request.META.get("REMOTE_ADDR")) or "unknown"


def log_unauthorized(request, reason: str, **extra):
    """Escribe en el log del servidor (consola/stdout) el intento no autorizado y lo deja en la auditoría (capa 23)."""
    security_logger.warning(
        "%s | reason=%s ip=%s path=%s %s",
        CONSOLE_MESSAGE.upper(),
        reason,
        client_ip(request),
        request.path,
        " ".join(f"{k}={v}" for k, v in extra.items()),
    )
    from audit.logging import record_event

    record_event(action=f"security.{reason}", outcome="blocked", request=request, status_code=None,
                 metadata={k: str(v)[:100] for k, v in extra.items()} or None)


class NoStoreApiMiddleware:
    """Capa 22: las respuestas de /api/ (datos del personal y sus evaluaciones) no se guardan en ninguna caché.

    En un computador compartido de la clínica, el botón "atrás" o la caché del navegador mostrarían datos de la
    sesión anterior aunque ya se haya cerrado. `no-store` lo impide; también para proxies intermedios.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        if request.path.startswith("/api/"):
            response["Cache-Control"] = "no-store"
            response["Pragma"] = "no-cache"
        return response


class MaliciousInputMiddleware:
    """Bloquea con 403 las peticiones /api/ cuyo query string o cuerpo JSON contengan ataques evidentes."""

    MAX_BODY = 1_000_000

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.path.startswith("/api/") and self._is_attack(request):
            log_unauthorized(request, "malicious_input")
            return JsonResponse(
                {"detail": UNAUTHORIZED_MESSAGE, "code": "unauthorized_access"}, status=403
            )
        return self.get_response(request)

    def _is_attack(self, request) -> bool:
        if any(looks_malicious(v) for v in request.GET.values()):
            return True
        if request.method not in {"POST", "PUT", "PATCH"}:
            return False
        content_type = request.META.get("CONTENT_TYPE", "")
        if "json" not in content_type:
            return False
        try:
            if int(request.META.get("CONTENT_LENGTH") or 0) > self.MAX_BODY:
                return False
            payload = json.loads(request.body.decode("utf-8") or "null")
        except (ValueError, UnicodeDecodeError):
            return False
        # Las contraseñas pueden contener cualquier símbolo: no se inspeccionan como texto.
        if isinstance(payload, dict):
            payload = {k: v for k, v in payload.items() if "password" not in k.lower()}
        return any(looks_malicious(s) for s in _iter_strings(payload))
