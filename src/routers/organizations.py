"""Organizations router — team/business account management."""

from fastapi import APIRouter, HTTPException

from src.schemas.common import ErrorResponse, PaginatedResponse
from src.schemas.organizations import (
    OrganizationCreateRequest,
    OrganizationMemberResponse,
    OrganizationResponse,
    OrganizationUpdateRequest,
)

router = APIRouter(prefix="/v1", tags=["organizations"])


@router.get(
    "/organizations/{slug}",
    response_model=OrganizationResponse,
    summary="Get organization",
    description=(
        "Returns organization details with Schema.org Organization "
        "structured data. Requires membership in the organization."
    ),
    responses={
        401: {"model": ErrorResponse, "description": "Authentication required"},
        403: {"model": ErrorResponse, "description": "Not a member of this organization"},
        404: {"model": ErrorResponse, "description": "Organization not found"},
    },
)
async def get_organization(slug: str) -> OrganizationResponse:
    """Get organization by slug."""
    raise HTTPException(status_code=501, detail="Not yet implemented")


@router.post(
    "/organizations",
    response_model=OrganizationResponse,
    status_code=201,
    summary="Create organization",
    description="Create a new organization. The authenticated user becomes the owner.",
    responses={
        401: {"model": ErrorResponse, "description": "Authentication required"},
        400: {"model": ErrorResponse, "description": "Invalid parameters"},
        409: {"model": ErrorResponse, "description": "Slug already taken"},
    },
)
async def create_organization(
    request: OrganizationCreateRequest,
) -> OrganizationResponse:
    """Create a new organization."""
    raise HTTPException(status_code=501, detail="Not yet implemented")


@router.patch(
    "/organizations/{slug}",
    response_model=OrganizationResponse,
    summary="Update organization",
    description="Update organization name or description. Requires admin or owner role.",
    responses={
        401: {"model": ErrorResponse, "description": "Authentication required"},
        403: {"model": ErrorResponse, "description": "Insufficient permissions"},
        404: {"model": ErrorResponse, "description": "Organization not found"},
    },
)
async def update_organization(
    slug: str,
    request: OrganizationUpdateRequest,
) -> OrganizationResponse:
    """Update organization details."""
    raise HTTPException(status_code=501, detail="Not yet implemented")


@router.get(
    "/organizations/{slug}/members",
    response_model=PaginatedResponse[OrganizationMemberResponse],
    summary="List organization members",
    description="Returns all members of an organization with their roles.",
    responses={
        401: {"model": ErrorResponse, "description": "Authentication required"},
        403: {"model": ErrorResponse, "description": "Not a member of this organization"},
        404: {"model": ErrorResponse, "description": "Organization not found"},
    },
)
async def list_members(
    slug: str,
    page: int = 1,
    per_page: int = 25,
) -> PaginatedResponse[OrganizationMemberResponse]:
    """List members of an organization."""
    raise HTTPException(status_code=501, detail="Not yet implemented")
