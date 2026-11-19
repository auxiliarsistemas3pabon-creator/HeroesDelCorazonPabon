from datetime import timedelta

from django.utils import timezone
from rest_framework.test import APITestCase

from users.models import User

from ..limits import evaluation_progress
from ..models import Evaluation, Question
from .helpers import create_user

EVALUATIONS = "/api/v1/questions/evaluations/"


class SelfEvaluationTests(APITestCase):
    """Programación individual = autoevaluación: cada colaborador se evalúa a sí mismo una vez."""

    def setUp(self):
        self.boss = create_user("self.boss", User.Role.BOSS)
        self.ana = create_user("self.ana", User.Role.COLLABORATOR, area="Enfermería")
        self.beto = create_user("self.beto", User.Role.COLLABORATOR, area="Enfermería")
        self.client.force_authenticate(self.boss)
        form = self.client.post(EVALUATIONS, {"name": "Autoevaluación"}, format="json").data
        self.client.post(
            "/api/v1/questions/categories/",
            {"evaluation": form["id"], "name": "Compromiso", "criteria": ["Cumple sus tareas."]},
            format="json",
        )
        self.form_id = form["id"]

    def program(self, **extra):
        body = {"closes_on": (timezone.localdate() + timedelta(days=5)).isoformat(), "areas": ["Enfermería"],
                "personal_ids": [], "kind": "self", **extra}
        self.client.force_authenticate(self.boss)
        return self.client.post(f"{EVALUATIONS}{self.form_id}/programs/", body, format="json")

    def answer(self, collaborator, evaluation_id, person):
        self.client.force_authenticate(collaborator)
        codes = [q["code"] for c in self.client.get(f"/api/v1/questions/form/?evaluation={evaluation_id}").data
                 for q in c["criteria"]]
        return self.client.post("/api/v1/questions/", {
            "evaluation": evaluation_id, "personal": person.pk,
            "answers": [{"criterion": code, "score": 4} for code in codes],
        }, format="json")

    def test_programming_only_needs_up_to_the_closing_date(self):
        # Sin cantidad de usuarios ni modo: se ignoran aunque lleguen.
        response = self.program(monthly_limit=9, random_selection=True)
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["kind"], "self")
        evaluation = Evaluation.objects.get(pk=response.data["id"])
        self.assertEqual((evaluation.monthly_limit, evaluation.random_selection), (1, False))

    def test_each_collaborator_evaluates_only_themselves_once(self):
        evaluation_id = self.program().data["id"]
        # A otra persona no.
        other = self.answer(self.ana, evaluation_id, self.beto)
        self.assertEqual(other.status_code, 400)
        self.assertIn("autoevaluación", str(other.data["personal"]))
        # A sí misma sí, una sola vez.
        self.assertEqual(self.answer(self.ana, evaluation_id, self.ana).status_code, 201)
        self.assertEqual(self.answer(self.ana, evaluation_id, self.ana).status_code, 400)

    def test_progress_counts_one_per_collaborator(self):
        evaluation_id = self.program().data["id"]
        evaluation = Evaluation.objects.get(pk=evaluation_id)
        self.assertEqual(evaluation_progress(evaluation)["total"], 2)
        self.answer(self.ana, evaluation_id, self.ana)
        progress = evaluation_progress(evaluation)
        self.assertEqual((progress["done"], progress["pending"]), (1, 1))
        self.assertEqual([item["id"] for item in progress["pending_evaluators"]], [self.beto.pk])

    def test_group_programming_still_forbids_evaluating_yourself(self):
        create_user("self.p1", User.Role.PERSONAL, area="Enfermería")
        group_id = self.program(kind="group", monthly_limit=1).data["id"]
        self.assertEqual(self.answer(self.ana, group_id, self.ana).status_code, 400)

    def test_self_evaluation_limit_cannot_be_changed(self):
        evaluation_id = self.program().data["id"]
        self.client.force_authenticate(self.boss)
        url = "/api/v1/questions/settings/"
        self.assertEqual(self.client.put(url, {"evaluation": evaluation_id, "monthly_limit": 3}, format="json").status_code, 400)

    def test_unknown_kind_is_rejected(self):
        self.assertEqual(self.program(kind="otra").status_code, 400)

    def test_results_summary_filters_by_kind(self):
        """Resultados: ?kind separa grupales de individuales (también en "Todas" y en la evaluación por defecto)."""
        person = create_user("self.p2", User.Role.PERSONAL, area="Enfermería")
        self_id = self.program().data["id"]
        group_id = self.program(kind="group", monthly_limit=1).data["id"]
        self.assertEqual(self.answer(self.ana, self_id, self.ana).status_code, 201)
        self.assertEqual(self.answer(self.beto, group_id, person).status_code, 201)
        Question.objects.update(reviewed_at=timezone.now())

        # Resultados limita las personas al área del jefe: se le asigna la de los evaluados.
        self.boss.area = "Enfermería"
        self.boss.save(update_fields=["area"])
        self.client.force_authenticate(self.boss)
        url = "/api/v1/questions/results-summary/"

        def people(query):
            return [row["personal"] for row in self.client.get(f"{url}?{query}").data["rows"]]

        self.assertEqual(self.client.get(f"{url}?kind=group").data["evaluation"]["id"], group_id)
        self.assertEqual(self.client.get(f"{url}?kind=self").data["evaluation"]["id"], self_id)
        self.assertEqual(people("kind=group&evaluation=all"), [person.pk])
        self.assertEqual(people("kind=self&evaluation=all"), [self.ana.pk])
        # Una evaluación de otro tipo no se mezcla.
        self.assertEqual(self.client.get(f"{url}?kind=group&evaluation={self_id}").data["rows"], [])
        self.assertEqual(sorted(people("evaluation=all")), sorted([person.pk, self.ana.pk]))
        self.assertEqual(self.client.get(f"{url}?kind=otra").status_code, 400)
