"""Pruebas de seguridad: dispositivos registrados, mensajes de login e inyecciones."""
from django.test import SimpleTestCase
from rest_framework.test import APIClient, APITestCase

from common.security import looks_malicious

from .devices import device_cookie_name
from .models import TrustedDevice, User
from .tests import MFA_VERIFY, PASSWORD, create_user, sign_in
from .totp import code_for

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
        login = sign_in(self.client, "colab.demo", "Nueva-Clave-2026*")
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

    def test_private_window_is_not_blocked_but_needs_the_2fa_code(self):
        # Ya no se bloquea la ventana privada: como no trae el dispositivo de confianza, pide el codigo.
        r = self.post("colab.demo", PASSWORD, private_mode=True)
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.data["mfa_required"])
        self.assertNotIn("access_token", r.cookies)


class DeviceSessionTests(APITestCase):
    def setUp(self):
        self.user = create_user("colab.demo")

    def login(self, client):
        return sign_in(client, "colab.demo")

    def test_registered_user_on_new_device_is_allowed_and_device_registered(self):
        r = self.login(self.client)
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.cookies[device_cookie_name(self.user.pk)]["httponly"])
        self.assertEqual(TrustedDevice.objects.filter(user=self.user).count(), 1)
        self.assertEqual(self.client.get("/api/v1/auth/me/").data["username"], "colab.demo")

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
        r = sign_in(self.client, "otra.demo")
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

    def test_legacy_session_without_device_claim_must_sign_in_with_2fa(self):
        from rest_framework_simplejwt.tokens import RefreshToken

        self.client.cookies["refresh_token"] = str(RefreshToken.for_user(self.user))
        self.assertEqual(self.client.post("/api/v1/auth/refresh/").status_code, 401)
        self.assertFalse(TrustedDevice.objects.exists())

    def test_lockout_does_not_block_owner_with_correct_password(self):
        for _ in range(6):
            self.client.post(LOGIN, {"username": "colab.demo", "password": "mala"}, format="json")
        self.assertEqual(self.login(self.client).status_code, 200)


