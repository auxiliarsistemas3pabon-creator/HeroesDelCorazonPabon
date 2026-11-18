from django.core.management.base import BaseCommand, CommandError

from users.devices import release_devices
from users.models import User


class Command(BaseCommand):
    """Libera el dispositivo fijo de una cuenta (p. ej. si el unico superadmin perdio su navegador)."""
    help = "Release the browser linked to an account so its next login registers a new one."

    def add_arguments(self, parser):
        parser.add_argument("username", help="Username (document number) of the account.")

    def handle(self, *args, **options):
        user = User.objects.filter(username=options["username"]).first()
        if user is None:
            raise CommandError(f"User {options['username']} does not exist.")
        released = release_devices(user)
        self.stdout.write(self.style.SUCCESS(f"Released {released} device(s) for {user.username}."))
