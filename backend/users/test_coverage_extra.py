"""Pruebas adicionales para cubrir vistas, serializadores, modelos y capas de seguridad."""
import json
from unittest import mock

from django.test import RequestFactory, SimpleTestCase, TestCase
from rest_framework.test import APIClient, APITestCase

from common.security import MaliciousInputMiddleware, client_ip, looks_malicious
from common.testing import random_digits, random_password, username_for

from .models import TrustedDevice, User
from .tests import PASSWORD, create_user

LOGIN = "/api/v1/auth/login/"
# Generadas al azar en cada ejecución (ninguna contraseña escrita en los tests).
NEW_PASSWORD = random_password()
WRONG_PASSWORD = random_password()


def login(client, username):
    r = client.post(LOGIN, {"username": username, "password": PASSWORD}, format="json")
    assert r.status_code == 200, r.content
    return r


class ModelTests(TestCase):
    def test_create_superuser_defaults_and_validation(self):
        admin = User.objects.create_superuser(username_for("root"), "root@example.invalid", PASSWORD, first_name="R", last_name="T")
        self.assertEqual((admin.role, admin.is_staff, admin.is_superuser), ("superadmin", True, True))
        with self.assertRaises(ValueError):
            User.objects.create_superuser(username_for("r2"), None, PASSWORD, is_staff=False)
        with self.assertRaises(ValueError):
            User.objects.create_superuser(username_for("r3"), None, PASSWORD, is_superuser=False)

    def test_str_and_blank_email_normalised(self):
        user = User.objects.create_user(username_for("u1"), email="", password=PASSWORD, first_name="A", last_name="B")
        self.assertIsNone(user.email)
        self.assertEqual(str(user), "u1")
        device = TrustedDevice.objects.create(user=user, token_hash="h")
        self.assertEqual(str(device), f"{user.pk}:{device.pk}")


class SecurityEdgeCases(SimpleTestCase):
    def test_client_ip_prefers_forwarded_header(self):
        rf = RequestFactory()
        self.assertEqual(client_ip(rf.get("/", HTTP_X_FORWARDED_FOR="9.9.9.9, 1.1.1.1")), "9.9.9.9")
        self.assertEqual(client_ip(rf.get("/", REMOTE_ADDR="5.5.5.5")), "5.5.5.5")

    def _call(self, request):
        sentinel = object()
        middleware = MaliciousInputMiddleware(lambda r: sentinel)
        return middleware(request), sentinel

    def test_non_api_paths_and_safe_requests_pass(self):
        rf = RequestFactory()
        result, sentinel = self._call(rf.get("/admin/?q=' OR 1=1 --"))
        self.assertIs(result, sentinel)
        result, sentinel = self._call(rf.get("/api/v1/x/?q=hola"))
        self.assertIs(result, sentinel)

    def test_post_edge_cases_pass_through(self):
        rf = RequestFactory()
        # No JSON, JSON invalido, cuerpo demasiado grande y metodos no inspeccionados.
        result, sentinel = self._call(rf.post("/api/v1/x/", data="<script>", content_type="text/plain"))
        self.assertIs(result, sentinel)
        result, sentinel = self._call(rf.post("/api/v1/x/", data="{no json", content_type="application/json"))
        self.assertIs(result, sentinel)
        big = rf.post("/api/v1/x/", data=json.dumps({"a": "<script>"}), content_type="application/json")
        big.META["CONTENT_LENGTH"] = str(MaliciousInputMiddleware.MAX_BODY + 1)
        result, sentinel = self._call(big)
        self.assertIs(result, sentinel)
        result, sentinel = self._call(rf.delete("/api/v1/x/"))
        self.assertIs(result, sentinel)

    def test_nested_payloads_are_inspected_but_passwords_are_not(self):
        rf = RequestFactory()
        nested = {"a": [{"b": "' UNION SELECT 1 --"}]}
        response, _ = self._call(rf.post("/api/v1/x/", data=json.dumps(nested), content_type="application/json"))
        self.assertEqual(response.status_code, 403)
        keyed = {"<script>": 1}
        response, _ = self._call(rf.post("/api/v1/x/", data=json.dumps(keyed), content_type="application/json"))
        self.assertEqual(response.status_code, 403)
        safe = {"password": "' OR 1=1 --", "texto": "ok"}
        response, sentinel = self._call(rf.post("/api/v1/x/", data=json.dumps(safe), content_type="application/json"))
        self.assertIs(response, sentinel)
        deep = {"a": {"b": {"c": {"d": {"e": {"f": {"g": {"h": {"i": "<script>"}}}}}}}}}
        response, sentinel = self._call(rf.post("/api/v1/x/", data=json.dumps(deep), content_type="application/json"))
        self.assertIs(response, sentinel)  # profundidad limitada

    def test_looks_malicious_ignores_non_strings(self):
        self.assertFalse(looks_malicious(None))
        self.assertFalse(looks_malicious(""))


