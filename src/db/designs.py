"""CouchDB design documents — views and indexes for common query patterns.

Design documents are pushed to CouchDB on application startup via ensure_designs().
Each database (user, platform, events) has its own set of views.
"""

from typing import Any

from aiocouch import Database

# --- Design Document Definitions ---

USER_DB_DESIGNS: dict[str, Any] = {
    "_id": "_design/shamwari",
    "views": {
        "conversations_by_date": {
            "map": """
function (doc) {
    if (doc.type === 'conversation') {
        emit(doc.created_at, {title: doc.title, language: doc.language});  // noqa: E501
    }
}
""",
        },
        "messages_by_conversation": {
            "map": """
function (doc) {
    if (doc.type === 'message') {
        emit([doc.conversation_id, doc.created_at], null);
    }
}
""",
        },
        "by_type": {
            "map": """
function (doc) {
    if (doc.type) {
        emit(doc.type, null);
    }
}
""",
        },
    },
}

PLATFORM_DB_DESIGNS: dict[str, Any] = {
    "_id": "_design/shamwari",
    "views": {
        "orgs_by_slug": {
            "map": """
function (doc) {
    if (doc.type === 'organization') {
        emit(doc.slug, null);
    }
}
""",
        },
        "api_keys_by_org": {
            "map": """
function (doc) {
    if (doc.type === 'api_key') {
        emit(doc.organization_id, null);
    }
}
""",
        },
        "api_keys_by_hash": {
            "map": """
function (doc) {
    if (doc.type === 'api_key' && doc.status === 'active') {
        emit(doc.key_hash, null);
    }
}
""",
        },
        "plans_by_status": {
            "map": """
function (doc) {
    if (doc.type === 'billing_plan') {
        emit(doc.is_active, null);
    }
}
""",
        },
        "models_by_status": {
            "map": """
function (doc) {
    if (doc.type === 'ai_model') {
        emit(doc.status, null);
    }
}
""",
        },
        "models_by_slug": {
            "map": """
function (doc) {
    if (doc.type === 'ai_model') {
        emit([doc.slug, doc.version], null);
    }
}
""",
        },
        "subscriptions_by_org": {
            "map": """
function (doc) {
    if (doc.type === 'subscription') {
        emit(doc.organization_id, null);
    }
}
""",
        },
        "invoices_by_org": {
            "map": """
function (doc) {
    if (doc.type === 'invoice') {
        emit([doc.organization_id, doc.created_at], null);
    }
}
""",
        },
        "datasets_by_language": {
            "map": """
function (doc) {
    if (doc.type === 'dataset') {
        emit([doc.language, doc.status], null);
    }
}
""",
        },
        "by_type": {
            "map": """
function (doc) {
    if (doc.type) {
        emit(doc.type, null);
    }
}
""",
        },
    },
}

EVENTS_DB_DESIGNS: dict[str, Any] = {
    "_id": "_design/shamwari",
    "views": {
        "usage_by_api_key": {
            "map": """
function (doc) {
    if (doc.type === 'usage_event') {
        emit([doc.api_key_id, doc.created_at], {tokens_in: doc.tokens_input});
    }
}
""",
        },
        "usage_by_timestamp": {
            "map": """
function (doc) {
    if (doc.type === 'usage_event') {
        emit(doc.created_at, {user_id: doc.user_id, status: doc.status});
    }
}
""",
        },
        "usage_by_org": {
            "map": """
function (doc) {
    if (doc.type === 'usage_event') {
        emit([doc.organization_id, doc.created_at], null);
    }
}
""",
        },
        "feedback_by_model": {
            "map": """
function (doc) {
    if (doc.type === 'feedback') {
        emit([doc.model_id, doc.created_at], {rating: doc.rating, language: doc.language});
    }
}
""",
        },
        "audit_by_actor": {
            "map": """
function (doc) {
    if (doc.type === 'audit_log') {
        emit([doc.actor_id, doc.timestamp], {action: doc.action, resource_type: doc.resource_type});
    }
}
""",
        },
        "audit_by_resource": {
            "map": """
function (doc) {
    if (doc.type === 'audit_log') {
        emit([doc.resource_type, doc.resource_id, doc.timestamp], null);
    }
}
""",
        },
        "by_type": {
            "map": """
function (doc) {
    if (doc.type) {
        emit(doc.type, null);
    }
}
""",
        },
    },
}

# --- Mango Indexes ---

USER_DB_INDEXES: list[dict[str, Any]] = [
    {
        "index": {"fields": ["type", "created_at"]},
        "name": "type-created",
        "type": "json",
    },
    {
        "index": {"fields": ["type", "conversation_id", "created_at"]},
        "name": "messages-by-conversation",
        "type": "json",
    },
]

PLATFORM_DB_INDEXES: list[dict[str, Any]] = [
    {
        "index": {"fields": ["type", "slug"]},
        "name": "type-slug",
        "type": "json",
    },
    {
        "index": {"fields": ["type", "organization_id"]},
        "name": "type-org",
        "type": "json",
    },
    {
        "index": {"fields": ["type", "status"]},
        "name": "type-status",
        "type": "json",
    },
    {
        "index": {"fields": ["type", "key_hash"]},
        "name": "type-keyhash",
        "type": "json",
    },
]

EVENTS_DB_INDEXES: list[dict[str, Any]] = [
    {
        "index": {"fields": ["type", "created_at"]},
        "name": "type-created",
        "type": "json",
    },
    {
        "index": {"fields": ["type", "api_key_id", "created_at"]},
        "name": "usage-by-key",
        "type": "json",
    },
    {
        "index": {"fields": ["type", "organization_id", "created_at"]},
        "name": "usage-by-org",
        "type": "json",
    },
    {
        "index": {"fields": ["type", "model_id", "created_at"]},
        "name": "feedback-by-model",
        "type": "json",
    },
]


async def ensure_designs(db: Database, design_doc: dict[str, Any]) -> None:
    """Push a design document to CouchDB, creating or updating as needed."""
    doc_id = design_doc["_id"]
    try:
        existing = await db[doc_id]
        # Update views if they've changed
        needs_update = False
        for key in ("views", "indexes"):
            if key in design_doc and dict(existing).get(key) != design_doc[key]:
                needs_update = True
                existing[key] = design_doc[key]
        if needs_update:
            await existing.save()
    except KeyError:
        doc = await db.create(doc_id)
        for key, value in design_doc.items():
            if key != "_id":
                doc[key] = value
        await doc.save()


async def ensure_indexes(db: Database, indexes: list[dict[str, Any]]) -> None:
    """Create Mango indexes on a CouchDB database."""
    for index_def in indexes:
        await db.session.request(
            "POST",
            db._database_path("_index"),
            json=index_def,
        )
