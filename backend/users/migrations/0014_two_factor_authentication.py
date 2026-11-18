from django.db import migrations, models


class Migration(migrations.Migration):
    """Doble autenticacion (TOTP) condicionada por dispositivo de confianza."""

    dependencies = [
        ('users', '0013_release_all_devices_for_fixed_device'),
    ]

    operations = [
        migrations.AddField(model_name='user', name='totp_secret', field=models.CharField(blank=True, default='', max_length=64)),
        migrations.AddField(model_name='user', name='totp_enabled', field=models.BooleanField(default=False)),
        migrations.AddField(model_name='user', name='totp_last_step', field=models.BigIntegerField(default=-1)),
        migrations.AddField(model_name='user', name='mfa_failed_attempts', field=models.PositiveSmallIntegerField(default=0)),
        migrations.AddField(model_name='user', name='mfa_locked_until', field=models.DateTimeField(blank=True, null=True)),
        migrations.AddField(model_name='trusteddevice', name='mfa_verified_at', field=models.DateTimeField(blank=True, null=True)),
    ]
