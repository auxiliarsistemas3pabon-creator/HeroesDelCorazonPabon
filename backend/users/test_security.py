"""Pruebas de seguridad: dispositivos registrados, mensajes de login e inyecciones."""
from django.test import SimpleTestCase
from rest_framework.test import APIClient, APITestCase

from common.security import looks_malicious

from .models import TrustedDevice, User
from .tests import PASSWORD, create_user

LOGIN = "/api/v1/auth/login/"


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


class LoginSecurityTests(APITestCase):
    def setUp(self):
        self.user = create_user("colab.demo")

    def post(self, username, password, **extra):
        return self.client.post(LOGIN, {"username": username, "password": password, **extra}, format="json")

    def test_unknown_user_gets_user_not_found(self):
        with self.assertLogs("django.security", "WARNING") as logs:
            r = self.post("nadie.registrado", PASSWORD)
        self.assertEqual(r.status_code, 401)
        self.assertEqual(r.data["code"], "user_not_found")
        self.assertIn("PERMISO NO AUTORIZADO", logs.output[0])
        self.assertNotIn("access_token", r.cookies)

    def test_wrong_password_for_registered_user_is_unauthorized_access(self):
        r = self.post("colab.demo", "clave-que-no-existe")
        self.assertEqual(r.status_code, 401)
        self.assertEqual(r.data["code"], "unauthorized_access")
        self.assertEqual(r.data["detail"], "Acceso no autorizado.")
        self.assertNotIn("access_token", r.cookies)

    def test_inactive_user_cannot_login(self):
        self.user.is_active = False
        self.user.save()
        r = self.post("colab.demo", PASSWORD)
        self.assertEqual(r.status_code, 401)

    def _admin_client(self):
        client = APIClient()
        client.force_authenticate(create_user("admin.demo", User.Role.SUPERADMIN))
        return client

    def test_password_reset_only_changes_password_and_user_can_login(self):
        r = self._admin_client().patch(f"/api/v1/users/admin/{self.user.pk}/", {"new_password": "Nueva-Clave-2026*"}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.data["is_active"])
        login = self.post("colab.demo", "Nueva-Clave-2026*")
        self.assertEqual(login.status_code, 200)
        self.assertIn("access_token", login.cookies)
        # La clave anterior deja de servir y el no registrado sigue sin acceso.
        self.assertEqual(APIClient().post(LOGIN, {"username": "colab.demo", "password": PASSWORD}, format="json").status_code, 401)
        self.assertEqual(self.post("nadie.registrado", "Nueva-Clave-2026*").data["code"], "user_not_found")

    def test_password_reset_does_not_reactivate_disabled_account(self):
        self.user.is_active = False
        self.user.save()
        r = self._admin_client().patch(f"/api/v1/users/admin/{self.user.pk}/", {"new_password": "Nueva-Clave-2026*"}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertFalse(r.data["is_active"])
        self.assertEqual(self.post("colab.demo", "Nueva-Clave-2026*").status_code, 401)

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
        r = self.post("colab.demo", "' OR 1=1 --")
        self.assertEqual(r.status_code, 401)  # rechazada por clave incorrecta, no por el filtro

    def test_oversized_or_missing_fields_are_rejected(self):
        self.assertEqual(self.post("a" * 500, PASSWORD).status_code, 400)
        self.assertEqual(self.client.post(LOGIN, {"username": "x"}, format="json").status_code, 400)

    def test_private_mode_is_rejected(self):
        r = self.post("colab.demo", PASSWORD, private_mode=True)
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.data["code"], "private_mode")
        self.assertNotIn("access_token", r.cookies)


