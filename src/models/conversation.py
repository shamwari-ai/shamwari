"""Conversation model — chat sessions on shamwari.ai.

Messages are stored in a separate collection (referenced, not embedded)
because conversations can grow unbounded and would hit MongoDB's 16MB
document size limit.
"""

from beanie import Indexed
from pydantic import Field

from src.models.base import TimestampedDocument


class Conversation(TimestampedDocument):
    """A chat conversation between a user and Shamwari AI.

    Owns messages via conversation_id reference in the messages collection.
    Tracks aggregate token usage for billing/analytics.
    """

    user_id: Indexed(str)  # type: ignore[valid-type]
    title: str = "New conversation"
    model_slug: str = Field(description="Which AI model is used for this chat")
    language: str = Field(default="en", description="Primary language (ISO 639-1)")
    message_count: int = 0
    total_tokens_used: int = 0
    system_prompt: str | None = None
    is_archived: bool = False

    class Settings:
        name = "conversations"
        use_state_management = True
        indexes = [
            [("user_id", 1), ("created_at", -1)],
            [("user_id", 1), ("is_archived", 1)],
        ]
