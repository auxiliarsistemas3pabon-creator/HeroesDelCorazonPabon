from django.core.management.base import BaseCommand, CommandError

from questions.limits import evaluation_progress
from questions.models import Evaluation


class Command(BaseCommand):
    """Deshace el reinicio de ronda que provoca editar una programación, sin borrar la programación.

    Editar fecha, áreas o personas estampa `program_started_at` y empieza una ronda nueva: las evaluaciones
    ya realizadas dejan de contar. Este comando devuelve el inicio de la ronda al momento en que se creó la
    programación, de modo que vuelven a contar. Los demás campos (fecha, áreas, personas, límite) se mantienen
    como están: no existe historial de sus valores anteriores.

    Por defecto solo muestra lo que cambiaría; con --apply guarda el cambio.
    """

    help = "Restore the round start of a programmed evaluation to its creation time (undo the last reprogramming reset)."

    def add_arguments(self, parser):
        parser.add_argument("evaluation_id", type=int, help="Id of the programmed evaluation.")
        parser.add_argument("--apply", action="store_true", help="Save the change (without it, only a preview is shown).")

    def handle(self, *args, **options):
        evaluation = Evaluation.objects.filter(pk=options["evaluation_id"]).first()
        if evaluation is None:
            raise CommandError(f"Evaluation {options['evaluation_id']} does not exist.")
        if evaluation.source_id is None:
            raise CommandError("That evaluation is an original form, not a programming.")

        before = evaluation_progress(evaluation)
        self.stdout.write(f"{evaluation.pk} «{evaluation.name}»")
        self.stdout.write(f"  round start: {evaluation.program_started_at} -> {evaluation.created_at}")
        self.stdout.write(f"  progress now: total={before['total']} done={before['done']} pending={before['pending']}")

        if evaluation.program_started_at == evaluation.created_at:
            self.stdout.write("  Nothing to restore: the round already starts at the programming creation.")
            return

        original_start = evaluation.program_started_at
        evaluation.program_started_at = evaluation.created_at
        after = evaluation_progress(evaluation)
        self.stdout.write(f"  progress after: total={after['total']} done={after['done']} pending={after['pending']}")

        if not options["apply"]:
            evaluation.program_started_at = original_start
            self.stdout.write(self.style.WARNING("  Preview only. Run again with --apply to save it."))
            return
        evaluation.save(update_fields=["program_started_at"])
        self.stdout.write(self.style.SUCCESS("  Round start restored; the programming itself was not deleted."))
