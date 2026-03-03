"""Audit log model — system-wide activity trail.

Immutable, append-only collection for security and compliance.
TTL index expires records after 365 days.
"""

from datetime import UTC, datetime
from enum import StrEnum
from typing import Any

from beanie import Indexed
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
    before/after state for change tracking. TTL: 365 days.
    """

    actor_id: Indexed(str)  # type: ignore[valid-type]
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

    class Settings:
        name = "audit_logs"
        use_state_management = True
        indexes = [
            [("timestamp", 1)],
            [("actor_id", 1), ("timestamp", -1)],
            [("resource_type", 1), ("resource_id", 1)],
        ]
