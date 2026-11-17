from rest_framework.test import APITestCase

from users.models import User

from ..models import Evaluation, Question
from .helpers import create_user

URL = "/api/v1/questions/evaluations/"


class EvaluationProgressTests(APITestCase):
    """Lista de evaluaciones: total, programadas (pendientes), realizadas y colaboradores pendientes."""

    def setUp(self):
        self.boss = create_user("progress.boss", User.Role.BOSS)
        self.ana = create_user("progress.ana", User.Role.COLLABORATOR, area="Enfermería")
        self.ana.first_name, self.ana.last_name = "Ana", "Ríos"
        self.ana.save()
        self.beto = create_user("progress.beto", User.Role.COLLABORATOR, area="Enfermería")
        self.beto.first_name, self.beto.last_name = "Beto", "Gil"
        self.beto.save()
        self.people = [create_user(f"progress.p{n}", User.Role.PERSONAL, area="Enfermería") for n in range(3)]
        # Otra área: no cuenta para esta evaluación.
        create_user("progress.other", User.Role.COLLABORATOR, area="Urgencias")
        self.evaluation = Evaluation.objects.create(
            name="Desempeño", created_by=self.boss, areas=["Enfermería"], monthly_limit=2
        )

    def score(self, collaborator, person):
        Question.objects.create(
            evaluation=self.evaluation, collaborator=collaborator, personal=person, area=person.area, score=3
        )

    def row(self, user=None):
        self.client.force_authenticate(user or self.boss)
        response = self.client.get(URL)
        return next(item for item in response.data if item["id"] == self.evaluation.pk)

    def test_counts_total_done_pending_and_who_is_missing(self):
        # Ana y Beto deben evaluar 2 cada uno (límite 2) -> total 4.
        self.score(self.ana, self.people[0])
        self.score(self.ana, self.people[1])
        self.score(self.beto, self.people[0])

        row = self.row()
        self.assertEqual(
            (row["evaluations_total"], row["evaluations_done"], row["evaluations_pending"]), (4, 3, 1)
        )
        self.assertEqual(row["pending_evaluators"], [{"id": self.beto.pk, "name": "Beto Gil", "missing": 1}])

    def test_nobody_pending_when_everyone_finished(self):
        for collaborator in (self.ana, self.beto):
            self.score(collaborator, self.people[0])
            self.score(collaborator, self.people[1])
        row = self.row()
        self.assertEqual((row["evaluations_total"], row["evaluations_pending"]), (4, 0))
        self.assertEqual(row["pending_evaluators"], [])

    def test_only_enabled_evaluators_count(self):
        Evaluation.objects.filter(pk=self.evaluation.pk).update(evaluator_ids=[self.ana.pk])
        row = self.row()
        self.assertEqual(row["evaluations_total"], 2)
        self.assertEqual([item["id"] for item in row["pending_evaluators"]], [self.ana.pk])

    def test_collaborators_do_not_receive_who_is_pending(self):
        row = self.row(self.ana)
        self.assertNotIn("pending_evaluators", row)
        self.assertNotIn("evaluations_total", row)
