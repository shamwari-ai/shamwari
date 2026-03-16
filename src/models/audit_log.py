"""Audit log model — system-wide activity trail.

Immutable, append-only documents in shamwari_events CouchDB database.
Consumed by the analytics pipeline for compliance reporting.

Schema.org mapping: Action
"""

from datetime import UTC, datetime
from enum import StrEnum
from typing import Any

from pydantic import Field

from src.models.base import TimestampedDocument


class ActorType(StrEnum):
    USER = "user"
    SYSTEM = "system"
    API_KEY = "api_key"
    TRIGGER = "trigger"


class AuditLog(TimestampedDocument):
    """An immutable audit record of a system action.

    Captures who did what, when, and to which resource. Metadata stores
    before/after state for change tracking.

    CouchDB database: shamwari_events
    Document _id: "audit_{timestamp}_{uuid}"
    Schema.org @type: Action
    """

    type: str = "audit_log"
    actor_id: str
    actor_type: ActorType
    action: str = Field(description="e.g., api_key.create, org.member.add, model.deploy")
    resource_type: str = Field(description="e.g., api_key, organization, model")
    resource_id: str
    metadata: dict[str, Any] = Field(
        default_factory=dict, description="before/after state, additional context"
    )
    ip_address: str | None = None
    user_agent: str | None = None
    timestamp: datetime = Field(default_factory=lambda: datetime.now(UTC))