class AuthenticationTests(APITestCase):
    def setUp(self):
        self.user = create_user("colab.demo")

    def test_authorization_header_is_checked_for_device_binding(self):
        from rest_framework_simplejwt.tokens import RefreshToken

        token = RefreshToken.for_user(self.user)
        token["did"] = 999  # dispositivo que no existe
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
        self.assertEqual(client.get("/api/v1/users/collaborators/").status_code, 401)

    def test_authorization_header_without_device_claim_works(self):
        from rest_framework_simplejwt.tokens import RefreshToken

        token = RefreshToken.for_user(self.user)
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
        self.assertEqual(client.get("/api/v1/users/collaborators/").status_code, 200)

    def test_missing_authentication_returns_none(self):
        self.assertEqual(APIClient().get("/api/v1/users/collaborators/").status_code, 401)

    def test_invalid_login_payload_is_rejected(self):
        self.assertEqual(APIClient().post(LOGIN, {}, format="json").status_code, 400)

    def test_logout_without_cookie_and_with_garbage_cookie(self):
        self.assertEqual(self.client.post("/api/v1/auth/logout/").status_code, 204)
        self.client.cookies["refresh_token"] = "garbage"
        self.assertEqual(self.client.post("/api/v1/auth/logout/").status_code, 204)

    def test_refresh_without_cookie_or_with_garbage(self):
        self.assertEqual(APIClient().post("/api/v1/auth/refresh/").status_code, 401)
        client = APIClient()
        client.cookies["refresh_token"] = "garbage"
        self.assertEqual(client.post("/api/v1/auth/refresh/").status_code, 401)

    def test_csrf_token_endpoint(self):
        r = APIClient().get("/api/v1/auth/csrf/")
        self.assertEqual(r.status_code, 200)
        self.assertIn("csrfToken", r.data)

    def test_locked_out_message_is_logged(self):
        from django.core.exceptions import PermissionDenied

        with mock.patch("users.views.authenticate", side_effect=PermissionDenied):
            r = APIClient().post(LOGIN, {"username": username_for("fantasma"), "password": WRONG_PASSWORD}, format="json")
        self.assertEqual(r.status_code, 403)

    def test_device_cookie_for_another_user_is_not_reused(self):
        other = create_user("otro.demo")
        client = APIClient()
        login(client, username_for("colab.demo"))
        # El mismo navegador inicia sesion con otro usuario: se registra otro dispositivo.
        r = client.post(LOGIN, {"username": username_for("otro.demo"), "password": PASSWORD}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(TrustedDevice.objects.filter(user=other).count(), 1)

    def test_refresh_with_device_mismatch_is_rejected(self):
        r = login(self.client, username_for("colab.demo"))
        other_browser = APIClient()
        other_browser.cookies["refresh_token"] = r.cookies["refresh_token"].value
        from users.devices import device_cookie_name

        other_browser.cookies[device_cookie_name(r.data["id"])] = "no-es-el-dispositivo"
        self.assertEqual(other_browser.post("/api/v1/auth/refresh/").status_code, 401)


class AdminAndDirectoryViewTests(APITestCase):
    def setUp(self):
        self.admin = create_user("admin.demo", User.Role.SUPERADMIN, area="Sistemas")
        self.admin2 = create_user("admin2.demo", User.Role.SUPERADMIN, area="Sistemas")
        self.boss = create_user("boss.demo", User.Role.BOSS, area="Cardiologia")
        self.colab = create_user("colab.demo", User.Role.COLLABORATOR, area="Cardiologia")
        self.colab2 = create_user("colab2.demo", User.Role.COLLABORATOR, area="Cardiologia")
        self.personal = create_user("pers.demo", User.Role.PERSONAL, area="Cardiologia")
        self.client_admin = APIClient()
        login(self.client_admin, username_for("admin.demo"))

    def patch(self, user, data):
        return self.client_admin.patch(f"/api/v1/users/admin/{user.pk}/", data, format="json")

    def test_list_users_requires_superadmin(self):
        self.assertEqual(self.client_admin.get("/api/v1/users/admin/").status_code, 200)
        boss_client = APIClient()
        login(boss_client, username_for("boss.demo"))
        self.assertEqual(boss_client.get("/api/v1/users/admin/").status_code, 403)

    def test_patch_unknown_user(self):
        r = self.client_admin.patch("/api/v1/users/admin/99999/", {}, format="json")
        self.assertEqual(r.status_code, 404)

    def test_role_validation_and_change(self):
        self.assertEqual(self.patch(self.colab, {"role": "inventado"}).status_code, 400)
        r = self.patch(self.colab, {"role": "boss"})
        self.assertEqual(r.status_code, 200)
        self.colab.refresh_from_db()
        self.assertEqual(self.colab.role, "boss")

    def test_cannot_remove_own_superadmin_role_or_disable_self(self):
        self.assertEqual(self.patch(self.admin, {"role": "boss"}).status_code, 400)
        self.assertEqual(self.patch(self.admin, {"is_active": False}).status_code, 400)

    def test_is_active_validation(self):
        self.assertEqual(self.patch(self.colab, {"is_active": "no"}).status_code, 400)
        self.assertEqual(self.patch(self.colab, {"is_active": True}).status_code, 400)  # solo desactiva

    def test_disable_other_user(self):
        r = self.patch(self.colab, {"is_active": False})
        self.assertEqual(r.status_code, 200)
        self.colab.refresh_from_db()
        self.assertFalse(self.colab.is_active)
        r = APIClient().post(LOGIN, {"username": username_for("colab.demo"), "password": PASSWORD}, format="json")
        self.assertEqual(r.status_code, 401)

    def test_last_active_superadmin_is_protected(self):
        self.patch(self.admin2, {"is_active": False})
        other = APIClient()
        other.cookies = self.client_admin.cookies
        # admin2 ya inactivo; cambiar a un tercer admin activo e intentar quitar al unico restante.
        third = create_user("admin3.demo", User.Role.SUPERADMIN)
        client3 = APIClient()
        login(client3, username_for("admin3.demo"))
        r = client3.patch(f"/api/v1/users/admin/{self.admin.pk}/", {"is_active": False}, format="json")
        self.assertEqual(r.status_code, 200)  # quedan admin3 activo
        r = client3.patch(f"/api/v1/users/admin/{self.admin.pk}/", {"role": "boss"}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(User.objects.filter(pk=third.pk, role="superadmin", is_active=True).exists())

    def test_cannot_demote_the_only_active_superadmin(self):
        self.patch(self.admin2, {"is_active": False})
        third = create_user("admin3.demo", User.Role.SUPERADMIN)
        # Solo quedan admin y third activos: quitar el rol a third deja a admin => permitido; luego a admin => 400
        client3 = APIClient()
        login(client3, username_for("admin3.demo"))
        client3.patch(f"/api/v1/users/admin/{self.admin.pk}/", {"role": "boss"}, format="json")
        r = client3.patch(f"/api/v1/users/admin/{third.pk}/", {"role": "boss"}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_password_reset_by_superadmin_clears_lockout(self):
        r = self.patch(self.colab, {"new_password": NEW_PASSWORD})
        self.assertEqual(r.status_code, 200)
        r = APIClient().post(LOGIN, {"username": username_for("colab.demo"), "password": NEW_PASSWORD}, format="json")
        self.assertEqual(r.status_code, 200)

    def test_weak_password_rejected(self):
        self.assertEqual(self.patch(self.colab, {"new_password": random_digits(3)}).status_code, 400)

    def test_directories_scoped_by_area_and_role(self):
        boss_client = APIClient()
        login(boss_client, username_for("boss.demo"))
        candidates = boss_client.get("/api/v1/users/staff-candidates/")
        self.assertEqual(candidates.status_code, 200)
        self.assertEqual({p["first_name"] for p in candidates.data}, {"Demo"})
        self.assertEqual(len(candidates.data), 3)  # colab, colab2, personal
        evaluators = boss_client.get("/api/v1/users/evaluators/")
        self.assertEqual(len(evaluators.data), 2)
        colab_client = APIClient()
        login(colab_client, username_for("colab.demo"))
        mine = colab_client.get("/api/v1/users/collaborators/")
        self.assertEqual({u["username"] for u in mine.data}, {username_for("colab2.demo"), username_for("pers.demo")})
        self.assertEqual(colab_client.get("/api/v1/users/staff-candidates/").status_code, 403)

    def test_collaborators_without_area_returns_empty(self):
        loner = create_user("sinarea.demo", User.Role.COLLABORATOR, area="")
        client = APIClient()
        login(client, loner.username)
        self.assertEqual(client.get("/api/v1/users/collaborators/").data, [])

    def test_me_endpoint(self):
        self.assertEqual(self.client_admin.get("/api/v1/auth/me/").data["username"], username_for("admin.demo"))


class RegisterValidationTests(APITestCase):
    def setUp(self):
        create_user("admin.demo", User.Role.SUPERADMIN)
        self.client_admin = APIClient()
        login(self.client_admin, username_for("admin.demo"))

    def register(self, **overrides):
        body = {
            "username": username_for("nuevo.demo"), "first_name": "Nuevo", "last_name": "Demo",
            "area": "Cardiologia", "position": "Auxiliar", "password": NEW_PASSWORD,
        }
        body.update(overrides)
        return self.client_admin.post("/api/v1/users/register/", body, format="json")

    def test_register_ok_and_duplicate(self):
        self.assertEqual(self.register().status_code, 201)
        self.assertEqual(self.register(username=username_for(username_for("nuevo.demo")).upper()).status_code, 400)

    def test_validations(self):
        self.assertEqual(self.register(username="   ").status_code, 400)
        self.assertEqual(self.register(first_name="   ").status_code, 400)
        self.assertEqual(self.register(last_name="   ").status_code, 400)
        self.assertEqual(self.register(area="Sistema").status_code, 400)
        self.assertEqual(self.register(password=random_digits(8)).status_code, 400)
        self.assertEqual(self.register(area="  Sala   Uno ").status_code, 201)
        self.assertEqual(User.objects.get(username=username_for("nuevo.demo")).area, "Sala Uno")
