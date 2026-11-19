from datetime import timedelta

from django.utils import timezone
from rest_framework.test import APITestCase

from users.models import User

from ..limits import evaluation_progress, max_monthly_limit
from ..models import Evaluation, Question
from .helpers import create_user

URL = "/api/v1/questions/evaluations/"


class GroupLimitTests(APITestCase):
    """Usuarios a evaluar: como máximo las personas del grupo seleccionado menos 1."""

    def setUp(self):
        self.boss = create_user("group.boss", User.Role.BOSS)
        # Enfermería: 5 personas (máximo 4). Urgencias: 3 personas (máximo 2).
        for n in range(4):
            create_user(f"group.nurse{n}", User.Role.COLLABORATOR, area="Enfermería")
        create_user("group.nurse.evaluator", User.Role.COLLABORATOR, area="Enfermería")
        for n in range(3):
            create_user(f"group.er{n}", User.Role.COLLABORATOR, area="Urgencias")
        self.form = Evaluation.objects.create(name="Desempeño", created_by=self.boss)
        self.client.force_authenticate(self.boss)

    def program(self, areas, limit):
        return self.client.post(
            f"{URL}{self.form.pk}/programs/",
            {"closes_on": (timezone.localdate() + timedelta(days=5)).isoformat(), "areas": areas,
             "personal_ids": [], "monthly_limit": limit},
            format="json",
        )

    def test_max_is_group_size_minus_one(self):
        self.assertEqual(max_monthly_limit(["Enfermería"]), 4)
        self.assertEqual(max_monthly_limit(["Urgencias"]), 2)
        self.assertEqual(max_monthly_limit(["Enfermería", "Urgencias"]), 4)  # manda el grupo más grande
        self.assertEqual(max_monthly_limit(None), 4)
        self.assertEqual(max_monthly_limit(["Inexistente"]), 0)

    def test_programming_rejects_more_than_the_group_allows(self):
        response = self.program(["Enfermería"], 5)
        self.assertEqual(response.status_code, 400)
        self.assertIn("es 4", response.data["monthly_limit"][0])
        self.assertEqual(self.program(["Enfermería"], 4).status_code, 201)
        self.assertEqual(self.program(["Urgencias"], 3).status_code, 400)

    def test_editing_the_limit_also_respects_the_group(self):
        programmed = self.program(["Urgencias"], 2).data["id"]
        url = "/api/v1/questions/settings/"
        self.assertEqual(self.client.put(url, {"evaluation": programmed, "monthly_limit": 3}, format="json").status_code, 400)
        self.assertEqual(self.client.put(url, {"evaluation": programmed, "monthly_limit": 2}, format="json").status_code, 200)


class EditKeepsProgressTests(APITestCase):
    """Editar la programación no reprograma: lo ya evaluado se conserva y solo cambia lo pendiente."""

    def setUp(self):
        self.boss = create_user("keep.boss", User.Role.BOSS)
        self.ana = create_user("keep.ana", User.Role.COLLABORATOR, area="Enfermería")
        self.beto = create_user("keep.beto", User.Role.COLLABORATOR, area="Enfermería")
        self.people = [create_user(f"keep.p{n}", User.Role.COLLABORATOR, area="Enfermería") for n in range(3)]
        form = Evaluation.objects.create(name="Desempeño", created_by=self.boss)
        self.started = timezone.now() - timedelta(hours=1)
        self.evaluation = Evaluation.objects.create(
            name="Desempeño", created_by=self.boss, areas=["Enfermería"], monthly_limit=2, source=form,
            closes_on=timezone.localdate() + timedelta(days=5), program_started_at=self.started,
            evaluator_ids=[self.ana.pk, self.beto.pk],  # las otras 3 personas solo son evaluadas
        )
        # Ana ya terminó sus 2 evaluaciones; Beto todavía no evaluó a nadie.
        for person in self.people[:2]:
            Question.objects.create(evaluation=self.evaluation, collaborator=self.ana, personal=person,
                                    area=person.area, score=3)
        self.client.force_authenticate(self.boss)

    def test_editing_date_areas_and_mode_does_not_restart_the_round(self):
        before = evaluation_progress(self.evaluation)
        self.assertEqual((before["done"], before["pending"]), (2, 2))
        new_date = (timezone.localdate() + timedelta(days=12)).isoformat()
        evaluators = {"evaluator_ids": [self.beto.pk, self.ana.pk]}
        for body in ({"closes_on": new_date}, {"areas": ["Enfermería"]}, {"random_selection": True}, evaluators):
            with self.subTest(body=body):
                self.assertEqual(self.client.patch(f"{URL}{self.evaluation.pk}/", body, format="json").status_code, 200)
                self.evaluation.refresh_from_db()
                self.assertEqual(self.evaluation.program_started_at, self.started)  # no se reprogramó
                after = evaluation_progress(self.evaluation)
                # Ana sigue con sus evaluaciones hechas; solo Beto queda pendiente.
                self.assertEqual((after["done"], after["pending"]), (2, 2))
                self.assertEqual([item["id"] for item in after["pending_evaluators"]], [self.beto.pk])

    def test_reopening_a_closed_evaluation_still_starts_a_new_round(self):
        Evaluation.objects.filter(pk=self.evaluation.pk).update(is_available=False)
        admin = create_user("keep.admin", User.Role.SUPERADMIN)
        self.client.force_authenticate(admin)
        self.assertEqual(self.client.patch(f"{URL}{self.evaluation.pk}/", {"is_available": True}, format="json").status_code, 200)
        self.evaluation.refresh_from_db()
        self.assertGreater(self.evaluation.program_started_at, self.started)
