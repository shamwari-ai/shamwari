"""Shamwari AI — Pydantic API schemas (Schema.org-aligned).

These schemas define the API request/response contract, separate from
the CouchDB document models. Response schemas include Schema.org
@context and @type fields for machine-readable structured data.
"""

from src.schemas.api_keys import APIKeyCreateRequest, APIKeyResponse
from src.schemas.billing import (
    BillingPlanResponse,
    InvoiceResponse,
    SubscriptionResponse,
)
from src.schemas.common import ErrorResponse, HealthResponse, PaginatedResponse
from src.schemas.conversations import (
    ChatCompletionRequest,
    ChatCompletionResponse,
    ConversationResponse,
    MessageResponse,
)
from src.schemas.datasets import DatasetCreateRequest, DatasetResponse
from src.schemas.feedback import FeedbackCreateRequest, FeedbackResponse
from src.schemas.models import AIModelListResponse, AIModelResponse
from src.schemas.organizations import OrganizationCreateRequest, OrganizationResponse
from src.schemas.usage import UsageResponse, UsageSummaryResponse
from src.schemas.users import UserResponse, UserUpdateRequest

__all__ = [
    # Common
    "ErrorResponse",
    "HealthResponse",
    "PaginatedResponse",
    # Users
    "UserResponse",
    "UserUpdateRequest",
    # Organizations
    "OrganizationResponse",
    "OrganizationCreateRequest",
    # Models
    "AIModelResponse",
    "AIModelListResponse",
    # Conversations
    "ConversationResponse",
    "MessageResponse",
    "ChatCompletionRequest",
    "ChatCompletionResponse",
    # Billing
    "BillingPlanResponse",
    "SubscriptionResponse",
    "InvoiceResponse",
    # Datasets
    "DatasetResponse",
    "DatasetCreateRequest",
    # Feedback
    "FeedbackResponse",
    "FeedbackCreateRequest",
    # Usage
    "UsageResponse",
    "UsageSummaryResponse",
    # API Keys
    "APIKeyResponse",
    "APIKeyCreateRequest",
]
