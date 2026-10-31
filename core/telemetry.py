"""
Per-tier usage report: tokens always, cost as a labelled estimate.

Tokens are the fact. `costUsdEstimate` is derived at write time from a versioned
price table (gateway/pricing.json) and is not billing-grade. A request with no
estimate (a model that is not priced, or an answer that made no model call) is
counted in `unpriced_requests` and contributes nothing to the cost, so a total
is never read as complete when it is not.

No third-party imports, so the pipeline is testable without Mongo.
"""

from __future__ import annotations

from typing import Any

ESTIMATE_NOTE = "estimate from a versioned price table; not billing grade; excludes embeddings"


def by_tier_pipeline(billing_period: str, owner_entity_id: str | None = None) -> list[dict[str, Any]]:
    match: dict[str, Any] = {"billingPeriod": billing_period}
    if owner_entity_id:
        match["ownerEntityId"] = owner_entity_id
    priced = {"$isNumber": "$costUsdEstimate"}
    return [
        {"$match": match},
        {
            "$group": {
                "_id": {
                    "reach": {"$ifNull": ["$reach", "none"]},
                    "routedTier": {"$ifNull": ["$routedTier", "$tier"]},
                    "inferencePath": {"$ifNull": ["$inferencePath", "unknown"]},
                },
                "requests": {"$sum": 1},
                "input_tokens": {"$sum": {"$ifNull": ["$inputTokens", 0]}},
                "output_tokens": {"$sum": {"$ifNull": ["$outputTokens", 0]}},
                "cost_usd_estimate": {"$sum": {"$cond": [priced, "$costUsdEstimate", 0]}},
                "unpriced_requests": {"$sum": {"$cond": [priced, 0, 1]}},
            }
        },
        {"$sort": {"_id.reach": 1, "_id.routedTier": 1, "_id.inferencePath": 1}},
    ]


def shape(rows: list[dict[str, Any]]) -> dict[str, Any]:
    out = []
    for r in rows:
        k = r["_id"]
        out.append(
            {
                "reach": k["reach"],
                "routed_tier": k["routedTier"],
                "inference_path": k["inferencePath"],
                "requests": int(r["requests"]),
                "input_tokens": int(r["input_tokens"]),
                "output_tokens": int(r["output_tokens"]),
                "cost_usd_estimate": round(float(r["cost_usd_estimate"]), 9),
                "unpriced_requests": int(r["unpriced_requests"]),
            }
        )
    return {"estimate": ESTIMATE_NOTE, "rows": out}
