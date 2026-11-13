"""Settings para ejecutar pruebas: igual que dev, con un hasher rapido (solo tests)."""
from .dev import *  # noqa: F401,F403

PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
