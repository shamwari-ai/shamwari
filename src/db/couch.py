"""CouchDB document base class and CRUD helpers.

Provides the foundation for all CouchDB document models in Shamwari AI.
Uses aiocouch for async CouchDB access.
"""

from datetime import UTC, datetime
from typing import Any, Self, TypeVar

from aiocouch import Database, Document
from pydantic import BaseModel, Field

T = TypeVar("T", bound="CouchDocument")


class CouchDocument(BaseModel):
    """Base class for all CouchDB document models.

    Maps to CouchDB's _id and _rev fields. Every document has a type
    discriminator and timestamps for creation and modification tracking.
    """

    id: str = Field(alias="_id")
    rev: str | None = Field(default=None, alias="_rev")
    type: str = Field(description="Document type discriminator")
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

    model_config = {"populate_by_name": True}

    def to_couch_dict(self) -> dict[str, Any]:
        """Serialize to a CouchDB-compatible dict with _id and _rev keys."""
        data = self.model_dump(by_alias=True, exclude_none=True)
        # Ensure datetime fields are ISO 8601 strings
        for key, value in data.items():
            if isinstance(value, datetime):
                data[key] = value.isoformat()
        return data

    @classmethod
    def from_couch_dict(cls, data: dict[str, Any]) -> Self:
        """Deserialize from a CouchDB document dict."""
        return cls.model_validate(data)


# --- CRUD Helpers ---


async def get_doc(db: Database, doc_id: str) -> Document:
    """Fetch a document by ID from a CouchDB database."""
    return await db[doc_id]


async def put_doc(db: Database, doc: CouchDocument) -> Document:
    """Create or update a document in CouchDB.

    Updates the updated_at timestamp before saving.
    """
    doc.updated_at = datetime.now(UTC)
    data = doc.to_couch_dict()
    doc_id = data.pop("_id")
    couch_doc = await db.create(doc_id, exists_ok=True)
    for key, value in data.items():
        if key != "_rev":
            couch_doc[key] = value
    await couch_doc.save()
    return couch_doc


async def delete_doc(db: Database, doc_id: str) -> None:
    """Delete a document by ID from CouchDB."""
    doc = await db[doc_id]
    await doc.delete()


async def find_docs(
    db: Database,
    selector: dict[str, Any],
    limit: int = 25,
    skip: int = 0,
    sort: list[dict[str, str]] | None = None,
) -> list[dict[str, Any]]:
    """Query documents using CouchDB Mango selector syntax.

    Args:
        db: The CouchDB database to query.
        selector: Mango selector (e.g., {"type": "conversation"}).
        limit: Maximum number of documents to return.
        skip: Number of documents to skip (for pagination).
        sort: Optional sort specification (e.g., [{"created_at": "desc"}]).

    Returns:
        List of matching document dicts.
    """
    results: list[dict[str, Any]] = []
    async for doc in db.find(selector, limit=limit, skip=skip, sort=sort):
        data = dict(doc)
        data["_id"] = doc.id
        data["_rev"] = doc["_rev"] if "_rev" in doc else None
        results.append(data)
    return results
