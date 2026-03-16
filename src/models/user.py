"""User profile model — stored in per-user CouchDB database.

Auth is handled by Stytch. This document stores application-specific
profile data linked by stytch_user_id. Each user's profile lives in
their own database (shamwari_user_{id}) alongside their conversations.

Schema.org mapping: Person
"""

from datetime import UTC, datetime
from enum import StrEnum

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


class ModelDownloadState(StrEnum):
    PENDING = "pending"
    DOWNLOADING = "downloading"
    COMPLETE = "complete"
    FAILED = "failed"


class User(TimestampedDocument):
    """A Shamwari AI user profile.

    Stored as the 'profile' document in each user's per-user CouchDB database.
    Linked to Stytch via stytch_user_id. No passwords stored —
    Stytch owns the credential layer.

    CouchDB database: shamwari_user_{stytch_user_id}
    Document _id: "profile"
    Schema.org @type: Person
    """

    type: str = "user_profile"
    stytch_user_id: str
    email: EmailStr
    display_name: str
    avatar_url: str | None = None
    role: UserRole = UserRole.CONSUMER
    organization_ids: list[str] = Field(default_factory=list)
    preferences: UserPreferences = Field(default_factory=UserPreferences)
    model_download_state: ModelDownloadState = ModelDownloadState.PENDING
    model_version: str | None = None
    last_active_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    is_active: bool = True
