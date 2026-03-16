"""Datasets router — training data management."""

from fastapi import APIRouter, HTTPException

from src.schemas.common import ErrorResponse, PaginatedResponse
from src.schemas.datasets import DatasetCreateRequest, DatasetResponse

router = APIRouter(prefix="/v1", tags=["datasets"])


@router.get(
    "/datasets",
    response_model=PaginatedResponse[DatasetResponse],
    summary="List datasets",
    description=(
        "Returns paginated list of training datasets with Schema.org Dataset "
        "structured data. Filter by language, status, or domain."
    ),
    responses={
        401: {"model": ErrorResponse, "description": "Authentication required"},
    },
)
async def list_datasets(
    page: int = 1,
    per_page: int = 25,
    language: str | None = None,
    status: str | None = None,
    domain: str | None = None,
) -> PaginatedResponse[DatasetResponse]:
    """List training datasets."""
    raise HTTPException(status_code=501, detail="Not yet implemented")


@router.post(
    "/datasets",
    response_model=DatasetResponse,
    status_code=201,
    summary="Create dataset",
    description="Register a new training dataset. Upload the data file separately to R2.",
    responses={
        401: {"model": ErrorResponse, "description": "Authentication required"},
        400: {"model": ErrorResponse, "description": "Invalid parameters"},
    },
)
async def create_dataset(request: DatasetCreateRequest) -> DatasetResponse:
    """Create a new dataset entry."""
    raise HTTPException(status_code=501, detail="Not yet implemented")


@router.get(
    "/datasets/{dataset_id}",
    response_model=DatasetResponse,
    summary="Get dataset details",
    description=("Returns detailed dataset information with Schema.org Dataset structured data."),
    responses={
        401: {"model": ErrorResponse, "description": "Authentication required"},
        404: {"model": ErrorResponse, "description": "Dataset not found"},
    },
)
async def get_dataset(dataset_id: str) -> DatasetResponse:
    """Get dataset by ID."""
    raise HTTPException(status_code=501, detail="Not yet implemented")
