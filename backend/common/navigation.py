"""Endpoints abiertos directamente en el navegador: primero se verifica la ventana (privada o normal).

Un JSON no puede ejecutar código, así que el servidor no puede saber si la pestaña es de incógnito.
Cuando el navegador NAVEGA a un endpoint (barra de direcciones, enlace), lo indica con las cabeceras
Fetch Metadata `Sec-Fetch-Dest: document` y `Sec-Fetch-Mode: navigate`. En ese caso se devuelve una
página intermedia que corre el detector de ventanas privadas (static/security/private-window.js):
en una ventana normal pide el contenido real con fetch y lo muestra; en una privada no lo pide.

Las peticiones de la app (fetch del frontend), el health check de Render y cualquier cliente que no
navegue (curl, scripts) no envían esas cabeceras y reciben la respuesta de siempre. Navegadores sin
Fetch Metadata también la reciben: ante la duda no se bloquea.
"""

from django.shortcuts import render
from django.utils.cache import patch_vary_headers

# El login del admin ya trae su propio bloqueo; los estáticos y el media no son endpoints.
EXCLUDED_PREFIXES = ("/admin/", "/static/", "/media/", "/__debug__/")


def is_document_navigation(request) -> bool:
    return (
        request.method in ("GET", "HEAD")
        and request.headers.get("Sec-Fetch-Dest") == "document"
        and request.headers.get("Sec-Fetch-Mode") == "navigate"
        and not request.path.startswith(EXCLUDED_PREFIXES)
    )


def has_admin_session(request) -> bool:
    """Sesión iniciada en el panel /admin/ (cuenta activa con acceso al admin de Django)."""
    user = getattr(request, "user", None)
    return bool(user and user.is_authenticated and user.is_active and user.is_staff)


class PrivateWindowGateMiddleware:
    """Navegaciones directas a los endpoints: solo desde una sesión del panel /admin/ (capa 17).

    Sin sesión de administración responde 403 "Acceso no autorizado" y lo deja en la auditoría. Con ella, la
    página intermedia verifica la ventana (privada o normal) y luego muestra el contenido.
    La app y los clientes que no navegan no pasan por aquí: su acceso lo controla la autenticación de la API.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if not is_document_navigation(request):
            return self.get_response(request)
        if has_admin_session(request):
            response = render(request, "security/api_gate.html")
        else:
            from .security import log_unauthorized

            log_unauthorized(request, "direct_navigation")
            response = render(request, "security/unauthorized.html", status=403)
        response["Cache-Control"] = "no-store"
        response["X-Robots-Tag"] = "noindex"
        # La misma URL responde distinto a una navegación y a un fetch (y según la sesión del admin).
        patch_vary_headers(response, ("Sec-Fetch-Dest", "Sec-Fetch-Mode", "Cookie"))
        return response
