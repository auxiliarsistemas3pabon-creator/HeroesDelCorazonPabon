import django.db.models.deletion
from django.db import migrations, models


def link_existing_copies(apps, schema_editor):
    """Marks programmed copies created before this field existed.

    A programmed copy keeps the name and rating type of its form and belongs to the same boss, so within each
    (created_by, name, rating_type) group the oldest evaluation is the original and the rest are its copies.
    """
    Evaluation = apps.get_model("questions", "Evaluation")
    originals = {}
    for evaluation in Evaluation.objects.order_by("pk"):
        key = (evaluation.created_by_id, evaluation.name.strip().lower(), evaluation.rating_type)
        original_id = originals.setdefault(key, evaluation.pk)
        if original_id != evaluation.pk:
            Evaluation.objects.filter(pk=evaluation.pk).update(source_id=original_id)


class Migration(migrations.Migration):

    dependencies = [
        ("questions", "0039_evaluation_evaluator_ids"),
    ]

    operations = [
        migrations.AddField(
            model_name="evaluation",
            name="source",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="programs",
                to="questions.evaluation",
                verbose_name="Programmed from",
            ),
        ),
        migrations.RunPython(link_existing_copies, migrations.RunPython.noop),
    ]
