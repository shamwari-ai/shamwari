"""Conversation and chat completion API schemas.

Conversation/Message responses use Schema.org types.
ChatCompletion request/response follow the OpenAI-compatible format
for industry interoperability.
"""

from datetime import datetime

from pydantic import BaseModel, Field

from src.schemas.base import SchemaOrgMixin

# --- Schema.org-aligned conversation responses ---


class MessageResponse(SchemaOrgMixin):
    """Message response.

    Schema.org @type: Message
    Maps: content → text, role → sender
    """

    schema_type: str = Field(default="Message", alias="@type", serialization_alias="@type")
    sender: str = Field(description="Message role/sender (Schema.org: sender)")
    text: str = Field(description="Message content (Schema.org: text)")
    date_created: datetime = Field(description="Schema.org: dateCreated")
    tokens_input: int = 0
    tokens_output: int = 0
    model_version: str | None = None
    inference_type: str | None = Field(default=None, description="on_device or cloud")
    latency_ms: int | None = None


class ConversationResponse(SchemaOrgMixin):
    """Conversation response.

    Schema.org @type: Conversation
    Maps: title → name, language → inLanguage
    """

    schema_type: str = Field(default="Conversation", alias="@type", serialization_alias="@type")
    id: str = Field(description="Conversation document ID")
    name: str = Field(description="Conversation title (Schema.org: name)")
    in_language: str = Field(description="Primary language, ISO 639-1 (Schema.org: inLanguage)")
    model_slug: str
    message_count: int
    total_tokens_used: int
    is_archived: bool
    created_at: datetime
    updated_at: datetime
    messages: list[MessageResponse] | None = Field(
        default=None, description="Included when fetching a single conversation"
    )


class ConversationCreateRequest(BaseModel):
    """Create conversation request."""

    title: str = Field(default="New conversation", max_length=200)
    model_slug: str
    language: str = Field(default="en", max_length=5)
    system_prompt: str | None = Field(default=None, max_length=2000)


# --- OpenAI-compatible chat completion schemas ---


class ChatMessageInput(BaseModel):
    """A single message in a chat completion request (OpenAI-compatible)."""

    role: str = Field(description="user, assistant, or system")
    content: str


class ChatCompletionRequest(BaseModel):
    """Chat completion request (OpenAI-compatible format).

    Follows the de facto industry standard for maximum interoperability
    with existing client libraries and tools.
    """

    model: str = Field(description="Model slug (e.g., 'shamwari-1b-q4')")
    messages: list[ChatMessageInput]
    max_tokens: int = Field(default=512, ge=1, le=8192)
    temperature: float = Field(default=0.7, ge=0.0, le=2.0)
    stream: bool = Field(default=False, description="Enable streaming responses")


class ChatCompletionChoice(BaseModel):
    """A single completion choice."""

    index: int
    message: ChatMessageInput
    finish_reason: str = Field(description="stop, length, or content_filter")


class ChatCompletionUsage(BaseModel):
    """Token usage for a completion."""

    prompt_tokens: int
    completion_tokens: int
    total_tokens: int


class ChatCompletionResponse(BaseModel):
    """Chat completion response (OpenAI-compatible format).

    Intentionally does NOT use Schema.org — follows industry standard
    for client library compatibility.
    """

    id: str = Field(description="Unique completion ID")
    object: str = Field(default="chat.completion")
    created: int = Field(description="Unix timestamp of creation")
    model: str = Field(description="Model used for inference")
    choices: list[ChatCompletionChoice]
    usage: ChatCompletionUsage
