"""Feedback router — user ratings on AI responses."""

from fastapi import APIRouter, HTTPException

from src.schemas.common import ErrorResponse, PaginatedResponse
from src.schemas.feedback import FeedbackCreateRequest, FeedbackResponse

router = APIRouter(prefix="/v1", tags=["feedback"])


@router.post(
    "/feedback",
    response_model=FeedbackResponse,
    status_code=201,
    summary="Submit feedback",
    description=(
        "Submit a rating (thumbs up/down) on an AI response. "
        "Used for model quality tracking and RLHF training data."
    ),
    responses={
        401: {"model": ErrorResponse, "description": "Authentication required"},
        400: {"model": ErrorResponse, "description": "Invalid parameters"},
        404: {"model": ErrorResponse, "description": "Message not found"},
    },
)
async def submit_feedback(request: FeedbackCreateRequest) -> FeedbackResponse:
    """Submit feedback on an AI response."""
    raise HTTPException(status_code=501, detail="Not yet implemented")


@router.get(
    "/feedback",
    response_model=PaginatedResponse[FeedbackResponse],
    summary="List feedback",
    description=(
        "Returns paginated feedback with Schema.org Review structured data. "
        "Filter by model, rating, or language."
    ),
    responses={
        401: {"model": ErrorResponse, "description": "Authentication required"},
    },
)
async def list_feedback(
    page: int = 1,
    per_page: int = 25,
    model_id: str | None = None,
    rating: str | None = None,
) -> PaginatedResponse[FeedbackResponse]:
    """List feedback entries."""
    raise HTTPException(status_code=501, detail="Not yet implemented")
