"""Respuesta única para accesos no autorizados (refuerza la capa 15, minimización de información).

Cualquier endpoint de cualquier módulo, con cualquier método (GET, POST, PUT, PATCH, DELETE…), responde el mismo
cuerpo cuando la petición no está autorizada, el método no existe, la ruta no existe o se excede el límite:

    {"detail": "Acceso no autorizado.", "code": "unauthorized_access"}

Así Postman, curl o un atacante no aprenden nada: ni qué métodos acepta una ruta (405 + cabecera Allow), ni si
falta la sesión o el permiso, ni si un recurso existe, ni si una cuenta existe o está bloqueada.

Reglas (todo el backend salvo /django-admin/ y /static/):
- OPTIONS directo: 405 genérico (no se describe el endpoint). El preflight CORS legítimo lo atiende CorsMiddleware.
- 401, 403, 404, 405, 406, 415 y 429: siempre el cuerpo genérico.
- 400 sin sesión: genérico. Con sesión se conserva el detalle (mensajes de formularios de la app).
- 5xx: "Error interno del servidor." sin trazas.
Se conserva el código HTTP: la app necesita el 401 para renovar la sesión. El motivo real queda en el log y en la
auditoría (common.security.log_unauthorized).
"""

from django.http import JsonResponse

from .navigation import is_document_navigation

UNAUTHORIZED_BODY = {"detail": "Acceso no autorizado.", "code": "unauthorized_access"}
SERVER_ERROR_BODY = {"detail": "Error interno del servidor.", "code": "server_error"}
GENERIC_STATUSES = {401, 403, 404, 405, 406, 415, 429}
# Fuera de la regla: el panel de Django (tiene su propio login y páginas) y los archivos estáticos.
UNPROTECTED_PREFIXES = ("/django-admin/", "/static/")
# Cabeceras que se conservan; Allow (métodos aceptados) y WWW-Authenticate (esquema) se descartan a propósito.
KEPT_HEADERS = ("Cache-Control", "Pragma", "Vary", "Retry-After")


def _has_session(request) -> bool:
    # DRF copia el usuario autenticado (JWT) al request de Django: aquí ya es el usuario de la API.
    user = getattr(request, "user", None)
    return bool(getattr(user, "is_authenticated", False))


class GenericApiErrorMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        # OPTIONS directo (Postman, curl): DRF describiría el endpoint (campos, métodos). Las verificaciones CORS
        # legítimas (preflight con Origin + Access-Control-Request-Method) las responde antes CorsMiddleware.
        if request.method == "OPTIONS" and not request.path.startswith(UNPROTECTED_PREFIXES):
            return self._generic(UNAUTHORIZED_BODY, 405)
        response = self.get_response(request)
        if request.path.startswith(UNPROTECTED_PREFIXES) or response.status_code < 400:
            return response
        if is_document_navigation(request):
            return response  # el navegador ya recibe la página HTML "Acceso no autorizado." (common/navigation.py)
        if response.status_code >= 500:
            body = SERVER_ERROR_BODY
        elif response.status_code in GENERIC_STATUSES or not _has_session(request):
            body = UNAUTHORIZED_BODY
        else:
            return response  # 400 de un usuario con sesión: el detalle es para la app
        generic = self._generic(body, response.status_code)
        for header in KEPT_HEADERS:
            if header in response:
                generic[header] = response[header]
        generic.cookies = response.cookies
        return generic

    @staticmethod
    def _generic(body, status_code):
        generic = JsonResponse(body, status=status_code)
        generic.data = dict(body)  # mismo contenido que el JSON; lo leen las pruebas como en una respuesta DRF
        generic["Cache-Control"] = "no-store"
        return generic
