"""Pruebas de seguridad: dispositivos registrados, mensajes de login e inyecciones."""
from django.test import SimpleTestCase
from rest_framework.test import APIClient, APITestCase

from common.security import looks_malicious
from common.testing import random_password, username_for

from .devices import device_cookie_name
from .models import TrustedDevice, User
from .tests import PASSWORD, create_user

LOGIN = "/api/v1/auth/login/"
# Generadas al azar en cada ejecución (ninguna contraseña escrita en los tests).
NEW_PASSWORD = random_password()
WRONG_PASSWORD = random_password()


class MaliciousInputDetectionTests(SimpleTestCase):
    def test_detects_sql_injection_and_scripts(self):
        attacks = [
            "' OR '1'='1' --",
            "admin'--",
            "1 OR 1=1",
            "x' UNION SELECT username, password FROM auth_user --",
            "'; DROP TABLE users; --",
            "<script>alert(1)</script>",
            "<img src=x onerror=alert(1)>",
            "javascript:alert(1)",
            "a'; WAITFOR DELAY '0:0:5'--",
            "1; SELECT pg_sleep(5)",
            "%27%20OR%20%271%27%3D%271",
            "SELECT * FROM information_schema.tables",
        ]
        for text in attacks:
            with self.subTest(text=text):
                self.assertTrue(looks_malicious(text))

    def test_allows_legitimate_text(self):
        for text in ["12345678", "maria.perez", "Excelente trabajo en equipo", "O'Brien", "Buen servicio y/o apoyo", "", None, 5]:
            with self.subTest(text=text):
                self.assertFalse(looks_malicious(text))


class AdminLoginPrivateWindowTests(APITestCase):
    """El login del panel de administración carga el mismo bloqueo de ventanas privadas que el frontend."""

    def test_admin_login_loads_the_private_window_check(self):
        response = self.client.get("/admin/login/")
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'src="/static/security/private-window.js"')
        self.assertContains(response, 'id="login-form"')

    def test_private_window_script_is_a_static_file(self):
        from django.contrib.staticfiles import finders

        path = finders.find("security/private-window.js")
        self.assertIsNotNone(path)
        with open(path, encoding="utf-8") as script:
            source = script.read()
        # Nunca bloquea ante duda: el bloqueo exige las 3 mediciones claramente privadas.
        self.assertIn("PRIVATE_BELOW = 1.25", source)
        self.assertIn("login-form", source)


class EndpointNavigationGateTests(APITestCase):
    """Abrir un endpoint directamente en el navegador pasa por la verificación de ventana privada."""

    NAVIGATION = {"HTTP_SEC_FETCH_DEST": "document", "HTTP_SEC_FETCH_MODE": "navigate"}

    def test_browser_navigation_gets_the_verification_page_not_the_content(self):
        for path in ("/", "/api/", "/api/v1/", "/api/v1/questions/evaluations/", "/api/v1/auth/me/"):
            with self.subTest(path=path):
                response = self.client.get(path, **self.NAVIGATION)
                self.assertEqual(response.status_code, 200)
                self.assertContains(response, "security/api-gate.js")
                self.assertNotContains(response, "endpoints")  # el contenido real no viaja en la página
                self.assertEqual(response["Cache-Control"], "no-store")
                self.assertIn("Sec-Fetch-Dest", response["Vary"])

    def test_app_requests_and_other_clients_get_the_normal_response(self):
        # fetch de la app (Sec-Fetch-Dest: empty), health check de Render y curl (sin cabeceras).
        fetch = {"HTTP_SEC_FETCH_DEST": "empty", "HTTP_SEC_FETCH_MODE": "cors"}
        for headers in (fetch, {}):
            with self.subTest(headers=headers):
                self.assertEqual(self.client.get("/api/", **headers).json()["version"], "v1")
                self.assertEqual(self.client.get("/", **headers).json(), {"status": "ok"})
                self.assertEqual(self.client.get("/api/v1/questions/evaluations/", **headers).status_code, 401)

    def test_admin_and_static_files_are_not_intercepted(self):
        response = self.client.get("/admin/login/", **self.NAVIGATION)
        self.assertContains(response, 'id="login-form"')
        self.assertNotContains(response, "api-gate.js")

    def test_only_reads_are_intercepted(self):
        response = self.client.post(LOGIN, {"username": username_for("nadie"), "password": WRONG_PASSWORD}, format="json", **self.NAVIGATION)
        self.assertNotEqual(response["Content-Type"].split(";")[0], "text/html")


