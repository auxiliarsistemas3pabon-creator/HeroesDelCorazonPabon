"""Clave inicial (settings.DEFAULT_USER_PASSWORD) con cambio obligatorio y cambio de la propia clave."""

from django.conf import settings
from rest_framework.test import APIClient, APITestCase

from common.testing import random_digits, random_password, username_for

from .models import User

CHANGE = "/api/v1/auth/password-change/"
NEW = "Corazon-Nuevo-2026!"


class InitialPasswordTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            username=username_for("pw.admin"), password=random_password(), first_name="Admin", last_name="Demo",
            role=User.Role.SUPERADMIN, area="Sistemas",
        )
        self.client.force_authenticate(self.admin)
        response = self.client.post("/api/v1/users/register/", {
            "username": random_digits(10), "first_name": "Nueva", "last_name": "Persona",
            "area": "Enfermería", "position": "Auxiliar",
        }, format="json")
        self.assertEqual(response.status_code, 201)
        self.user = User.objects.get(pk=response.data["id"])
        self.client.force_authenticate(None)

    def login(self, password=None):
        client = APIClient(enforce_csrf_checks=False)
        response = client.post("/api/v1/auth/login/", {"username": self.user.username, "password": password or settings.DEFAULT_USER_PASSWORD})
        self.assertEqual(response.status_code, 200)
        return client, response

    def test_new_user_gets_the_initial_password_and_must_change_it(self):
        self.assertTrue(self.user.check_password(settings.DEFAULT_USER_PASSWORD))
        client, response = self.login()
        self.assertTrue(response.data["password_change_required"])
        # Solo puede ver su perfil y cambiar la clave: el resto de la API está bloqueado.
        self.assertEqual(client.get("/api/v1/auth/me/").status_code, 200)
        blocked = client.get("/api/v1/questions/evaluations/")
        self.assertEqual(blocked.status_code, 403)
        self.assertEqual(blocked.data, {"detail": "Acceso no autorizado.", "code": "unauthorized_access"})

        changed = client.post(CHANGE, {"current_password": settings.DEFAULT_USER_PASSWORD, "new_password": NEW}, format="json")
        self.assertEqual(changed.status_code, 200)
        self.assertFalse(changed.data["password_change_required"])
        self.assertEqual(client.get("/api/v1/questions/evaluations/").status_code, 200)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password(NEW))

    def test_change_needs_the_current_password_and_a_new_one(self):
        client, _ = self.login()
        self.assertEqual(client.post(CHANGE, {"current_password": "otra-cosa-123", "new_password": NEW}, format="json").status_code, 400)
        same = client.post(CHANGE, {"current_password": settings.DEFAULT_USER_PASSWORD, "new_password": settings.DEFAULT_USER_PASSWORD}, format="json")
        self.assertEqual(same.status_code, 400)
        self.assertIn("new_password", same.data)
        self.assertEqual(client.post(CHANGE, {"current_password": settings.DEFAULT_USER_PASSWORD, "new_password": "123"}, format="json").status_code, 400)
        self.user.refresh_from_db()
        self.assertTrue(self.user.password_change_required)

    def test_any_user_can_change_their_own_password_later(self):
        client, _ = self.login()
        client.post(CHANGE, {"current_password": settings.DEFAULT_USER_PASSWORD, "new_password": NEW}, format="json")
        again = client.post(CHANGE, {"current_password": NEW, "new_password": "Otra-Clave-Segura-77"}, format="json")
        self.assertEqual(again.status_code, 200)
        self.assertEqual(APIClient().post(CHANGE, {"current_password": NEW, "new_password": "x" * 12}, format="json").status_code, 401)

    def test_admin_reset_to_the_initial_password_forces_a_new_change(self):
        self.user.password_change_required = False
        self.user.save()
        self.client.force_authenticate(self.admin)
        url = f"/api/v1/users/admin/{self.user.pk}/"
        self.client.patch(url, {"new_password": settings.DEFAULT_USER_PASSWORD}, format="json")
        self.user.refresh_from_db()
        self.assertTrue(self.user.password_change_required)
        self.client.patch(url, {"new_password": NEW}, format="json")
        self.user.refresh_from_db()
        self.assertFalse(self.user.password_change_required)