class TwoFactorTests(APITestCase):
    """Doble autenticacion condicionada por dispositivo de confianza."""

    def setUp(self):
        self.user = create_user("colab.demo")

    def password_step(self, client):
        return client.post(LOGIN, {"username": "colab.demo", "password": PASSWORD}, format="json")

    def code(self):
        self.user.refresh_from_db()
        return code_for(self.user.totp_secret)

    def test_first_login_shows_enrollment_and_opens_no_session(self):
        r = self.password_step(self.client)
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.data["mfa_required"])
        self.assertTrue(r.data["enrollment"]["otpauth_uri"].startswith("otpauth://totp/"))
        self.assertNotIn("access_token", r.cookies)
        self.assertIsNone(self.client.get("/api/v1/auth/me/").data)
        # El QR se mantiene mientras no se confirme: volver a intentarlo no cambia el secreto.
        self.assertEqual(self.password_step(APIClient()).data["enrollment"]["secret"], r.data["enrollment"]["secret"])

    def test_valid_code_opens_session_and_trusts_the_browser(self):
        r = self.password_step(self.client)
        r = self.client.post(MFA_VERIFY, {"mfa_token": r.data["mfa_token"], "code": self.code()}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["username"], "colab.demo")
        self.assertIn("access_token", r.cookies)
        self.user.refresh_from_db()
        self.assertTrue(self.user.totp_enabled)
        # Mismo navegador: la proxima vez basta la contrasena.
        again = self.password_step(self.client)
        self.assertNotIn("mfa_required", again.data)
        self.assertEqual(again.data["username"], "colab.demo")

    def test_private_window_or_new_computer_must_pass_2fa(self):
        sign_in(self.client, "colab.demo")  # navegador habitual, ya verificado
        r = self.password_step(APIClient())  # incognito / otro computador: sin cookies
        self.assertTrue(r.data["mfa_required"])
        self.assertNotIn("enrollment", r.data)  # la app ya esta registrada: solo pide el codigo
        self.assertNotIn("access_token", r.cookies)

    def test_wrong_code_is_rejected_and_locks_after_five_attempts(self):
        token = self.password_step(self.client).data["mfa_token"]
        for _ in range(5):
            r = self.client.post(MFA_VERIFY, {"mfa_token": token, "code": "000000"}, format="json")
            self.assertIn(r.status_code, (401, 403))
        r = self.client.post(MFA_VERIFY, {"mfa_token": token, "code": self.code()}, format="json")
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.data["code"], "mfa_locked")
        self.assertNotIn("access_token", r.cookies)

    def test_code_cannot_be_reused(self):
        token = self.password_step(self.client).data["mfa_token"]
        code = self.code()
        self.assertEqual(self.client.post(MFA_VERIFY, {"mfa_token": token, "code": code}, format="json").status_code, 200)
        other = APIClient()
        token = self.password_step(other).data["mfa_token"]
        r = other.post(MFA_VERIFY, {"mfa_token": token, "code": code}, format="json")
        self.assertEqual(r.status_code, 401)
        self.assertEqual(r.data["code"], "mfa_invalid")

    def test_tampered_or_expired_challenge_is_rejected(self):
        r = self.client.post(MFA_VERIFY, {"mfa_token": "falso", "code": "123456"}, format="json")
        self.assertEqual(r.status_code, 401)
        self.assertEqual(r.data["code"], "mfa_expired")

    def test_password_change_invalidates_pending_challenge(self):
        token = self.password_step(self.client).data["mfa_token"]
        self.user.set_password("Otra-Clave-2026!")
        self.user.save()
        r = self.client.post(MFA_VERIFY, {"mfa_token": token, "code": self.code()}, format="json")
        self.assertEqual(r.data["code"], "mfa_expired")

    def test_trust_expires_after_configured_days(self):
        from datetime import timedelta

        from django.utils import timezone

        sign_in(self.client, "colab.demo")
        TrustedDevice.objects.update(mfa_verified_at=timezone.now() - timedelta(days=31))
        self.assertEqual(self.client.get("/api/v1/users/collaborators/").status_code, 401)
        self.assertEqual(self.client.post("/api/v1/auth/refresh/").status_code, 401)
        self.assertTrue(self.password_step(self.client).data["mfa_required"])

    def test_every_module_rejects_a_browser_without_trusted_device(self):
        boss = create_user("admin.demo", User.Role.SUPERADMIN)
        normal = APIClient()
        r = sign_in(normal, boss.username)
        private = APIClient()
        private.cookies["access_token"] = r.cookies["access_token"].value
        modules = [
            "/api/v1/users/collaborators/", "/api/v1/users/admin/", "/api/v1/users/staff-candidates/",
            "/api/v1/users/evaluators/", "/api/v1/questions/evaluations/", "/api/v1/questions/categories/",
            "/api/v1/questions/form/", "/api/v1/questions/", "/api/v1/questions/settings/",
            "/api/v1/questions/sent/", "/api/v1/questions/submissions/", "/api/v1/questions/results-summary/",
            "/api/v1/questions/results/", "/api/v1/questions/quota/", "/api/v1/questions/dashboard/",
            "/api/v1/questions/category-averages/", "/api/v1/questions/stats/",
        ]
        for path in modules:
            with self.subTest(path=path):
                # Navegador normal autenticado (403 solo si el modulo es de otro rol); sin dispositivo: 401.
                self.assertNotEqual(normal.get(path).status_code, 401)
                self.assertEqual(private.get(path).status_code, 401)
                self.assertEqual(APIClient().get(path).status_code, 401)

    def test_superadmin_reset_shows_new_qr_and_closes_sessions(self):
        sign_in(self.client, "colab.demo")
        admin = APIClient()
        create_user("admin.demo", User.Role.SUPERADMIN)
        sign_in(admin, "admin.demo")
        listing = {u["username"]: u for u in admin.get("/api/v1/users/admin/").data}
        self.assertTrue(listing["colab.demo"]["totp_enabled"])
        r = admin.post(f"/api/v1/users/admin/{self.user.pk}/reset-mfa/")
        self.assertEqual(r.status_code, 200)
        self.assertFalse(r.data["totp_enabled"])
        self.assertEqual(self.client.get("/api/v1/users/collaborators/").status_code, 401)
        self.assertIn("enrollment", self.password_step(self.client).data)

    def test_only_superadmin_can_reset_2fa(self):
        boss = APIClient()
        create_user("boss.demo", role=User.Role.BOSS)
        sign_in(boss, "boss.demo")
        self.assertEqual(boss.post(f"/api/v1/users/admin/{self.user.pk}/reset-mfa/").status_code, 403)

    def test_reset_mfa_command(self):
        from io import StringIO

        from django.core.management import call_command

        sign_in(self.client, "colab.demo")
        call_command("reset_mfa", "colab.demo", stdout=StringIO())
        self.user.refresh_from_db()
        self.assertFalse(self.user.totp_enabled)
        self.assertFalse(TrustedDevice.objects.filter(revoked=False).exists())
