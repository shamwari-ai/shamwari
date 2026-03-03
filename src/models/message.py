"""Message model — individual messages within a conversation.

Stored in a separate collection from conversations to avoid 16MB doc limits.
Ordered by created_at within each conversation_id.
"""

from datetime import UTC, datetime
from enum import StrEnum

from beanie import Indexed
from pydantic import Field

from src.models.base import TimestampedDocument


class MessageRole(StrEnum):
    USER = "user"
    ASSISTANT = "assistant"
    SYSTEM = "system"


class Message(TimestampedDocument):
    """A single message in a Shamwari AI conversation.

    Contains the content, token counts for billing, and performance
    metrics (latency) for monitoring.
    """

    conversation_id: Indexed(str)  # type: ignore[valid-type]
    role: MessageRole
    content: str
    tokens_input: int = 0
    tokens_output: int = 0
    model_version: str | None = None
    latency_ms: int | None = Field(default=None, description="Inference time in milliseconds")
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

    class Settings:
        name = "messages"
        use_state_management = True
        indexes = [
            [("conversation_id", 1), ("created_at", 1)],
        ]
