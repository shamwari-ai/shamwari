"""Shamwari AI — MongoDB document models (Beanie ODM)."""

from src.models.ai_model import AIModel
from src.models.api_key import APIKey
from src.models.audit_log import AuditLog
from src.models.billing import BillingPlan, Invoice, Subscription
from src.models.conversation import Conversation
from src.models.dataset import Dataset
from src.models.feedback import Feedback
from src.models.message import Message
from src.models.organization import Organization
from src.models.usage import UsageRecord
from src.models.user import User

ALL_MODELS = [
    User,
    Organization,
    APIKey,
    Conversation,
    Message,
    AIModel,
    BillingPlan,
    Subscription,
    Invoice,
    UsageRecord,
    Dataset,
    Feedback,
    AuditLog,
]

__all__ = [
    "User",
    "Organization",
    "APIKey",
    "Conversation",
    "Message",
    "AIModel",
    "BillingPlan",
    "Subscription",
    "Invoice",
    "UsageRecord",
    "Dataset",
    "Feedback",
    "AuditLog",
    "ALL_MODELS",
]
