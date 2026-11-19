"""Registro de auditoría persistente (capa 23): quién hizo qué, cuándo, desde dónde y con qué resultado.

Es de solo inserción: un evento guardado no se puede modificar ni borrar desde la aplicación ni desde el admin.
Nunca guarda cuerpos de petición, contraseñas, cookies ni tokens (ver audit.logging.record_event).
"""

from django.conf import settings
from django.db import models


class AppendOnlyError(Exception):
    """Un evento de auditoría ya guardado no se modifica ni se elimina."""


class AuditEventQuerySet(models.QuerySet):
    def update(self, **kwargs):
        raise AppendOnlyError("Los eventos de auditoría no se modifican.")

    def delete(self):
        raise AppendOnlyError("Los eventos de auditoría no se eliminan.")


class AuditEvent(models.Model):
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    action = models.CharField(max_length=150, db_index=True)
    outcome = models.CharField(max_length=20)
    # SET_NULL: el evento sobrevive aunque la cuenta se elimine; actor_username conserva quién fue.
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    actor_username = models.CharField(max_length=150, blank=True)
    actor_role = models.CharField(max_length=20, blank=True)
    method = models.CharField(max_length=10, blank=True)
    path = models.CharField(max_length=300, blank=True)
    status_code = models.PositiveSmallIntegerField(null=True, blank=True)
    ip_address = models.CharField(max_length=64, blank=True)
    user_agent = models.CharField(max_length=300, blank=True)
    metadata = models.JSONField(default=dict, blank=True)

    objects = AuditEventQuerySet.as_manager()

    class Meta:
        verbose_name = "Evento de auditoría"
        verbose_name_plural = "Eventos de auditoría"
        ordering = ["-created_at", "-id"]
        indexes = [models.Index(fields=["actor", "created_at"], name="audit_actor_created_idx")]

    def save(self, *args, **kwargs):
        if self.pk is not None:
            raise AppendOnlyError("Los eventos de auditoría no se modifican.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise AppendOnlyError("Los eventos de auditoría no se eliminan.")

    def __str__(self):
        return f"{self.created_at:%Y-%m-%d %H:%M} {self.action} {self.outcome}"
