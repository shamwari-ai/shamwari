"""Database initialization — connects to CouchDB and sets up databases.

CouchDB database strategy (local-first architecture):
- Per-user databases: shamwari_user_{stytch_user_id} — conversations, messages, preferences
- Platform database: shamwari_platform — orgs, API keys, billing plans, models, datasets
- Events database: shamwari_events — usage events, feedback, audit logs

Usage:
    from src.db.init import init_db, get_user_db, get_platform_db

    await init_db("http://admin:password@localhost:5984")
    db = await get_user_db("user-live-xxx")
"""

from aiocouch import CouchDB

from src.db.designs import (
    EVENTS_DB_DESIGNS,
    EVENTS_DB_INDEXES,
    PLATFORM_DB_DESIGNS,
    PLATFORM_DB_INDEXES,
    ensure_designs,
    ensure_indexes,
)

_couch: CouchDB | None = None


async def init_db(couchdb_url: str, user: str = "", password: str = "") -> CouchDB:
    """Initialize CouchDB connection and set up core databases.

    Creates the platform and events databases if they don't exist,
    and pushes design documents and Mango indexes.

    Args:
        couchdb_url: CouchDB server URL (e.g., http://localhost:5984).
        user: CouchDB admin username.
        password: CouchDB admin password.

    Returns:
        The aiocouch CouchDB client instance.
    """
    global _couch
    _couch = CouchDB(couchdb_url, user=user, password=password)

    # Ensure core databases exist
    platform_db = await _couch.create("shamwari_platform", exists_ok=True)
    events_db = await _couch.create("shamwari_events", exists_ok=True)

    # Push design documents and indexes
    await ensure_designs(platform_db, PLATFORM_DB_DESIGNS)
    await ensure_indexes(platform_db, PLATFORM_DB_INDEXES)
    await ensure_designs(events_db, EVENTS_DB_DESIGNS)
    await ensure_indexes(events_db, EVENTS_DB_INDEXES)

    return _couch


async def close_db() -> None:
    """Close the CouchDB connection."""
    global _couch
    if _couch is not None:
        await _couch.close()
        _couch = None


def get_couch() -> CouchDB:
    """Get the current CouchDB client. Raises if not initialized."""
    if _couch is None:
        raise RuntimeError("Database not initialized. Call init_db() first.")
    return _couch


async def get_user_db(user_id: str) -> "aiocouch.Database":  # type: ignore[name-defined]  # noqa: F821
    """Get or create a per-user database for PouchDB replication.

    Each user gets their own CouchDB database (shamwari_user_{user_id})
    for conversations, messages, and preferences. This is CouchDB's
    recommended pattern for local-first architectures — PouchDB syncs
    directly to the user's database with no filtering needed.

    Args:
        user_id: Stytch user ID (e.g., "user-live-xxx").

    Returns:
        The user's CouchDB database, created if it doesn't exist.
    """
    from src.db.designs import USER_DB_DESIGNS, USER_DB_INDEXES

    couch = get_couch()
    db_name = f"shamwari_user_{user_id.replace('-', '_')}"
    db = await couch.create(db_name, exists_ok=True)
    await ensure_designs(db, USER_DB_DESIGNS)
    await ensure_indexes(db, USER_DB_INDEXES)
    return db


async def get_platform_db() -> "aiocouch.Database":  # type: ignore[name-defined]  # noqa: F821
    """Get the shared platform database.

    Contains organizations, API keys, billing plans, subscriptions,
    invoices, AI models, and datasets.
    """
    couch = get_couch()
    return await couch["shamwari_platform"]


async def get_events_db() -> "aiocouch.Database":  # type: ignore[name-defined]  # noqa: F821
    """Get the events database.

    Contains usage events, feedback, and audit logs. Fed into the
    CouchDB-to-Doris event pipeline via the _changes feed.
    """
    couch = get_couch()
    return await couch["shamwari_events"]
