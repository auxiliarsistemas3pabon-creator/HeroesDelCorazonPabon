from django.contrib import admin

from .models import AuditEvent


@admin.register(AuditEvent)
class AuditEventAdmin(admin.ModelAdmin):
    """Solo lectura: se puede consultar y filtrar, nunca crear, editar ni borrar."""

    list_display = ("created_at", "action", "outcome", "status_code", "actor_username", "actor_role", "ip_address")
    list_filter = ("outcome", "actor_role", "method")
    search_fields = ("action", "actor_username", "ip_address", "path")
    date_hierarchy = "created_at"

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
