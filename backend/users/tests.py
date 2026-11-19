
from rest_framework.test import APITestCase

from common.testing import random_digits, random_password, username_for

from .models import User

# Credenciales generadas al azar en cada ejecución: no hay contraseñas ni usuarios escritos en los tests.
PASSWORD = random_password()
NEW_PASSWORD = random_password()
WRONG_PASSWORD = random_password()


def create_user(label, role=User.Role.COLLABORATOR, area="Emergency"):
    """`label` identifica al usuario en la prueba; su nombre de usuario real es aleatorio (ver username_for)."""
    username = username_for(label)
    return User.objects.create_user(
        username=username, email=f"{username}@example.invalid", password=PASSWORD,
        first_name="Demo", last_name="Fictional", role=role, area=area,
    )


class AuthTests(APITestCase):
    def setUp(self):
        self.boss = create_user("boss.demo", User.Role.BOSS)

    def test_login_ok_sets_httponly_cookies(self):
        self.assertNotEqual(self.boss.password, PASSWORD)
        self.assertTrue(self.boss.check_password(PASSWORD))
        r = self.client.post("/api/v1/auth/login/", {"username": username_for("boss.demo"), "password": PASSWORD})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["role"], "boss")
        self.assertTrue(r.cookies["access_token"]["httponly"])
        self.assertTrue(r.cookies["refresh_token"]["httponly"])
        self.assertEqual(self.client.get("/api/v1/auth/me/").status_code, 200)

    def test_invalid_login(self):
        r = self.client.post("/api/v1/auth/login/", {"username": username_for("boss.demo"), "password": WRONG_PASSWORD})
        self.assertEqual(r.status_code, 401)

    def test_sql_injection_login_payload_is_rejected(self):
        r = self.client.post(
            "/api/v1/auth/login/",
            {"username": "' OR '1'='1' --", "password": PASSWORD},
        )
        self.assertEqual(r.status_code, 403)
        self.assertNotIn("access_token", r.cookies)

    def test_me_without_session(self):
        response = self.client.get("/api/v1/auth/me/")
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.data)

    def test_cookie_requires_csrf_on_post(self):
        self.client.post("/api/v1/auth/login/", {"username": username_for("boss.demo"), "password": PASSWORD})
        self.client.handler.enforce_csrf_checks = True
        r = self.client.post("/api/v1/users/register/", {"username": username_for("x")})
        self.assertEqual(r.status_code, 403)

    def test_refresh_and_logout(self):
        self.client.post("/api/v1/auth/login/", {"username": username_for("boss.demo"), "password": PASSWORD})
        self.assertEqual(self.client.post("/api/v1/auth/refresh/").status_code, 200)
        self.assertEqual(self.client.post("/api/v1/auth/logout/").status_code, 204)
        response = self.client.get("/api/v1/auth/me/")
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.data)

    def test_messages_are_translated_to_spanish(self):
        r = self.client.post("/api/v1/auth/login/", {"username": username_for("boss.demo"), "password": WRONG_PASSWORD})
        self.assertEqual(r.data["detail"], "Acceso no autorizado.")


