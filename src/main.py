"""Shamwari AI — FastAPI application entry point.

Runs on Fly.io. Handles AI inference, model management, and training pipelines.
Connects directly to MongoDB Atlas via Motor/Beanie.
"""

import os
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI

from src.db.init import close_db, init_db


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Manage application startup and shutdown."""
    mongodb_uri = os.environ["MONGODB_URI"]
    db_name = os.environ.get("MONGODB_DB_NAME", "shamwari")
    await init_db(mongodb_uri, database_name=db_name)
    yield
    await close_db()


app = FastAPI(
    title="Shamwari AI",
    description="Africa's open source AI platform — API backend",
    version="0.1.0",
    lifespan=lifespan,
)


@app.get("/health")
async def health() -> dict[str, str]:
    """Health check endpoint for Fly.io."""
    return {"status": "ok"}
