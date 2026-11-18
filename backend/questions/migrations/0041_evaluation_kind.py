from django.db import migrations, models


class Migration(migrations.Migration):
    """Tipo de programación: grupal (la de siempre) o individual (autoevaluación)."""

    dependencies = [
        ('questions', '0040_evaluation_source'),
    ]

    operations = [
        migrations.AddField(
            model_name='evaluation',
            name='kind',
            field=models.CharField(
                choices=[('group', 'Group'), ('self', 'Self-evaluation')],
                default='group',
                max_length=8,
                verbose_name='Kind',
            ),
        ),
    ]
