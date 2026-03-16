"""Feedback API schemas — Schema.org Review alignment."""

from datetime import datetime

from pydantic import BaseModel, Field

from src.schemas.base import SchemaOrgMixin


class FeedbackResponse(SchemaOrgMixin):
    """Feedback response.

    Schema.org @type: Review
    Maps: rating → reviewRating, comment → reviewBody
    """

    schema_type: str = Field(default="Review", alias="@type", serialization_alias="@type")
    id: str = Field(description="Feedback document ID")
    message_id: str
    conversation_id: str
    review_rating: str = Field(description="Rating (Schema.org: reviewRating)")
    review_body: str | None = Field(
        default=None, description="Comment text (Schema.org: reviewBody)"
    )
    categories: list[str] = Field(default_factory=list)
    in_language: str | None = Field(
        default=None, description="Language of rated message (Schema.org: inLanguage)"
    )
    created_at: datetime


class FeedbackCreateRequest(BaseModel):
    """Create feedback request."""

    message_id: str
    conversation_id: str
    rating: str = Field(description="thumbs_up or thumbs_down")
    categories: list[str] = Field(default_factory=list)
    comment: str | None = Field(default=None, max_length=1000)
