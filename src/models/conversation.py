"""Conversation model — chat sessions stored in per-user CouchDB database.

In the CouchDB/PouchDB local-first architecture, conversations live in the
user's own database and sync bidirectionally via PouchDB replication.
Messages are embedded in the conversation document (CouchDB has no 16MB limit
like MongoDB — documents can be arbitrarily large, though keeping them
reasonable for sync performance is recommended).

Schema.org mapping: Conversation
"""

from pydantic import Field

from src.models.base import TimestampedDocument
from src.models.message import Message


class Conversation(TimestampedDocument):
    """A chat conversation between a user and Shamwari AI.

    Contains embedded messages for local-first sync efficiency.
    Each conversation is a single CouchDB document that PouchDB
    replicates as an atomic unit.

    CouchDB database: shamwari_user_{stytch_user_id}
    Document _id: "conv_{uuid}"
    Schema.org @type: Conversation
    """

    type: str = "conversation"
    title: str = "New conversation"
    model_slug: str = Field(description="Which AI model is used for this chat")
    language: str = Field(default="en", description="Primary language (ISO 639-1)")
    messages: list[Message] = Field(default_factory=list)
    message_count: int = 0
    total_tokens_used: int = 0
    system_prompt: str | None = None
    is_archived: bool = False
