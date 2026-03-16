"""Models router — AI model registry."""

from fastapi import APIRouter, HTTPException

from src.schemas.common import ErrorResponse
from src.schemas.models import AIModelListResponse, AIModelResponse

router = APIRouter(prefix="/v1", tags=["models"])


@router.get(
    "/models",
    response_model=AIModelListResponse,
    summary="List available AI models",
    description=(
        "Returns all AI models with status 'ready'. Each model includes "
        "Schema.org SoftwareApplication metadata: supported languages, "
        "capabilities, version, and pricing."
    ),
    responses={
        401: {"model": ErrorResponse, "description": "Invalid or missing API key"},
    },
)
async def list_models() -> AIModelListResponse:
    """List all available AI models."""
    raise HTTPException(status_code=501, detail="Not yet implemented")


@router.get(
    "/models/{slug}",
    response_model=AIModelResponse,
    summary="Get model details",
    description=(
        "Returns detailed information about a specific AI model by slug. "
        "Includes Schema.org SoftwareApplication structured data."
    ),
    responses={
        401: {"model": ErrorResponse, "description": "Invalid or missing API key"},
        404: {"model": ErrorResponse, "description": "Model not found"},
    },
)
async def get_model(slug: str) -> AIModelResponse:
    """Get details of a specific AI model."""
    raise HTTPException(status_code=501, detail="Not yet implemented")
