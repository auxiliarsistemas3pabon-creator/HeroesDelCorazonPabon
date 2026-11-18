from django.db import migrations


class Migration(migrations.Migration):
    """Se retira la doble autenticacion: el requisito es no exigir un segundo factor a navegadores normales."""

    dependencies = [
        ('users', '0014_two_factor_authentication'),
    ]

    operations = [
        migrations.RemoveField(model_name='user', name='totp_secret'),
        migrations.RemoveField(model_name='user', name='totp_enabled'),
        migrations.RemoveField(model_name='user', name='totp_last_step'),
        migrations.RemoveField(model_name='user', name='mfa_failed_attempts'),
        migrations.RemoveField(model_name='user', name='mfa_locked_until'),
        migrations.RemoveField(model_name='trusteddevice', name='mfa_verified_at'),
    ]
