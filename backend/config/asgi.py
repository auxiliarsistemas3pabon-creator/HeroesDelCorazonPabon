"""ASGI entry point for HTTP and authenticated realtime events."""
import os

from channels.routing import ProtocolTypeRouter, URLRouter
from channels.security.websocket import OriginValidator
from django.conf import settings
from django.core.asgi import get_asgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.dev')

django_application = get_asgi_application()

from realtime.auth import JwtCookieAuthMiddleware
from realtime.routing import websocket_urlpatterns

application = ProtocolTypeRouter({
    "http": django_application,
    # Cross-origin frontend deployments (Vercel -> Render) are allowlisted by
    # CORS_ALLOWED_ORIGINS, rather than requiring the frontend host in ALLOWED_HOSTS.
    "websocket": OriginValidator(
        JwtCookieAuthMiddleware(URLRouter(websocket_urlpatterns)),
        settings.CORS_ALLOWED_ORIGINS,
    ),
})
