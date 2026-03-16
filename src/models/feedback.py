"""Feedback model — user ratings on AI responses.

Stored in shamwari_events CouchDB database for analytics pipeline consumption.
Used for model quality tracking, language-specific performance, and RLHF data.

Schema.org mapping: Review
"""

from datetime import UTC, datetime
from enum import StrEnum

from pydantic import Field

from src.models.base import TimestampedDocument


class FeedbackRating(StrEnum):
    THUMBS_UP = "thumbs_up"
    THUMBS_DOWN = "thumbs_down"


class FeedbackCategory(StrEnum):
    INACCURATE = "inaccurate"
    OFFENSIVE = "offensive"
    UNHELPFUL = "unhelpful"
    WRONG_LANGUAGE = "wrong_language"
    TOO_SLOW = "too_slow"
    OTHER = "other"


class Feedback(TimestampedDocument):
    """User feedback on a specific AI message.

    Used for model quality analytics and RLHF training data.
    Language-tagged for per-language performance tracking.

    CouchDB database: shamwari_events
    Document _id: "fb_{uuid}"
    Schema.org @type: Review
    """

    type: str = "feedback"
    message_id: str
    conversation_id: str
    user_id: str
    model_id: str
    rating: FeedbackRating
    categories: list[FeedbackCategory] = Field(default_factory=list)
    comment: str | None = None
    language: str | None = Field(default=None, description="Language of the rated message")
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
