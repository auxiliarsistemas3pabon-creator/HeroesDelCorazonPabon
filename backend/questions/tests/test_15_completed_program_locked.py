from datetime import timedelta
from io import StringIO

from django.core.management import call_command
from django.utils import timezone
from rest_framework.test import APITestCase

from users.models import User

from ..limits import evaluation_progress
from ..models import Evaluation, Question
from .helpers import create_user

URL = "/api/v1/questions/evaluations/"
LOCKED = "Esta programación ya no tiene evaluaciones pendientes: no se puede editar."


class CompletedProgramLockedTests(APITestCase):
    """Con 0 evaluaciones pendientes la programación ya no se edita (sí se puede cerrar)."""

    def setUp(self):
        self.boss = create_user("locked.boss", User.Role.BOSS)
        self.ana = create_user("locked.ana", User.Role.COLLABORATOR, area="Enfermería")
        self.people = [create_user(f"locked.p{n}", User.Role.COLLABORATOR, area="Enfermería") for n in range(2)]
        form = Evaluation.objects.create(name="Desempeño", created_by=self.boss)
        self.evaluation = Evaluation.objects.create(
            name="Desempeño", created_by=self.boss, areas=["Enfermería"], monthly_limit=2, source=form,
            closes_on=timezone.localdate() + timedelta(days=5), program_started_at=timezone.now(),
            evaluator_ids=[self.ana.pk],  # solo Ana evalúa; las otras dos personas solo son evaluadas
        )
        self.client.force_authenticate(self.boss)

    def score_all(self):
        for person in self.people:
            Question.objects.create(
                evaluation=self.evaluation, collaborator=self.ana, personal=person, area=person.area, score=3
            )

    def edit(self, body):
        return self.client.patch(f"{URL}{self.evaluation.pk}/", body, format="json")

    def test_program_with_pending_evaluations_can_be_edited(self):
        future = (timezone.localdate() + timedelta(days=9)).isoformat()
        self.assertEqual(self.edit({"closes_on": future}).status_code, 200)

    def test_completed_program_cannot_be_edited(self):
        self.score_all()
        future = (timezone.localdate() + timedelta(days=9)).isoformat()
        for body in ({"closes_on": future}, {"areas": None}, {"random_selection": True}, {"evaluator_ids": []}):
            with self.subTest(body=body):
                response = self.edit(body)
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.data["detail"], LOCKED)
        response = self.client.put(
            "/api/v1/questions/settings/", {"evaluation": self.evaluation.pk, "monthly_limit": 5}, format="json"
        )
        self.assertEqual(response.status_code, 400)
        self.evaluation.refresh_from_db()
        self.assertEqual(self.evaluation.monthly_limit, 2)

    def test_completed_program_can_still_be_closed(self):
        self.score_all()
        self.assertEqual(self.edit({"is_available": False}).status_code, 200)

    def test_restore_program_round_previews_and_then_restores_without_deleting(self):
        self.score_all()
        # Una edición previa reinició la ronda: lo realizado dejó de contar.
        Evaluation.objects.filter(pk=self.evaluation.pk).update(program_started_at=timezone.now() + timedelta(seconds=1))
        self.evaluation.refresh_from_db()
        self.assertEqual(evaluation_progress(self.evaluation)["done"], 0)

        call_command("restore_program_round", str(self.evaluation.pk), stdout=StringIO())
        self.evaluation.refresh_from_db()
        self.assertEqual(evaluation_progress(self.evaluation)["done"], 0)  # sin --apply no cambia nada

        call_command("restore_program_round", str(self.evaluation.pk), "--apply", stdout=StringIO())
        self.evaluation.refresh_from_db()
        self.assertEqual(self.evaluation.program_started_at, self.evaluation.created_at)
        self.assertEqual(evaluation_progress(self.evaluation)["done"], 2)
        self.assertTrue(Evaluation.objects.filter(pk=self.evaluation.pk).exists())
