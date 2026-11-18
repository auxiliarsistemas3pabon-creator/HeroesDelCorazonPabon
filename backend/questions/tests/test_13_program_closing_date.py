from datetime import timedelta

from django.utils import timezone
from rest_framework.test import APITestCase

from users.models import User

from ..models import Evaluation
from .helpers import create_user

PAST_MESSAGE = ["La fecha de cierre debe ser igual o posterior a la fecha actual."]


class ProgramClosingDateTests(APITestCase):
    def setUp(self):
        self.boss = create_user("closing.boss", User.Role.BOSS)
        self.form = Evaluation.objects.create(name="Desempeño", created_by=self.boss, monthly_limit=3)
        self.client.force_authenticate(self.boss)

    def program(self, day):
        return self.client.post(
            f"/api/v1/questions/evaluations/{self.form.pk}/programs/",
            {"closes_on": day.isoformat(), "areas": None, "personal_ids": [], "monthly_limit": 3},
            format="json",
        )

    def test_cannot_program_with_a_past_date(self):
        response = self.program(timezone.localdate() - timedelta(days=1))
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["closes_on"], PAST_MESSAGE)
        self.assertFalse(Evaluation.objects.filter(source=self.form).exists())

    def test_today_and_future_dates_are_allowed(self):
        self.assertEqual(self.program(timezone.localdate()).status_code, 201)
        self.assertEqual(self.program(timezone.localdate() + timedelta(days=10)).status_code, 201)

    def test_editing_rejects_moving_the_date_to_the_past(self):
        response = self.client.patch(
            f"/api/v1/questions/evaluations/{self.form.pk}/",
            {"closes_on": (timezone.localdate() - timedelta(days=1)).isoformat()},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["closes_on"], PAST_MESSAGE)

    def test_editing_keeps_requiring_today_or_later_even_if_the_date_did_not_change(self):
        # Al editar una programación la fecha debe ser hoy o posterior, aunque sea la misma que ya tenía.
        self.client.force_authenticate(create_user("closing.admin", User.Role.SUPERADMIN))
        past = timezone.localdate() - timedelta(days=5)
        Evaluation.objects.filter(pk=self.form.pk).update(closes_on=past)
        url = f"/api/v1/questions/evaluations/{self.form.pk}/"
        response = self.client.patch(url, {"closes_on": past.isoformat(), "random_selection": True}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["closes_on"], PAST_MESSAGE)
        today = timezone.localdate().isoformat()
        self.assertEqual(self.client.patch(url, {"closes_on": today, "random_selection": True}, format="json").status_code, 200)
