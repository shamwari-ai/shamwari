"""Database initialization — connects to MongoDB Atlas and registers all Beanie models.

Usage:
    from src.db.init import init_db

    await init_db("mongodb+srv://...")
"""

from beanie import init_beanie
from motor.motor_asyncio import AsyncIOMotorClient

from src.models import ALL_MODELS

_client: AsyncIOMotorClient | None = None  # type: ignore[type-arg]


async def init_db(
    mongodb_uri: str,
    database_name: str = "shamwari",
) -> AsyncIOMotorClient:  # type: ignore[type-arg]
    """Initialize MongoDB connection and register all Beanie document models.

    Args:
        mongodb_uri: MongoDB Atlas connection string.
        database_name: Database name (default: "shamwari").

    Returns:
        The Motor async client instance.
    """
    global _client
    _client = AsyncIOMotorClient(mongodb_uri)
    db = _client[database_name]

    await init_beanie(database=db, document_models=ALL_MODELS)

    return _client


async def close_db() -> None:
    """Close the MongoDB connection."""
    global _client
    if _client is not None:
        _client.close()
        _client = None


def get_client() -> AsyncIOMotorClient:  # type: ignore[type-arg]
    """Get the current Motor client. Raises if not initialized."""
    if _client is None:
        raise RuntimeError("Database not initialized. Call init_db() first.")
    return _client
