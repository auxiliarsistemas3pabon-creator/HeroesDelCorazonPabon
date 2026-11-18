from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('users', '0010_trusted_device'),
    ]

    operations = [
        migrations.AddField(
            model_name='trusteddevice',
            name='session_jti',
            field=models.CharField(blank=True, default='', max_length=64),
        ),
    ]