class LoginSecurityTests(APITestCase):
    def setUp(self):
        self.user = create_user("colab.demo")

    def post(self, username, password, **extra):
        return self.client.post(LOGIN, {"username": username, "password": password, **extra}, format="json")

    def test_unknown_user_gets_user_not_found(self):
        with self.assertLogs("django.security", "WARNING") as logs:
            r = self.post(username_for("nadie.registrado"), PASSWORD)
        self.assertEqual(r.status_code, 401)
        self.assertEqual(r.data["code"], "user_not_found")
        self.assertIn("PERMISO NO AUTORIZADO", logs.output[0])
        self.assertNotIn("access_token", r.cookies)

    def test_wrong_password_for_registered_user_is_unauthorized_access(self):
        r = self.post(username_for("colab.demo"), WRONG_PASSWORD)
        self.assertEqual(r.status_code, 401)
        self.assertEqual(r.data["code"], "unauthorized_access")
        self.assertEqual(r.data["detail"], "Acceso no autorizado.")
        self.assertNotIn("access_token", r.cookies)

    def test_inactive_user_cannot_login(self):
        self.user.is_active = False
        self.user.save()
        r = self.post(username_for("colab.demo"), PASSWORD)
        self.assertEqual(r.status_code, 401)

    def _admin_client(self):
        client = APIClient()
        client.force_authenticate(create_user("admin.demo", User.Role.SUPERADMIN))
        return client

    def test_password_reset_only_changes_password_and_user_can_login(self):
        r = self._admin_client().patch(f"/api/v1/users/admin/{self.user.pk}/", {"new_password": NEW_PASSWORD}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.data["is_active"])
        login = self.post(username_for("colab.demo"), NEW_PASSWORD)
        self.assertEqual(login.status_code, 200)
        self.assertIn("access_token", login.cookies)
        # La clave anterior deja de servir y el no registrado sigue sin acceso.
        self.assertEqual(APIClient().post(LOGIN, {"username": username_for("colab.demo"), "password": PASSWORD}, format="json").status_code, 401)
        self.assertEqual(self.post(username_for("nadie.registrado"), NEW_PASSWORD).data["code"], "user_not_found")

    def test_password_reset_does_not_reactivate_disabled_account(self):
        self.user.is_active = False
        self.user.save()
        r = self._admin_client().patch(f"/api/v1/users/admin/{self.user.pk}/", {"new_password": NEW_PASSWORD}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertFalse(r.data["is_active"])
        self.assertEqual(self.post(username_for("colab.demo"), NEW_PASSWORD).status_code, 401)

    def test_disabled_account_cannot_be_reactivated(self):
        self.user.is_active = False
        self.user.save()
        r = self._admin_client().patch(f"/api/v1/users/admin/{self.user.pk}/", {"is_active": True}, format="json")
        self.assertEqual(r.status_code, 400)
        self.user.refresh_from_db()
        self.assertFalse(self.user.is_active)

    def test_sql_injection_in_username_is_blocked_by_middleware(self):
        r = self.post("' OR '1'='1' --", PASSWORD)
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.json()["code"], "unauthorized_access")

    def test_script_in_username_is_blocked(self):
        r = self.post("<script>alert(1)</script>", PASSWORD)
        self.assertEqual(r.status_code, 403)

    def test_sql_in_query_string_is_blocked(self):
        r = self.client.get("/api/v1/users/areas/?q=1%27%20UNION%20SELECT%20password%20FROM%20auth_user--")
        self.assertEqual(r.status_code, 403)

    def test_password_with_symbols_is_not_flagged(self):
        r = self.post(username_for("colab.demo"), "' OR 1=1 --")
        self.assertEqual(r.status_code, 401)  # rechazada por clave incorrecta, no por el filtro

    def test_oversized_or_missing_fields_are_rejected(self):
        self.assertEqual(self.post("a" * 500, PASSWORD).status_code, 400)
        self.assertEqual(self.client.post(LOGIN, {"username": username_for("x")}, format="json").status_code, 400)

    def test_private_mode_is_rejected(self):
        r = self.post(username_for("colab.demo"), PASSWORD, private_mode=True)
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.data["code"], "private_mode")
        self.assertNotIn("access_token", r.cookies)


