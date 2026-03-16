"""Message model — individual messages within a conversation.

In the CouchDB architecture, messages are embedded within conversation
documents for atomic sync via PouchDB. This model defines the embedded
message structure (not a standalone CouchDB document).

Schema.org mapping: Message
"""

from datetime import UTC, datetime
from enum import StrEnum

from pydantic import BaseModel, Field


class MessageRole(StrEnum):
    USER = "user"
    ASSISTANT = "assistant"
    SYSTEM = "system"


class InferenceType(StrEnum):
    ON_DEVICE = "on_device"
    CLOUD = "cloud"


class Message(BaseModel):
    """A single message in a Shamwari AI conversation.

    Embedded within Conversation documents. Contains content, token counts
    for billing, inference metadata, and performance metrics.

    Schema.org @type: Message
    """

    role: MessageRole
    content: str
    timestamp: datetime = Field(default_factory=lambda: datetime.now(UTC))
    tokens_input: int = 0
    tokens_output: int = 0
    model_version: str | None = None
    inference_type: InferenceType | None = None
    latency_ms: int | None = Field(default=None, description="Inference time in milliseconds")
