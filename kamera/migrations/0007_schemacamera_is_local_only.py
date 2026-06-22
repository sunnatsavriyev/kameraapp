from django.db import migrations, models


def mark_local_cameras(apps, schema_editor):
    SchemaCamera = apps.get_model('kamera', 'SchemaCamera')
    for cam in SchemaCamera.objects.all():
        ip = (cam.ip_address or '').strip()
        parts = ip.split('.')
        if len(parts) != 4:
            continue
        try:
            a, b = int(parts[0]), int(parts[1])
        except ValueError:
            continue
        local = (
            a in (10, 11, 22, 127)
            or (a == 192 and b == 168)
            or (a == 172 and 16 <= b <= 31)
            or (a == 169 and b == 254)
        )
        if local:
            cam.is_local_only = True
            cam.save(update_fields=['is_local_only'])


class Migration(migrations.Migration):

    dependencies = [
        ('kamera', '0006_schemacamera'),
    ]

    operations = [
        migrations.AddField(
            model_name='schemacamera',
            name='is_local_only',
            field=models.BooleanField(default=False, verbose_name='Faqat lokal tarmoq'),
        ),
        migrations.RunPython(mark_local_cameras, migrations.RunPython.noop),
    ]
