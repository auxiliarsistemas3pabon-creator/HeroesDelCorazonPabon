"""Capa 24: validación de archivos subidos antes de abrirlos (extensión, tamaño y contenido real).

Las cargas (personal, evaluaciones, respuestas) abren el archivo con openpyxl o como CSV. Un archivo enorme, un
ejecutable renombrado a .xlsx o un "zip bomb" no deben llegar a ese punto: se rechazan aquí con un mensaje claro.
"""

import zipfile

from django.conf import settings

XLSX_MAGIC = b"PK\x03\x04"  # un .xlsx es un ZIP (Office Open XML)
MAX_XLSX_UNCOMPRESSED = 50 * 1024 * 1024  # contra zip bombs: ningún archivo de carga real se acerca a 50 MB


class UploadRejected(Exception):
    """El archivo no cumple las reglas de carga; el mensaje se muestra tal cual al usuario."""


def validate_upload(file, allowed=(".xlsx",)):
    """Valida `file` (UploadedFile de Django) y lo deja listo para leer desde el inicio. Lanza UploadRejected."""
    name = (getattr(file, "name", "") or "").lower()
    extension = name[name.rfind("."):] if "." in name else ""
    if extension not in allowed:
        raise UploadRejected(f"Tipo de archivo no permitido. Sube un archivo {' o '.join(allowed)}.")
    max_bytes = settings.UPLOAD_MAX_BYTES
    if file.size > max_bytes:
        raise UploadRejected(f"El archivo supera el máximo de {max_bytes // (1024 * 1024)} MB.")
    if file.size == 0:
        raise UploadRejected("El archivo está vacío.")

    head = file.read(4)
    file.seek(0)
    if extension == ".xlsx":
        if head != XLSX_MAGIC:
            raise UploadRejected("El archivo no es un Excel válido (.xlsx).")
        try:
            with zipfile.ZipFile(file) as archive:
                if sum(info.file_size for info in archive.infolist()) > MAX_XLSX_UNCOMPRESSED:
                    raise UploadRejected("El archivo Excel es demasiado grande al descomprimirlo.")
        except zipfile.BadZipFile as exc:
            raise UploadRejected("El archivo no es un Excel válido (.xlsx).") from exc
        finally:
            file.seek(0)
    elif extension == ".csv":
        # Un CSV es texto: un binario (ejecutable, imagen, ZIP) trae bytes nulos.
        sample = file.read(4096)
        file.seek(0)
        if b"\x00" in sample:
            raise UploadRejected("El archivo CSV no es texto válido.")
    return file
