"""User API schemas — Schema.org Person alignment.

Public-facing user profile representation. Excludes internal fields
like stytch_user_id.
"""

from datetime import datetime

from pydantic import BaseModel, Field

from src.schemas.base import SchemaOrgMixin


class UserPreferencesResponse(BaseModel):
    """User preferences (public projection)."""

    language: str = Field(description="ISO 639-1 preferred language code")
    theme: str = Field(description="UI theme: light, dark, or system")
    notifications_enabled: bool
    default_model_slug: str | None = None


class UserResponse(SchemaOrgMixin):
    """User profile response.

    Schema.org @type: Person
    Maps: display_name → name, avatar_url → image, email → email
    """

    schema_type: str = Field(default="Person", alias="@type", serialization_alias="@type")
    id: str = Field(description="User identifier")
    name: str = Field(description="Display name (Schema.org: name)")
    email: str = Field(description="Email address (Schema.org: email)")
    image: str | None = Field(default=None, description="Avatar URL (Schema.org: image)")
    role: str = Field(description="User role: consumer, developer, admin")
    preferences: UserPreferencesResponse
    organization_ids: list[str] = Field(default_factory=list)
    is_active: bool
    last_active_at: datetime
    created_at: datetime


class UserUpdateRequest(BaseModel):
    """Update user profile request."""

    name: str | None = Field(default=None, description="New display name")
    image: str | None = Field(default=None, description="New avatar URL")
    preferences: UserPreferencesResponse | None = None