class DeviceSessionTests(APITestCase):
    def setUp(self):
        self.user = create_user("colab.demo")

    def login(self, client):
        return client.post(LOGIN, {"username": username_for("colab.demo"), "password": PASSWORD}, format="json")

    def test_registered_user_on_new_device_is_allowed_and_device_registered(self):
        r = self.login(self.client)
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.cookies[device_cookie_name(self.user.pk)]["httponly"])
        self.assertEqual(TrustedDevice.objects.filter(user=self.user).count(), 1)
        self.assertEqual(self.client.get("/api/v1/auth/me/").data["username"], username_for("colab.demo"))

    def test_same_device_reuses_registration(self):
        self.login(self.client)
        self.login(self.client)
        self.assertEqual(TrustedDevice.objects.filter(user=self.user).count(), 1)

    def test_second_browser_gets_its_own_device(self):
        self.login(self.client)
        other = APIClient()
        self.assertEqual(self.login(other).status_code, 200)
        self.assertEqual(TrustedDevice.objects.filter(user=self.user, revoked=False).count(), 2)

    def test_several_accounts_share_the_same_browser(self):
        # Equipo compartido: cada cuenta guarda su propia cookie de dispositivo, nadie pisa a nadie.
        create_user("otra.demo")
        self.assertEqual(self.login(self.client).status_code, 200)
        r = self.client.post(LOGIN, {"username": username_for("otra.demo"), "password": PASSWORD}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.login(self.client).status_code, 200)
        self.assertEqual(TrustedDevice.objects.filter(revoked=False).count(), 2)

    def test_lost_device_cookie_requires_login_again(self):
        self.login(self.client)
        del self.client.cookies[device_cookie_name(self.user.pk)]
        self.assertEqual(self.client.get("/api/v1/users/collaborators/").status_code, 401)
        self.assertEqual(self.client.post("/api/v1/auth/refresh/").status_code, 401)

    def test_stolen_session_cookies_without_device_cookie_are_rejected(self):
        r = self.login(self.client)
        thief = APIClient()
        thief.cookies["access_token"] = r.cookies["access_token"].value
        thief.cookies["refresh_token"] = r.cookies["refresh_token"].value
        # La cookie de acceso sola no autentica sin el dispositivo.
        self.assertEqual(thief.get("/api/v1/users/collaborators/").status_code, 401)
        self.assertEqual(thief.post("/api/v1/auth/refresh/").status_code, 401)

    def test_revoked_device_loses_session(self):
        self.login(self.client)
        TrustedDevice.objects.update(revoked=True)
        self.assertEqual(self.client.get("/api/v1/users/collaborators/").status_code, 401)

    def test_refresh_keeps_device_binding(self):
        self.login(self.client)
        r = self.client.post("/api/v1/auth/refresh/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(TrustedDevice.objects.count(), 1)
        self.assertEqual(self.client.get("/api/v1/users/collaborators/").status_code, 200)

    def test_device_limit_revokes_the_oldest(self):
        for _ in range(7):
            self.login(APIClient())
        self.assertEqual(TrustedDevice.objects.filter(user=self.user, revoked=False).count(), 5)

    def test_legacy_session_without_device_claim_is_bound_on_refresh(self):
        from rest_framework_simplejwt.tokens import RefreshToken

        token = RefreshToken.for_user(self.user)
        self.client.cookies["refresh_token"] = str(token)
        r = self.client.post("/api/v1/auth/refresh/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(TrustedDevice.objects.count(), 1)
        self.assertIn(device_cookie_name(self.user.pk), r.cookies)

    def test_lockout_does_not_block_owner_with_correct_password(self):
        for _ in range(6):
            self.client.post(LOGIN, {"username": username_for("colab.demo"), "password": WRONG_PASSWORD}, format="json")
        self.assertEqual(self.login(self.client).status_code, 200)
