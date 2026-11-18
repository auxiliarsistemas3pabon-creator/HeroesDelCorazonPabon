from django.db import migrations


class Migration(migrations.Migration):
    """Se retira la regla de una sola sesion activa: el bloqueo de incognito se gestiona por politica del navegador."""

    dependencies = [
        ('users', '0011_trusteddevice_session_jti'),
    ]

    operations = [
        migrations.RemoveField(
            model_name='trusteddevice',
            name='session_jti',
        ),
    ]
