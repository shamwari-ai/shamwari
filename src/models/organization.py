"""Organization model — business/team accounts for platform.shamwari.ai.

Organizations own API keys, subscriptions, and usage quotas.
Members are embedded (bounded array, always read together).
"""

from enum import StrEnum

from beanie import Indexed
from pydantic import BaseModel, Field

from src.models.base import TimestampedDocument


class MemberRole(StrEnum):
    OWNER = "owner"
    ADMIN = "admin"
    MEMBER = "member"
    BILLING = "billing"


class OrganizationMember(BaseModel):
    """Embedded: a user's membership in an organization."""

    user_id: str
    role: MemberRole
    joined_at: str  # ISO 8601 datetime string


class OrganizationSettings(BaseModel):
    """Embedded: org-level configuration."""

    default_model_slug: str | None = None
    rate_limit_rpm: int = 60
    webhook_url: str | None = None


class Organization(TimestampedDocument):
    """A business or team account on platform.shamwari.ai.

    Owns API keys, subscriptions, and has members with roles.
    Members embedded because the array is bounded and always read together.
    """

    name: str
    slug: Indexed(str, unique=True)  # type: ignore[valid-type]
    description: str = ""
    owner_id: Indexed(str)  # type: ignore[valid-type]
    members: list[OrganizationMember] = Field(default_factory=list)
    settings: OrganizationSettings = Field(default_factory=OrganizationSettings)
    is_active: bool = True

    class Settings:
        name = "organizations"
        use_state_management = True
