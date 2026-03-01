"""Base document model with common fields for all Shamwari AI collections."""

from datetime import UTC, datetime

from beanie import Document
from pydantic import Field


class TimestampedDocument(Document):
    """Base document with created_at and updated_at timestamps.

    All Shamwari AI collections inherit from this to get consistent
    timestamp tracking. updated_at is refreshed on every save via
    Beanie's save() override or update operations.
    """

    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

    class Settings:
        use_state_management = True
