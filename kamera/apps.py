from django.apps import AppConfig
import sys

class KameraConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'kamera'

    def ready(self):
        # Auto-run migrations on django server startup
        if 'runserver' in sys.argv:
            try:
                from django.core.management import call_command
                call_command('makemigrations', 'kamera')
                call_command('migrate')
                print("=== Migrations auto-applied on startup! ===")
            except Exception as e:
                print(f"=== Error auto-applying migrations: {e} ===")
