"""Inference router — AI chat completions (OpenAI-compatible)."""

from fastapi import APIRouter, HTTPException

from src.schemas.common import ErrorResponse
from src.schemas.conversations import ChatCompletionRequest, ChatCompletionResponse

router = APIRouter(prefix="/v1", tags=["inference"])


@router.post(
    "/chat/completions",
    response_model=ChatCompletionResponse,
    summary="Create chat completion",
    description=(
        "Generate an AI response given a conversation history. "
        "Follows the OpenAI-compatible chat completions format for "
        "maximum interoperability with existing client libraries. "
        "Supports Shamwari AI models with African language capabilities."
    ),
    responses={
        400: {"model": ErrorResponse, "description": "Invalid request parameters"},
        401: {"model": ErrorResponse, "description": "Invalid or missing API key"},
        429: {"model": ErrorResponse, "description": "Rate limit exceeded"},
        503: {"model": ErrorResponse, "description": "Model unavailable"},
    },
)
async def create_chat_completion(
    request: ChatCompletionRequest,
) -> ChatCompletionResponse:
    """Create a chat completion using the specified Shamwari AI model."""
    raise HTTPException(status_code=501, detail="Not yet implemented")
