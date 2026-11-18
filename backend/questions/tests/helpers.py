from common.testing import random_password, username_for
from users.models import User

# Generada al azar en cada ejecución: no hay contraseñas escritas en los tests.
PASSWORD = random_password()
CRITERIA = ["META", "EFECTIVA", "PRODUCTIVIDAD", "IMPLEMENTA", "APRENDIZAJE", "RECEPTIVA", "RESPETA", "ESCUCHA", "FOMENTA", "INTERACCION", "CONOCIMIENTO", "DISPOSICION"]
ALL_SCORES = {c: 4 for c in CRITERIA}


def create_user(label, role, area="Emergency"):
    """`label` identifica al usuario en la prueba; su nombre de usuario real es aleatorio (ver username_for)."""
    username = username_for(label)
    return User.objects.create_user(
        username=username, email=f"{username}@example.invalid", password=PASSWORD,
        first_name="Demo", last_name="Fictional", role=role, area=area,
    )
