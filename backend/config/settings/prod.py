"""
Settings de producción.

Endurece la seguridad y desactiva DEBUG. Las variables sensibles deben venir
exclusivamente de variables de entorno.
"""
from django.core.exceptions import ImproperlyConfigured
import os

from .base import *  # noqa: F401,F403

DEBUG = False

# Validacion secret
# La longitud mínima (50, recomendación de Django: ver check security.W009)
# importa en la práctica: SIMPLE_JWT usa SECRET_KEY como clave de firma HS256
# por defecto, y PyJWT emite InsecureKeyLengthWarning con claves debajo de 32
# bytes. `SECRET_KEY` viene de `from .base import *` de arriba.
if (  # noqa: F405
    not SECRET_KEY  # noqa: F405
    or SECRET_KEY == "insecure-default-change-me"  # noqa: F405
    or len(SECRET_KEY) < 50  # noqa: F405
):
    raise ImproperlyConfigured

# SECURE_PROXY_SSL_HEADER confia en X-Forwarded-Proto: solo es seguro detras de un proxy (nginx) que lo fije.
# Seguridad
SECURE_SSL_REDIRECT = True
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
AUTH_COOKIE_SECURE = True
# Vercel and Render use different sites, so browsers require cross-site auth
# cookies. Secure is already forced above for this production settings module.
AUTH_COOKIE_SAMESITE = os.getenv("AUTH_COOKIE_SAMESITE", "None")
CSRF_COOKIE_SAMESITE = AUTH_COOKIE_SAMESITE
SESSION_COOKIE_SAMESITE = AUTH_COOKIE_SAMESITE
# No asumir el hostname `redis` de Docker en Render. Si hay un Redis/Key Value
# enlazado, Render entrega REDIS_URL; sin él, Channels usa memoria y no bloquea
# las solicitudes HTTP ni genera errores de DNS al cerrar conexiones WebSocket.
_render_redis_url = os.getenv("REDIS_URL")
if _render_redis_url:
    CHANNEL_LAYERS = {
        "default": {
            "BACKEND": "channels_redis.core.RedisChannelLayer",
            "CONFIG": {"hosts": [_render_redis_url]},
        }
    }
else:
    CHANNEL_LAYERS = {
        "default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}
    }
# Render proxies las solicitudes y Django recibe REMOTE_ADDR como 127.0.0.1.
# Axes debe usar la IP del cliente que Render reenvía en X-Forwarded-For para
# que el bloqueo por (usuario, IP) no sea compartido entre visitantes.
AXES_IPWARE_META_PRECEDENCE_ORDER = ("HTTP_X_FORWARDED_FOR", "REMOTE_ADDR")
SECURE_HSTS_SECONDS = 60 * 60 * 24 * 30  # 30 días
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = "DENY"
