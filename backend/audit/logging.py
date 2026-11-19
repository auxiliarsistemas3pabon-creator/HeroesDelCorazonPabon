"""Emisión de eventos de auditoría estructurados al sistema de logs de Django.

Cada evento se escribe en stdout (logger ``audit``) y además se guarda en la tabla de solo inserción
``audit.AuditEvent`` (capa 23), porque los logs de Render no se conservan. Nunca adjunta cuerpos,
contraseñas, cookies ni tokens.
"""

import json
import logging
from datetime import UTC, datetime

from django.db import transaction


class AuditJSONFormatter(logging.Formatter):
    """Serializa cada evento de auditoría como una línea JSON con fecha UTC."""

    def format(self, record):
        payload = {
            "timestamp": datetime.now(UTC).isoformat(),
            "level": record.levelname,
            **getattr(record, "audit_event", {}),
        }
        return json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str)


def record_event(
    *,
    action,
    actor=None,
    outcome="success",
    request=None,
    status_code=None,
    resource_id=None,
    metadata=None,
):
    """Registra una acción sin incluir credenciales ni contenido de la solicitud.

    ``request`` aporta actor, endpoint, método, IP y código HTTP; para eventos
    no asociados a una petición se puede pasar ``actor`` directamente.
    """
    user = getattr(request, "user", None) if request is not None else actor
    event = {
        "action": action,
        "outcome": outcome,
        "actor_id": user.pk if getattr(user, "is_authenticated", False) else None,
        "actor_role": getattr(user, "role", None) if getattr(user, "is_authenticated", False) else None,
    }

    if request is not None:
        from common.security import client_ip

        resolver_match = getattr(request, "resolver_match", None)
        event.update({
            "method": request.method,
            "path": request.path,
            "status_code": status_code,
            "endpoint": getattr(resolver_match, "url_name", None),
            # Detrás de Render REMOTE_ADDR es el proxy (127.0.0.1); la IP del cliente viene en X-Forwarded-For.
            "remote_addr": client_ip(request),
        })
    if resource_id is not None:
        event["resource_id"] = resource_id
    if metadata:
        event["metadata"] = metadata

    logging.getLogger("audit").info(action, extra={"audit_event": event})
    _persist(event, user, request)


def _persist(event, user, request):
    """Capa 23: guarda el evento en la base (solo inserción). Si falla, queda en el log y la petición sigue."""
    from .models import AuditEvent

    authenticated = getattr(user, "is_authenticated", False)
    try:
        # Savepoint propio: si la inserción falla dentro de una transacción abierta, no la deja inutilizable.
        with transaction.atomic():
            _create(AuditEvent, event, user, request, authenticated)
    except Exception:  # noqa: BLE001 - la auditoría nunca debe tumbar la petición que audita
        logging.getLogger("audit").exception("audit.persist_failed", extra={"audit_event": {"action": event["action"]}})


def _create(AuditEvent, event, user, request, authenticated):
    AuditEvent.objects.create(
        action=str(event["action"])[:150],
        outcome=str(event["outcome"])[:20],
        actor=user if authenticated else None,
        actor_username=(getattr(user, "username", "") if authenticated else "")[:150],
        actor_role=(event.get("actor_role") or "")[:20],
        method=(event.get("method") or "")[:10],
        path=(event.get("path") or "")[:300],
        status_code=event.get("status_code"),
        ip_address=(event.get("remote_addr") or "")[:64],
        user_agent=(request.META.get("HTTP_USER_AGENT", "") if request is not None else "")[:300],
        metadata={k: v for k, v in event.items() if k in {"endpoint", "resource_id", "metadata"} and v is not None},
    )
