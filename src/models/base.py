"""Base document model with common fields for all Shamwari AI CouchDB documents."""

from datetime import UTC, datetime

from pydantic import Field

from src.db.couch import CouchDocument


class TimestampedDocument(CouchDocument):
    """Base document with created_at and updated_at timestamps.

    All Shamwari AI document types inherit from this for consistent
    timestamp tracking. Maps to CouchDB documents with _id, _rev,
    type discriminator, and timestamps.
    """

    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
