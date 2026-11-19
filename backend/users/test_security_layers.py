"""Capas de seguridad 21 a 24 (ver reportes_pruebas_QA/PRUEBAS_MANUALES_SEGURIDAD.txt)."""

import io

from django.conf import settings
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from openpyxl import Workbook
from rest_framework.test import APIClient, APITestCase

from audit.models import AppendOnlyError, AuditEvent
from common.testing import random_password, username_for

from .models import TrustedDevice, User

NEW = "Corazon-Nuevo-2026!"


def make_user(label, role=User.Role.COLLABORATOR, password=None):
    return User.objects.create_user(
        username=username_for(label), password=password or random_password(), first_name="Demo", last_name="Capa",
        role=role, area="Enfermería",
    )


def login(username, password, ip="203.0.113.10"):
    client = APIClient()
    response = client.post("/api/v1/auth/login/", {"username": username, "password": password}, REMOTE_ADDR="127.0.0.1",
                           HTTP_X_FORWARDED_FOR=ip)
    assert response.status_code == 200, response.data
    return client


class NoStoreLayerTests(APITestCase):
    """Capa 22."""

    def test_api_responses_are_never_cached(self):
        response = self.client.get("/api/v1/auth/me/")
        self.assertEqual(response["Cache-Control"], "no-store")
        self.assertEqual(response["Pragma"], "no-cache")

    def test_non_api_responses_are_untouched(self):
        self.assertNotIn("no-store", self.client.get("/healthz").get("Cache-Control", ""))


class PersistentAuditLayerTests(APITestCase):
    """Capa 23."""

    def test_failed_login_is_stored_with_the_real_client_ip(self):
        user = make_user("audit.user")
        self.client.post("/api/v1/auth/login/", {"username": user.username, "password": "incorrecta-123"},
                         REMOTE_ADDR="127.0.0.1", HTTP_X_FORWARDED_FOR="198.51.100.7")
        event = AuditEvent.objects.filter(action="login.post").latest("created_at")
        self.assertEqual((event.outcome, event.status_code, event.ip_address), ("failure", 401, "198.51.100.7"))
        self.assertTrue(AuditEvent.objects.filter(action="security.wrong_password", outcome="blocked").exists())

    def test_successful_action_records_who_did_it(self):
        password = random_password()
        admin = make_user("audit.admin", User.Role.SUPERADMIN, password=password)
        client = login(admin.username, password)
        client.patch(f"/api/v1/users/admin/{make_user('audit.target').pk}/", {"role": "boss"}, format="json")
        event = AuditEvent.objects.filter(action="admin-user-detail.patch").latest("created_at")
        self.assertEqual((event.actor_id, event.actor_username, event.actor_role, event.outcome),
                         (admin.pk, admin.username, "superadmin", "success"))

    def test_blocked_attack_is_stored(self):
        self.client.get("/api/v1/auth/me/?q=1' OR '1'='1")
        self.assertTrue(AuditEvent.objects.filter(action="security.malicious_input").exists())

    def test_events_are_append_only(self):
        self.client.post("/api/v1/auth/logout/")
        event = AuditEvent.objects.latest("created_at")
        event.outcome = "altered"
        with self.assertRaises(AppendOnlyError):
            event.save()
        with self.assertRaises(AppendOnlyError):
            event.delete()
        with self.assertRaises(AppendOnlyError):
            AuditEvent.objects.all().update(outcome="altered")
        with self.assertRaises(AppendOnlyError):
            AuditEvent.objects.all().delete()

    def test_passwords_are_never_stored(self):
        secret = "Clave-Que-No-Debe-Verse-1"
        self.client.post("/api/v1/auth/login/", {"username": "nadie", "password": secret})
        stored = " ".join(str(values) for values in AuditEvent.objects.values_list())
        self.assertNotIn(secret, stored)


class UploadValidationLayerTests(APITestCase):
    """Capa 24."""

    URL = "/api/v1/users/import/"

    def setUp(self):
        self.client.force_authenticate(make_user("upload.admin", User.Role.SUPERADMIN))

    def upload(self, name, content):
        return self.client.post(self.URL, {"file": SimpleUploadedFile(name, content)}, format="multipart")

    def valid_xlsx(self):
        book = Workbook()
        book.active.append(["Número de documento", "Nombres", "Área", "Cargo"])
        buffer = io.BytesIO()
        book.save(buffer)
        return buffer.getvalue()

    def test_wrong_extension_is_rejected(self):
        response = self.upload("personal.exe", self.valid_xlsx())
        self.assertEqual(response.status_code, 400)
        self.assertIn("no permitido", response.data["detail"])

    def test_renamed_file_is_rejected(self):
        response = self.upload("personal.xlsx", b"MZ\x90\x00 esto es un ejecutable renombrado")
        self.assertEqual(response.status_code, 400)
        self.assertIn("no es un Excel", response.data["detail"])

    @override_settings(UPLOAD_MAX_BYTES=1024)
    def test_oversized_file_is_rejected(self):
        response = self.upload("personal.xlsx", self.valid_xlsx() + b"0" * 2048)
        self.assertEqual(response.status_code, 400)
        self.assertIn("supera el máximo", response.data["detail"])

    def test_valid_excel_still_loads(self):
        self.assertEqual(self.upload("personal.xlsx", self.valid_xlsx()).status_code, 200)

    def test_binary_csv_is_rejected_in_answers_import(self):
        self.client.force_authenticate(make_user("upload.boss", User.Role.BOSS))
        response = self.client.post("/api/v1/questions/answers/import/",
                                    {"file": SimpleUploadedFile("r.csv", b"col\x00\x01\x02")}, format="multipart")
        self.assertEqual(response.status_code, 400)


class SessionRevocationLayerTests(APITestCase):
    """Capa 21."""

    def setUp(self):
        self.password = random_password()
        self.user = make_user("revoke.user", password=self.password)
        self.user.password_change_required = False
        self.user.save()

    def test_changing_the_password_closes_the_other_sessions_but_keeps_this_one(self):
        here = login(self.user.username, self.password)
        elsewhere = login(self.user.username, self.password, ip="198.51.100.99")
        self.assertEqual(elsewhere.get("/api/v1/questions/evaluations/").status_code, 200)

        changed = here.post("/api/v1/auth/password-change/", {"current_password": self.password, "new_password": NEW}, format="json")
        self.assertEqual(changed.status_code, 200)
        # El otro equipo queda fuera de inmediato (también su access token aún vigente) y no puede renovar.
        self.assertEqual(elsewhere.get("/api/v1/questions/evaluations/").status_code, 401)
        self.assertEqual(elsewhere.post("/api/v1/auth/refresh/").status_code, 401)
        # Este equipo sigue dentro y puede renovar con los tokens nuevos.
        self.assertEqual(here.get("/api/v1/questions/evaluations/").status_code, 200)
        self.assertEqual(here.post("/api/v1/auth/refresh/").status_code, 200)
        self.assertEqual(TrustedDevice.objects.filter(user=self.user, revoked=False).count(), 1)

    def test_admin_reset_closes_every_session_of_that_account(self):
        session = login(self.user.username, self.password)
        admin = make_user("revoke.admin", User.Role.SUPERADMIN)
        self.client.force_authenticate(admin)
        self.client.patch(f"/api/v1/users/admin/{self.user.pk}/", {"new_password": settings.DEFAULT_USER_PASSWORD}, format="json")
        self.assertEqual(session.get("/api/v1/auth/me/").status_code, 401)
        self.assertEqual(TrustedDevice.objects.filter(user=self.user, revoked=False).count(), 0)
