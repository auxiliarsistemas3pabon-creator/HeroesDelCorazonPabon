"""Respuesta única "Acceso no autorizado." en cualquier endpoint y método (common/exceptions.py)."""

from rest_framework.test import APITestCase

from common.testing import username_for

from .models import User
from .tests import create_user

GENERIC = {"detail": "Acceso no autorizado.", "code": "unauthorized_access"}
METHODS = ("get", "post", "put", "patch", "delete")
# Al menos un endpoint de cada módulo: auth, users, questions (configuración, respuestas, reportes, cargas).
ENDPOINTS = (
    "/api/v1/auth/login/",
    "/api/v1/auth/refresh/",
    "/api/v1/auth/password-change/",
    "/api/v1/users/admin/",
    "/api/v1/users/admin/1/",
    "/api/v1/users/register/",
    "/api/v1/users/import/",
    "/api/v1/questions/",
    "/api/v1/questions/evaluations/",
    "/api/v1/questions/evaluations/1/",
    "/api/v1/questions/results-summary/",
    "/api/v1/questions/answers/import/",
    "/api/v1/questions/settings/",
)


class UniformUnauthorizedResponseTests(APITestCase):
    def assertGeneric(self, response, label):
        self.assertGreaterEqual(response.status_code, 400, label)
        self.assertEqual(response.json(), GENERIC, label)
        self.assertNotIn("Allow", response, label)  # no revela qué métodos acepta la ruta
        self.assertNotIn("WWW-Authenticate", response, label)

    def test_every_method_on_every_module_without_session(self):
        for path in ENDPOINTS:
            for method in METHODS:
                with self.subTest(method=method.upper(), path=path):
                    response = getattr(self.client, method)(path, {}, format="json")
                    self.assertGeneric(response, f"{method.upper()} {path}")

    def test_unknown_routes_and_methods(self):
        self.assertGeneric(self.client.get("/api/v1/no-existe/"), "ruta inexistente")
        self.assertGeneric(self.client.delete("/api/v1/questions/no/existe/"), "ruta inexistente")
        self.client.force_authenticate(create_user("uniform.user"))
        response = self.client.delete("/api/v1/auth/me/")  # método no permitido, con sesión
        self.assertEqual(response.status_code, 405)
        self.assertGeneric(response, "405")

    def test_options_never_describes_an_endpoint(self):
        for path in ("/api/v1/auth/login/", "/api/v1/questions/evaluations/", "/api/v1/users/admin/", "/healthz"):
            with self.subTest(path=path):
                response = self.client.options(path)
                self.assertEqual(response.status_code, 405)
                self.assertGeneric(response, f"OPTIONS {path}")
        # Con sesión tampoco: DRF ya no muestra los campos ni los métodos.
        self.client.force_authenticate(create_user("uniform.options", User.Role.SUPERADMIN))
        self.assertGeneric(self.client.options("/api/v1/questions/evaluations/"), "OPTIONS con sesión")

    def test_cors_preflight_from_the_app_still_works(self):
        response = self.client.options(
            "/api/v1/auth/login/",
            HTTP_ORIGIN="https://heroesdelcorazon-pabon-1.onrender.com",
            HTTP_ACCESS_CONTROL_REQUEST_METHOD="POST",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Access-Control-Allow-Origin"], "https://heroesdelcorazon-pabon-1.onrender.com")

    def test_root_and_old_admin_path_are_unauthorized_outside_the_api_too(self):
        for path in ("/", "/admin/", "/admin/login/", "/cualquier-cosa"):
            for method in ("get", "post", "patch", "delete"):
                with self.subTest(method=method, path=path):
                    self.assertGeneric(getattr(self.client, method)(path), f"{method} {path}")
        self.assertEqual(self.client.get("/healthz").json(), {"status": "ok"})
        # El panel de Django vive ahora en /django-admin/ y conserva su login.
        self.assertContains(self.client.get("/django-admin/login/"), 'id="login-form"')

    def test_wrong_role_gets_the_same_answer(self):
        self.client.force_authenticate(create_user("uniform.collab", User.Role.COLLABORATOR))
        for method, path in (("get", "/api/v1/users/admin/"), ("post", "/api/v1/users/register/"),
                             ("put", "/api/v1/questions/settings/"), ("delete", "/api/v1/questions/evaluations/1/")):
            with self.subTest(method=method, path=path):
                response = getattr(self.client, method)(path, {}, format="json")
                self.assertEqual(response.status_code, 403)
                self.assertGeneric(response, path)

    def test_failed_login_does_not_reveal_whether_the_account_exists_or_is_locked(self):
        existing = create_user("uniform.exists")
        wrong = self.client.post("/api/v1/auth/login/", {"username": existing.username, "password": "mala-123456"}, format="json")
        unknown = self.client.post("/api/v1/auth/login/", {"username": username_for("nadie"), "password": "mala-123456"}, format="json")
        self.assertEqual((wrong.status_code, wrong.json()), (unknown.status_code, unknown.json()))
        self.assertEqual(wrong.json(), GENERIC)

    def test_logged_in_users_keep_form_validation_messages(self):
        # La app necesita los mensajes de validación (400) de sus formularios.
        self.client.force_authenticate(create_user("uniform.form", User.Role.BOSS))
        response = self.client.post("/api/v1/questions/evaluations/", {"name": ""}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("name", response.json())