class RegisterTests(APITestCase):
    def test_only_superadmins_can_create_collaborators(self):
        create_user("evaluator.demo", User.Role.COLLABORATOR, area="Cardiology")
        self.assertEqual(self.client.get("/api/v1/users/areas/").data, ["Cardiology"])

        body = {
            "username": username_for("nuevo.demo"), "email": f"{username_for('nuevo.demo')}@example.invalid", "first_name": "Nuevo", "last_name": "Demo",
            "area": "Cardiology", "position": "Enfermera", "password": NEW_PASSWORD, "role": "boss",
        }
        url = "/api/v1/users/register/"
        self.assertEqual(self.client.post(url, body).status_code, 401)

        self.client.force_authenticate(create_user("outside.demo", User.Role.COLLABORATOR))
        self.assertEqual(self.client.post(url, body).status_code, 403)

        admin = create_user("admin.demo", User.Role.SUPERADMIN)
        self.client.force_authenticate(admin)
        r = self.client.post(url, body)
        self.assertEqual(r.status_code, 201)
        self.assertNotIn("password", r.data)
        self.assertEqual(User.objects.get(username=username_for("nuevo.demo")).role, "collaborator")  # role cannot be chosen
        self.client.force_authenticate(None)
        r = self.client.post("/api/v1/auth/login/", {"username": username_for("nuevo.demo"), "password": NEW_PASSWORD})
        self.assertEqual(r.status_code, 200)

    def test_sign_up_needs_no_email_and_validates_area(self):
        base = {"username": username_for("x.demo"), "first_name": "X", "last_name": "Y", "password": NEW_PASSWORD, "area": "Nursing", "position": "Enfermera"}
        self.client.force_authenticate(create_user("admin.demo", User.Role.SUPERADMIN))
        self.assertEqual(self.client.post("/api/v1/users/register/", {**base, "area": ""}).status_code, 400)
        self.assertEqual(self.client.post("/api/v1/users/register/", {**base, "position": ""}).status_code, 400)
        self.assertEqual(self.client.post("/api/v1/users/register/", {**base, "area": "Sistema"}).status_code, 400)
        self.assertEqual(
            self.client.post(
                "/api/v1/users/register/",
                {**base, "username": username_for("sistemas.demo"), "area": "Sistemas"},
            ).status_code,
            201,
        )
        self.assertEqual(self.client.post("/api/v1/users/register/", base).status_code, 201)
        self.assertIsNone(User.objects.get(username=username_for("x.demo")).email)
        self.assertEqual(self.client.post("/api/v1/users/register/", {**base, "username": username_for("y.demo")}).status_code, 201)  # two users without email

    def test_area_suggestions_hide_only_removed_system_area(self):
        create_user("old.system", area="Sistema")
        create_user("new.systems", area="Sistemas")

        self.assertEqual(self.client.get("/api/v1/users/areas/").data, ["Sistemas"])


