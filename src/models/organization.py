"""Organization model — business/team accounts for platform.shamwari.ai.

Organizations own API keys, subscriptions, and usage quotas.
Stored in the shared shamwari_platform CouchDB database.

Schema.org mapping: Organization
"""

from enum import StrEnum

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

    CouchDB database: shamwari_platform
    Document _id: "org_{slug}"
    Schema.org @type: Organization
    """

    type: str = "organization"
    name: str
    slug: str
    description: str = ""
    owner_id: str
    members: list[OrganizationMember] = Field(default_factory=list)
    settings: OrganizationSettings = Field(default_factory=OrganizationSettings)
    is_active: bool = True
