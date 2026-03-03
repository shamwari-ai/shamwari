"""Feedback model — user ratings on AI responses.

Separate collection (not embedded in messages) for independent analytics
queries: model quality tracking, language-specific performance, RLHF data.
"""

from datetime import UTC, datetime
from enum import StrEnum

from beanie import Indexed
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
    """

    message_id: str
    conversation_id: str
    user_id: str
    model_id: Indexed(str)  # type: ignore[valid-type]
    rating: FeedbackRating
    categories: list[FeedbackCategory] = Field(default_factory=list)
    comment: str | None = None
    language: str | None = Field(default=None, description="Language of the rated message")
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

    class Settings:
        name = "feedback"
        use_state_management = True
        indexes = [
            [("model_id", 1), ("created_at", -1)],
            [("rating", 1)],
            [("language", 1), ("rating", 1)],
        ]
