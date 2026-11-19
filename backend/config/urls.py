"""
URL configuration for config project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/5.2/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.conf import settings
from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path


def health_check(request):
    """Simple liveness response for Render and container health probes."""
    return JsonResponse({"status": "ok"})


def api_root(request):
    """Small index so opening the API version root does not return a 404. No anuncia la ruta del admin."""
    return JsonResponse({
        "version": "v1",
        "endpoints": {
            "csrf": "/api/v1/auth/csrf/",
            "login": "/api/v1/auth/login/",
        },
    })


# Panel de Django en /django-admin/ (la ruta /admin/ es de la app web). /admin/ en el backend ya no existe:
# responde "Acceso no autorizado." como cualquier ruta desconocida.
ADMIN_URL = "django-admin/"

# Ambas apps comparten el prefijo api/v1/; sus rutas no deben chocar entre si.
# "/" ya no responde: como cualquier ruta desconocida da "Acceso no autorizado.". El chequeo de salud de Render
# usa /healthz (render.yaml), que no devuelve datos.
urlpatterns = [
    path('healthz', health_check, name='health-check'),
    path(ADMIN_URL, admin.site.urls),
    path('api/', api_root, name='api-alias'),
    path('api/v1/', api_root, name='api-root'),
    path('api/v1/', include('users.urls')),
    path('api/v1/', include('questions.urls')),
]

# Debug Toolbar's middleware renders links in HTML responses, so its namespace
# must exist whenever development settings install the toolbar.
if settings.DEBUG and "debug_toolbar" in settings.INSTALLED_APPS:
    urlpatterns = [path("__debug__/", include("debug_toolbar.urls")), *urlpatterns]
