from django.core.management.base import BaseCommand, CommandError

from users.mfa import reset_mfa
from users.models import User


class Command(BaseCommand):
    """Reinicia la doble autenticacion de una cuenta (p. ej. si el unico superadmin perdio el celular)."""
    help = "Reset two-factor authentication: the next login shows a new QR code and open sessions are closed."

    def add_arguments(self, parser):
        parser.add_argument("username", help="Username (document number) of the account.")

    def handle(self, *args, **options):
        user = User.objects.filter(username=options["username"]).first()
        if user is None:
            raise CommandError(f"User {options['username']} does not exist.")
        reset_mfa(user)
        self.stdout.write(self.style.SUCCESS(f"Two-factor authentication reset for {user.username}."))