class StaffImportTests(APITestCase):
    URL = "/api/v1/users/import/"

    def setUp(self):
        self.boss = create_user("admin.demo", User.Role.SUPERADMIN)

    def excel(self, rows, header=("Número de documento", "Nombres", "Apellidos", "Área", "Cargo")):
        import io

        from django.core.files.uploadedfile import SimpleUploadedFile
        from openpyxl import Workbook

        wb = Workbook()
        ws = wb.active
        ws.append(list(header))
        for row in rows:
            ws.append(list(row))
        buffer = io.BytesIO()
        wb.save(buffer)
        return SimpleUploadedFile("personal.xlsx", buffer.getvalue())

    def upload(self, rows, **kwargs):
        self.client.force_authenticate(self.boss)
        return self.client.post(self.URL, {"file": self.excel(rows, **kwargs)}, format="multipart")

    def test_loads_staff_and_never_duplicates_a_document(self):
        base = int(random_digits(7)) + 1_000_000
        d1, d2, d3, d4 = (base + n for n in range(1, 5))
        User.objects.create_user(username=str(d1), password=random_password(), first_name="Ya", last_name="Existe",
                                 role="collaborator")
        r = self.upload([
            (d2, "Ana María", "Pérez", "Sistemas", "Auxiliar"),   # number cell, like Excel stores it
            (str(d3), "Luis", "Gómez", "Imagenologia", "Técnico"),
            (d1, "Otro", "Nombre", "Sistemas", "Auxiliar"),       # already in the database
            (d2, "Repetida", "En archivo", "Sistemas", "Auxiliar"),  # repeated inside the file
            (None, None, None, None, None),                          # blank line
            (d4, "Sin", "Area", "", "Auxiliar"),                   # incomplete
        ])
        self.assertEqual(r.status_code, 200)
        self.assertEqual((r.data["created"], r.data["skipped"]), (2, 2))
        self.assertEqual(r.data["skipped_documents"], [str(d1), str(d2)])
        self.assertEqual(len(r.data["errors"]), 1)
        self.assertIn("Fila 7", r.data["errors"][0])  # the row number as Excel shows it

        credentials = r.data["initial_credentials"]
        self.assertEqual({item["username"] for item in credentials}, {str(d2), str(d3)})
        self.assertEqual(len({item["password"] for item in credentials}), 2)
        ana = User.objects.get(username=str(d2))
        self.assertEqual((ana.first_name, ana.last_name, ana.area, ana.position, ana.role), ("Ana María", "Pérez", "Sistemas", "Auxiliar", "collaborator"))
        ana_password = next(item["password"] for item in credentials if item["username"] == str(d2))
        self.assertNotEqual(ana_password, str(d2))
        self.assertTrue(ana.check_password(ana_password))
        self.assertFalse(ana.password_change_required)
        self.assertIsNone(ana.email)
        self.assertEqual(User.objects.get(username=str(d1)).first_name, "Ya")  # the existing user is untouched
        self.assertFalse(User.objects.filter(username=str(d4)).exists())

        again = self.upload([(d2, "Ana María", "Pérez", "Sistemas", "Auxiliar")])
        self.assertEqual((again.data["created"], again.data["skipped"]), (0, 1))
        self.assertEqual(again.data["initial_credentials"], [])

    def test_names_in_one_column_and_header_variants(self):
        r = self.upload([(random_digits(8), "Juan Pérez", "Sistemas", "Auxiliar")], header=("Cédula", "Nombres", "AREA", "cargo"))
        self.assertEqual((r.status_code, r.data["created"]), (200, 1))

    def test_rejects_removed_area_without_affecting_sistemas(self):
        legacy_staff = User.objects.create_user(
            username=username_for("legacy-system"),
            password=PASSWORD,
            first_name="Sistema",
            last_name="Legado",
            role=User.Role.COLLABORATOR,
            area="Sistema",
        )
        sistemas_staff = User.objects.create_user(
            username=username_for("active-sistemas"),
            password=PASSWORD,
            first_name="Sistemas",
            last_name="Actual",
            role=User.Role.COLLABORATOR,
            area="Sistemas",
        )
        sistemas_collaborator = create_user("collaborator-sistemas", area="Sistemas")
        self.client.force_authenticate(self.boss)
        candidates = self.client.get("/api/v1/users/staff-candidates/").data
        candidate_ids = [candidate["id"] for candidate in candidates]
        self.assertNotIn(legacy_staff.pk, candidate_ids)
        self.assertIn(sistemas_staff.pk, candidate_ids)
        self.assertIn(sistemas_collaborator.pk, candidate_ids)

        response = self.upload([
            ("2001", "Ana", "Pérez", "Sistema", "Auxiliar"),
            ("2002", "Luis", "Gómez", "Sistemas", "Auxiliar"),
        ])
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["created"], 1)
        self.assertEqual(len(response.data["errors"]), 1)
        self.assertIn("Sistema ya no está disponible", response.data["errors"][0])
        self.assertFalse(User.objects.filter(username="2001").exists())
        self.assertEqual(User.objects.get(username="2002").area, "Sistemas")

    def test_rejects_bad_files_and_non_bosses(self):
        self.assertEqual(self.upload([(1, "A", "B", "C", "D")], header=("Documento", "Nombres")).status_code, 400)
        self.client.force_authenticate(self.boss)
        self.assertEqual(self.client.post(self.URL, {}, format="multipart").status_code, 400)
        from django.core.files.uploadedfile import SimpleUploadedFile

        bad = SimpleUploadedFile("x.xlsx", b"not an excel")
        self.assertEqual(self.client.post(self.URL, {"file": bad}, format="multipart").status_code, 400)
        self.client.force_authenticate(create_user("c.demo", User.Role.COLLABORATOR))
        self.assertEqual(self.client.post(self.URL, {"file": self.excel([])}, format="multipart").status_code, 403)
