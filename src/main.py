"""Shamwari AI — FastAPI application entry point.

Runs on Fly.io. Handles AI inference, model management, and API gateway.
Connects to CouchDB for operational data and serves the OpenAPI-compliant API.
"""

import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.security import APIKeyHeader

from src.db.init import close_db, init_db

# Security scheme for API key authentication
api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)

# OpenAPI tag definitions
OPENAPI_TAGS = [
    {
        "name": "inference",
        "description": "AI inference endpoints — chat completions, embeddings.",
    },
    {
        "name": "models",
        "description": "AI model registry — list and inspect available models.",
    },
    {
        "name": "conversations",
        "description": "Chat conversation management — create, list, retrieve.",
    },
    {
        "name": "users",
        "description": "User profile management — view and update current user.",
    },
    {
        "name": "organizations",
        "description": "Organization management — teams, members, settings.",
    },
    {
        "name": "api-keys",
        "description": "API key management — create, list, revoke keys.",
    },
    {
        "name": "billing",
        "description": "Billing and subscription management — plans, invoices.",
    },
    {
        "name": "usage",
        "description": "API usage analytics — consumption metrics and summaries.",
    },
    {
        "name": "datasets",
        "description": "Training dataset management — upload, track, query datasets.",
    },
    {
        "name": "feedback",
        "description": "User feedback on AI responses — ratings and comments.",
    },
    {
        "name": "system",
        "description": "System health and status endpoints.",
    },
]


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Manage application startup and shutdown."""
    couchdb_url = os.environ.get("COUCHDB_URL", "http://localhost:5984")
    couchdb_user = os.environ.get("COUCHDB_USER", "")
    couchdb_password = os.environ.get("COUCHDB_PASSWORD", "")
    await init_db(couchdb_url, user=couchdb_user, password=couchdb_password)
    yield
    await close_db()


app = FastAPI(
    title="Shamwari AI",
    description=(
        "Africa's open source AI platform — API backend.\n\n"
        "Shamwari AI provides AI inference, model management, and developer APIs "
        "purpose-built for African languages and contexts. Built by Nyuchi Africa."
    ),
    version="0.1.0",
    lifespan=lifespan,
    contact={
        "name": "Nyuchi Web Services",
        "url": "https://shamwari.ai",
        "email": "api@shamwari.ai",
    },
    license_info={
        "name": "MIT",
        "url": "https://opensource.org/licenses/MIT",
    },
    servers=[
        {"url": "https://api.shamwari.ai", "description": "Production"},
        {"url": "http://localhost:8000", "description": "Local development"},
    ],
    openapi_tags=OPENAPI_TAGS,
)

# --- Register routers ---
from src.routers import (  # noqa: E402
    api_keys,
    billing,
    conversations,
    datasets,
    feedback,
    inference,
    models,
    organizations,
    usage,
    users,
)

app.include_router(inference.router)
app.include_router(models.router)
app.include_router(conversations.router)
app.include_router(users.router)
app.include_router(organizations.router)
app.include_router(api_keys.router)
app.include_router(billing.router)
app.include_router(usage.router)
app.include_router(datasets.router)
app.include_router(feedback.router)


@app.get("/health", tags=["system"], summary="Health check")
async def health() -> dict[str, str]:
    """Health check endpoint for Fly.io."""
    return {"status": "ok"}
