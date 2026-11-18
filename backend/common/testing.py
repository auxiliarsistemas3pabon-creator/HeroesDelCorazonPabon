"""Credenciales de prueba generadas al azar en cada ejecución.

En los tests no se escribe ninguna contraseña ni nombre de usuario: el código usa una *etiqueta*
(p. ej. "colab", "boss") que identifica el papel dentro de la prueba, y `username_for(etiqueta)` devuelve
un nombre de usuario aleatorio, el mismo para esa etiqueta durante toda la ejecución. Las contraseñas
también se generan al azar, así que solo existen en memoria mientras corren las pruebas.
"""

import secrets

_USERNAMES = {}


def random_password() -> str:
    """Contraseña válida para los validadores de Django (larga, con letras, dígitos y símbolo, no común)."""
    return f"Tz{secrets.token_urlsafe(12)}9!"


def random_digits(length: int) -> str:
    """Solo dígitos: para probar que se rechazan las contraseñas débiles/numéricas."""
    return "".join(secrets.choice("0123456789") for _ in range(length))


def username_for(label: str) -> str:
    """Nombre de usuario aleatorio asociado a una etiqueta de prueba (estable durante la ejecución)."""
    if label not in _USERNAMES:
        _USERNAMES[label] = f"u{secrets.token_hex(6)}"
    return _USERNAMES[label]
