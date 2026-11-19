from django.utils.translation import gettext_lazy as _
from rest_framework.permissions import BasePermission

from users.models import User


# Permisos por rol. Cada uno exige usuario autenticado y rol exacto (no jerarquico: un superadmin no es boss).
class IsSuperAdmin(BasePermission):
    message = _("Only a superadmin can perform this action.")

    def has_permission(self,request,view):
        user = request.user
        return bool(user and user.is_authenticated and user.role == User.Role.SUPERADMIN)


class IsCollaborator(BasePermission):
    """Evaluar y autoevaluarse: colaboradores y también el coordinador (boss), que participa como colaborador."""

    message = _("Only a collaborator can perform this action.")

    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated and user.role in User.PARTICIPANT_ROLES)


class IsBoss(BasePermission):
    message = _("Only the area boss can perform this action.")

    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated and user.role == User.Role.BOSS)


# Roles que gestionan evaluaciones: el jefe (solo las suyas) y el superadmin (todas).
MANAGER_ROLES = (User.Role.BOSS, User.Role.SUPERADMIN)


class IsBossOrSuperAdmin(BasePermission):
    message = _("Only the area boss or a superadmin can perform this action.")

    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated and user.role in MANAGER_ROLES)


def acts_as_manager(request):
    """True when the request gets the manager view (every evaluation, closed ones included, with progress).

    The boss is also a participant: on the "Evaluar"/"Autoevaluación" pages the frontend sends ?participant=1 and the
    boss gets exactly the collaborator view (open evaluations of their area, own quota). The superadmin never participates.
    """
    user = request.user
    as_participant = request.query_params.get("participant") == "1" and user.role in User.PARTICIPANT_ROLES
    return user.role in MANAGER_ROLES and not as_participant


def owned_by(user, field="created_by"):
    """Filtro de pertenencia: el jefe solo ve lo que creó; el superadmin no se restringe."""
    return {} if user.role == User.Role.SUPERADMIN else {field: user}
