from django.db import migrations


def translate_roles(apps, schema_editor, reverse=False):
    User = apps.get_model('users', 'User')
    alias = schema_editor.connection.alias
    pairs = [('jefe', 'boss'), ('colaborador', 'collaborator')]
    if reverse:
        pairs = [(new, old) for old, new in pairs]
    for old, new in pairs:
        User.objects.using(alias).filter(rol=old).update(rol=new)


def untranslate_roles(apps, schema_editor):
    translate_roles(apps, schema_editor, reverse=True)


class Migration(migrations.Migration):
    """Keeps the data: jefe -> boss, colaborador -> collaborator."""

    dependencies = [
        ('users', '0001_initial'),
    ]

    operations = [
        migrations.RunPython(translate_roles, untranslate_roles),
    ]
