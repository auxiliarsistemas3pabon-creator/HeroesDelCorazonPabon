from django.db import migrations


def release_all(apps, schema_editor):
    # Antes cada cuenta podia tener hasta 5 navegadores. Con el dispositivo fijo se liberan todos una vez:
    # el siguiente inicio de sesion de cada usuario registra su unico navegador.
    apps.get_model("users", "TrustedDevice").objects.filter(revoked=False).update(revoked=True)


class Migration(migrations.Migration):

    dependencies = [
        ('users', '0012_remove_trusteddevice_session_jti'),
    ]

    operations = [
        migrations.RunPython(release_all, migrations.RunPython.noop),
    ]
