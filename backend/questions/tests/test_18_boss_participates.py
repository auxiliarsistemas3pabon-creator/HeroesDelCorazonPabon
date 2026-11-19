from datetime import timedelta
from importlib import import_module

from django.apps import apps
from django.utils import timezone
from rest_framework.test import APITestCase

from users.models import User

from ..models import Evaluation
from .helpers import create_user

EVALUATIONS = "/api/v1/questions/evaluations/"


class BossParticipatesTests(APITestCase):
    """El coordinador (boss) también es colaborador: evalúa, se autoevalúa y lo evalúan los de su área."""

    def setUp(self):
        self.boss = create_user("part.boss", User.Role.BOSS, area="Enfermería")
        self.ana = create_user("part.ana", User.Role.COLLABORATOR, area="Enfermería")
        self.admin = create_user("part.admin", User.Role.SUPERADMIN, area="Enfermería")
        self.client.force_authenticate(self.boss)
        form = self.client.post(EVALUATIONS, {"name": "Desempeño"}, format="json").data
        self.client.post(
            "/api/v1/questions/categories/",
            {"evaluation": form["id"], "name": "Compromiso", "criteria": ["Cumple sus tareas."]},
            format="json",
        )
        self.form_id = form["id"]
        self.program_id = self.client.post(f"{EVALUATIONS}{form['id']}/programs/", {
            "closes_on": (timezone.localdate() + timedelta(days=5)).isoformat(), "areas": ["Enfermería"],
            "personal_ids": [], "monthly_limit": 1, "kind": "group",
        }, format="json").data["id"]

    def answer(self, evaluator, person):
        self.client.force_authenticate(evaluator)
        form = self.client.get(f"/api/v1/questions/form/?evaluation={self.program_id}&participant=1").data
        codes = [q["code"] for c in form for q in c["criteria"]]
        return self.client.post("/api/v1/questions/", {
            "evaluation": self.program_id, "personal": person.pk,
            "answers": [{"criterion": code, "score": 4} for code in codes],
        }, format="json")

    def test_participant_view_is_the_collaborator_view(self):
        manager_ids = [item["id"] for item in self.client.get(EVALUATIONS).data]
        participant = self.client.get(f"{EVALUATIONS}?participant=1").data
        # Como administrador ve también el formulario sin programar; como participante solo lo abierto de su área,
        # con su cupo y sin el avance (que es información de administración).
        self.assertIn(self.form_id, manager_ids)
        self.assertEqual([item["id"] for item in participant], [self.program_id])
        self.assertEqual(participant[0]["remaining"], 1)
        self.assertNotIn("pending_evaluators", participant[0])

    def test_superadmin_never_gets_the_participant_view(self):
        self.client.force_authenticate(self.admin)
        ids = [item["id"] for item in self.client.get(f"{EVALUATIONS}?participant=1").data]
        self.assertIn(self.form_id, ids)
        self.assertEqual(self.client.get(f"/api/v1/questions/quota/?evaluation={self.program_id}").status_code, 403)

    def test_boss_evaluates_and_is_evaluated_within_the_quota(self):
        self.assertEqual(self.answer(self.boss, self.ana).status_code, 201)
        self.assertEqual(self.answer(self.boss, self.ana).status_code, 400)  # cupo 1 ya usado
        self.assertEqual(self.answer(self.ana, self.boss).status_code, 201)
        # Cuenta en el avance como evaluador del área: ambos terminaron.
        self.client.force_authenticate(self.boss)
        row = next(item for item in self.client.get(EVALUATIONS).data if item["id"] == self.program_id)
        self.assertEqual((row["evaluations_total"], row["evaluations_pending"]), (2, 0))


class PersonalRoleMigrationTests(APITestCase):
    def test_personal_accounts_become_collaborators(self):
        old = create_user("legacy.personal", User.Role.COLLABORATOR, area="Enfermería")
        User.objects.filter(pk=old.pk).update(role="personal")  # valor antiguo, ya fuera de las opciones
        boss = create_user("legacy.boss", User.Role.BOSS)
        migration = import_module("users.migrations.0016_merge_personal_into_collaborator")
        migration.personal_to_collaborator(apps, None)
        old.refresh_from_db()
        boss.refresh_from_db()
        self.assertEqual((old.role, boss.role), (User.Role.COLLABORATOR, User.Role.BOSS))
        self.assertNotIn("personal", User.Role.values)
