"""Conversations router — chat session management."""

from fastapi import APIRouter, HTTPException

from src.schemas.common import ErrorResponse, PaginatedResponse
from src.schemas.conversations import (
    ConversationCreateRequest,
    ConversationResponse,
    MessageResponse,
)

router = APIRouter(prefix="/v1", tags=["conversations"])


@router.get(
    "/conversations",
    response_model=PaginatedResponse[ConversationResponse],
    summary="List conversations",
    description=(
        "Returns paginated list of conversations for the authenticated user. "
        "Each conversation includes Schema.org Conversation metadata."
    ),
    responses={
        401: {"model": ErrorResponse, "description": "Authentication required"},
    },
)
async def list_conversations(
    page: int = 1,
    per_page: int = 25,
    archived: bool = False,
) -> PaginatedResponse[ConversationResponse]:
    """List conversations for the current user."""
    raise HTTPException(status_code=501, detail="Not yet implemented")


@router.post(
    "/conversations",
    response_model=ConversationResponse,
    status_code=201,
    summary="Create conversation",
    description="Start a new chat conversation with the specified AI model.",
    responses={
        401: {"model": ErrorResponse, "description": "Authentication required"},
        400: {"model": ErrorResponse, "description": "Invalid model or parameters"},
    },
)
async def create_conversation(
    request: ConversationCreateRequest,
) -> ConversationResponse:
    """Create a new conversation."""
    raise HTTPException(status_code=501, detail="Not yet implemented")


@router.get(
    "/conversations/{conversation_id}",
    response_model=ConversationResponse,
    summary="Get conversation",
    description=(
        "Returns a conversation with its full message history. "
        "Messages include Schema.org Message structured data."
    ),
    responses={
        401: {"model": ErrorResponse, "description": "Authentication required"},
        404: {"model": ErrorResponse, "description": "Conversation not found"},
    },
)
async def get_conversation(conversation_id: str) -> ConversationResponse:
    """Get a conversation with messages."""
    raise HTTPException(status_code=501, detail="Not yet implemented")


@router.get(
    "/conversations/{conversation_id}/messages",
    response_model=PaginatedResponse[MessageResponse],
    summary="List messages in conversation",
    description="Returns paginated messages for a specific conversation.",
    responses={
        401: {"model": ErrorResponse, "description": "Authentication required"},
        404: {"model": ErrorResponse, "description": "Conversation not found"},
    },
)
async def list_messages(
    conversation_id: str,
    page: int = 1,
    per_page: int = 50,
) -> PaginatedResponse[MessageResponse]:
    """List messages in a conversation."""
    raise HTTPException(status_code=501, detail="Not yet implemented")