class DeviceSessionTests(APITestCase):
    def setUp(self):
        self.user = create_user("colab.demo")

    def login(self, client):
        return client.post(LOGIN, {"username": "colab.demo", "password": PASSWORD}, format="json")

    def test_registered_user_on_new_device_is_allowed_and_device_registered(self):
        r = self.login(self.client)
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.cookies["device_id"]["httponly"])
        self.assertEqual(TrustedDevice.objects.filter(user=self.user).count(), 1)
        self.assertEqual(self.client.get("/api/v1/auth/me/").data["username"], "colab.demo")

    def test_same_device_reuses_registration(self):
        self.login(self.client)
        self.login(self.client)
        self.assertEqual(TrustedDevice.objects.filter(user=self.user).count(), 1)

    def test_second_browser_is_rejected_fixed_device(self):
        self.login(self.client)
        r = self.login(APIClient())  # otro navegador o ventana privada: sin la cookie del dispositivo
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.data["code"], "device_not_registered")
        self.assertNotIn("access_token", r.cookies)
        self.assertEqual(TrustedDevice.objects.filter(user=self.user, revoked=False).count(), 1)

    def test_second_browser_is_rejected_even_after_logout(self):
        self.login(self.client)
        self.client.post("/api/v1/auth/logout/")
        self.assertEqual(self.login(APIClient()).status_code, 403)
        # El navegador registrado puede volver a entrar.
        self.assertEqual(self.login(self.client).status_code, 200)

    def test_rule_applies_to_superadmin(self):
        create_user("super.demo", role=User.Role.SUPERADMIN)
        payload = {"username": "super.demo", "password": PASSWORD}
        self.assertEqual(APIClient().post(LOGIN, payload, format="json").status_code, 200)
        self.assertEqual(APIClient().post(LOGIN, payload, format="json").status_code, 403)

    def test_superadmin_releases_device_and_new_browser_can_log_in(self):
        self.login(self.client)
        admin = APIClient()
        create_user("super.demo", role=User.Role.SUPERADMIN)
        admin.post(LOGIN, {"username": "super.demo", "password": PASSWORD}, format="json")
        listing = {u["username"]: u for u in admin.get("/api/v1/users/admin/").data}
        self.assertTrue(listing["colab.demo"]["has_device"])
        r = admin.post(f"/api/v1/users/admin/{self.user.pk}/release-device/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["released"], 1)
        # La sesion del navegador anterior deja de valer y el nuevo navegador queda registrado.
        self.assertEqual(self.client.get("/api/v1/users/collaborators/").status_code, 401)
        self.assertEqual(self.login(APIClient()).status_code, 200)

    def test_only_superadmin_can_release_devices(self):
        boss = APIClient()
        create_user("boss.demo", role=User.Role.BOSS)
        boss.post(LOGIN, {"username": "boss.demo", "password": PASSWORD}, format="json")
        self.assertEqual(boss.post(f"/api/v1/users/admin/{self.user.pk}/release-device/").status_code, 403)

    def test_release_device_command(self):
        from django.core.management import call_command

        self.login(self.client)
        call_command("release_device", "colab.demo", stdout=open("/dev/null", "w"))
        self.assertFalse(TrustedDevice.objects.filter(user=self.user, revoked=False).exists())

    def test_lost_device_cookie_requires_login_again(self):
        self.login(self.client)
        del self.client.cookies["device_id"]
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

    def test_legacy_session_is_closed_if_account_has_another_device(self):
        from rest_framework_simplejwt.tokens import RefreshToken

        self.login(APIClient())
        self.client.cookies["refresh_token"] = str(RefreshToken.for_user(self.user))
        self.assertEqual(self.client.post("/api/v1/auth/refresh/").status_code, 401)

    def test_legacy_session_without_device_claim_is_bound_on_refresh(self):
        from rest_framework_simplejwt.tokens import RefreshToken

        token = RefreshToken.for_user(self.user)
        self.client.cookies["refresh_token"] = str(token)
        r = self.client.post("/api/v1/auth/refresh/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(TrustedDevice.objects.count(), 1)
        self.assertIn("device_id", r.cookies)

    def test_lockout_does_not_block_owner_with_correct_password(self):
        for _ in range(6):
            self.client.post(LOGIN, {"username": "colab.demo", "password": "mala"}, format="json")
        self.assertEqual(self.login(self.client).status_code, 200)
