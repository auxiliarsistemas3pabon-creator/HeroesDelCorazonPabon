from rest_framework.test import APITestCase

from users.models import User

from ..models import Evaluation
from .helpers import create_user

URL = "/api/v1/questions/evaluations/"
CATEGORIES = [{"name": "Trabajo en equipo", "criteria": ["Colabora con el equipo"]}]


class UniqueEvaluationNameTests(APITestCase):
    def setUp(self):
        self.boss = create_user("unique.boss", User.Role.BOSS)
        self.client.force_authenticate(self.boss)

    def create(self, name):
        return self.client.post(URL, {"name": name, "categories": CATEGORIES}, format="json")

    def test_rejects_a_name_already_in_use_ignoring_case_and_spaces(self):
        self.assertEqual(self.create("Desempeño anual").status_code, 201)

        for repeated in ("Desempeño anual", "  desempeño ANUAL  "):
            response = self.create(repeated)
            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.data["name"], ["Esta evaluación ya está en uso."])
        self.assertEqual(Evaluation.objects.filter(name__iexact="Desempeño anual").count(), 1)

    def test_rejects_a_name_used_by_another_boss(self):
        other = create_user("unique.other.boss", User.Role.BOSS)
        Evaluation.objects.create(name="Calidad", created_by=other)
        self.assertEqual(self.create("Calidad").status_code, 400)

    def test_different_name_is_allowed(self):
        self.assertEqual(self.create("Desempeño anual").status_code, 201)
        self.assertEqual(self.create("Desempeño semestral").status_code, 201)
