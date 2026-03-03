"""User model — consumer (shamwari.ai) and developer (platform.shamwari.ai) accounts.

Auth is handled by Stytch (Mukoko B2C identity). This model stores the
application-specific profile data linked by stytch_user_id.
"""

from datetime import UTC, datetime
from enum import StrEnum

from beanie import Indexed
from pydantic import BaseModel, EmailStr, Field

from src.models.base import TimestampedDocument


class UserRole(StrEnum):
    CONSUMER = "consumer"
    DEVELOPER = "developer"
    ADMIN = "admin"


class UserPreferences(BaseModel):
    """Embedded: user preferences for UI and AI interaction."""

    language: str = Field(default="en", description="ISO 639-1 code (en, sn, nd)")
    theme: str = Field(default="system", description="light | dark | system")
    notifications_enabled: bool = True
    default_model_slug: str | None = None


class User(TimestampedDocument):
    """A Shamwari AI user account.

    Linked to Stytch via stytch_user_id. No passwords stored here —
    Stytch owns the credential layer as part of Mukoko identity.
    """

    stytch_user_id: Indexed(str, unique=True)  # type: ignore[valid-type]
    email: Indexed(EmailStr, unique=True)  # type: ignore[valid-type]
    display_name: str
    avatar_url: str | None = None
    role: UserRole = UserRole.CONSUMER
    organization_ids: list[str] = Field(default_factory=list)
    preferences: UserPreferences = Field(default_factory=UserPreferences)
    last_active_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    is_active: bool = True

    class Settings:
        name = "users"
        use_state_management = True
