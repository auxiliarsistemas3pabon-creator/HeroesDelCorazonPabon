from django.db import migrations, models


def personal_to_collaborator(apps, schema_editor):
    """Every evaluated-staff account ("personal") becomes a collaborator: it now evaluates and gets evaluated."""
    User = apps.get_model("users", "User")
    User.objects.filter(role="personal").update(role="collaborator")


class Migration(migrations.Migration):
    """Removes the "personal" role. Irreversible on the data side: after it runs nobody knows who was "personal",
    so the reverse step only restores the choice list (nobody gets the old role back)."""

    dependencies = [
        ("users", "0015_remove_two_factor_authentication"),
    ]

    operations = [
        migrations.RunPython(personal_to_collaborator, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="user",
            name="role",
            field=models.CharField(
                choices=[("superadmin", "Superadmin"), ("boss", "Area boss"), ("collaborator", "Collaborator")],
                default="collaborator",
                max_length=20,
                verbose_name="Role",
            ),
        ),
    ]
