"""Organization API schemas — Schema.org Organization alignment."""

from datetime import datetime

from pydantic import BaseModel, Field

from src.schemas.base import SchemaOrgMixin


class OrganizationMemberResponse(BaseModel):
    """Organization member (public projection)."""

    user_id: str
    role: str = Field(description="Member role: owner, admin, member, billing")
    joined_at: str


class OrganizationResponse(SchemaOrgMixin):
    """Organization response.

    Schema.org @type: Organization
    Maps: name → name, slug → url, description → description
    """

    schema_type: str = Field(default="Organization", alias="@type", serialization_alias="@type")
    id: str = Field(description="Organization document ID")
    name: str = Field(description="Organization name (Schema.org: name)")
    url: str = Field(description="Organization slug (Schema.org: url)")
    description: str = Field(default="", description="Schema.org: description")
    owner_id: str
    member_count: int = Field(description="Number of members (Schema.org: numberOfEmployees)")
    is_active: bool
    created_at: datetime


class OrganizationCreateRequest(BaseModel):
    """Create organization request."""

    name: str = Field(min_length=1, max_length=100)
    slug: str = Field(min_length=1, max_length=50, pattern=r"^[a-z0-9-]+$")
    description: str = Field(default="", max_length=500)


class OrganizationUpdateRequest(BaseModel):
    """Update organization request."""

    name: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=500)
