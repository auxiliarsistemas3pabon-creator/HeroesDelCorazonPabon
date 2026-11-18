import random

from django.utils import timezone

from users.models import User

from .models import Evaluation, EvaluationSetting, Question


def monthly_limit(evaluation=None):
    """How many colleagues a collaborator can score per month in this evaluation."""
    if evaluation is not None:
        # A per-evaluation value wins; otherwise use the configurable global default.
        # Always clamped to 1..MAX so a bad stored value can never block everyone or allow unlimited answers.
        value = evaluation.monthly_limit if evaluation.monthly_limit is not None else EvaluationSetting.current().monthly_limit
        return max(1, min(value, EvaluationSetting.MAX_MONTHLY_LIMIT))
    return max(1, min(EvaluationSetting.current().monthly_limit, EvaluationSetting.MAX_MONTHLY_LIMIT))


def month_start():
    """First instant of the current month in local time; the monthly quota window starts here."""
    return timezone.localtime().replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def scored_this_month(collaborator, evaluation):
    """Ids of the colleagues this collaborator already scored in `evaluation` during the current month.

    Each evaluation has its own quota: a colleague can be scored once per month in every evaluation.
    Reprogramming the evaluation starts a new round, so earlier answers stop counting.
    """
    since = month_start()
    if evaluation.program_started_at and evaluation.program_started_at > since:
        since = evaluation.program_started_at
    return set(
        Question.objects.filter(collaborator=collaborator, evaluation=evaluation, created_at__gte=since)
        .values_list("personal_id", flat=True)
    )


def assigned_personal(collaborator, evaluation):
    """Ids of the people the system assigns to `collaborator` in a random-selection evaluation (monthly_limit of them).

    The draw is deterministic for (evaluation, collaborator, round): it never changes between requests, and already scored
    people stay in it, so the collaborator just works through a fixed list. A new month or reprogramming starts a new draw.
    """
    pool = User.objects.filter(role__in=[User.Role.COLLABORATOR, User.Role.PERSONAL], is_active=True, area=collaborator.area).exclude(pk=collaborator.pk)
    if collaborator.area == "":
        return []
    if evaluation.personal_ids:
        pool = pool.filter(pk__in=evaluation.personal_ids)
    since = month_start()
    if evaluation.program_started_at and evaluation.program_started_at > since:
        since = evaluation.program_started_at
    ids = sorted(pool.values_list("pk", flat=True))
    random.Random(f"{evaluation.pk}:{collaborator.pk}:{since.isoformat()}").shuffle(ids)
    return ids[: monthly_limit(evaluation)]


def round_start(evaluation):
    """Start of the current round: the month start, or the last reprogramming if it is more recent."""
    since = month_start()
    if evaluation.program_started_at and evaluation.program_started_at > since:
        since = evaluation.program_started_at
    return since


def evaluation_progress(evaluation):
    """Progress of the current round, counted in evaluations (one evaluation = one collaborator scoring one person).

    Each enabled collaborator must score min(monthly limit, eligible people of their area). Returns
    total (expected), done, pending (= total - done) and the collaborators that still owe evaluations.
    Uses the same eligibility rules a collaborator sees: areas, evaluator_ids and personal_ids of the evaluation.
    A form that was never programmed (no programmed copy origin and never reprogrammed) expects nothing yet.
    """
    if evaluation.source_id is None and evaluation.program_started_at is None:
        return {"total": 0, "done": 0, "pending": 0, "pending_evaluators": []}
    people = list(
        User.objects.filter(role__in=[User.Role.COLLABORATOR, User.Role.PERSONAL], is_active=True)
        .exclude(area="")
        .values("pk", "role", "area", "first_name", "last_name", "username")
    )
    evaluators = [
        person for person in people
        if person["role"] == User.Role.COLLABORATOR
        and (evaluation.areas is None or person["area"] in evaluation.areas)
        and (not evaluation.evaluator_ids or person["pk"] in evaluation.evaluator_ids)
    ]
    scored = {}
    for collaborator_id, personal_id in (
        Question.objects.filter(evaluation=evaluation, created_at__gte=round_start(evaluation))
        .values_list("collaborator_id", "personal_id")
        .distinct()
    ):
        scored.setdefault(collaborator_id, set()).add(personal_id)

    limit = monthly_limit(evaluation)
    total = done = 0
    missing = []
    for evaluator in evaluators:
        eligible = {
            person["pk"] for person in people
            if person["area"] == evaluator["area"] and person["pk"] != evaluator["pk"]
            and (not evaluation.personal_ids or person["pk"] in evaluation.personal_ids)
        }
        quota = min(limit, len(eligible))
        made = min(len(scored.get(evaluator["pk"], set()) & eligible), quota)
        total += quota
        done += made
        if made < quota:
            name = f"{evaluator['first_name']} {evaluator['last_name']}".strip() or evaluator["username"]
            missing.append({"id": evaluator["pk"], "name": name, "missing": quota - made})
    missing.sort(key=lambda item: item["name"].lower())
    return {"total": total, "done": done, "pending": total - done, "pending_evaluators": missing}


def find_evaluation(raw, open_only=True):
    """The evaluation with that id, or (no id given) the only one there is. None if it cannot be decided."""
    evaluations = Evaluation.objects.available() if open_only else Evaluation.objects.all()
    if raw in (None, ""):
        found = list(evaluations[:2])
        return found[0] if len(found) == 1 else None
    return evaluations.filter(pk=raw).first() if str(raw).isdigit() else None
