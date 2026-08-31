"""
Shamwari Ground ingestion.

    python ingest_ground.py --source constitution-2013 --file ./constitution.txt
    python ingest_ground.py --list
    python ingest_ground.py --due

Writes to two places, deliberately:

  Postgres  (shamwari_ai_db)  the audit record — what was ingested, from
                              which source, under which licence, effective
                              when. This is the provenance trail you hand
                              to a funder or a regulator.

  MongoDB   (shamwari.knowledgeBase)  the embedded chunks that retrieval
                              actually queries.

`documents.mongodb_ground_id` is the bridge between them.

LICENCE GATE
------------
A source must be `is_approved = true` AND `ground_eligible = true` before
anything is ingested. `mind_eligible` is tracked separately and copied onto
each chunk — Ground eligibility is broad (retrieval with citation),
Mind eligibility is narrow (training data, needs a licence that permits it).

The script refuses to ingest an unapproved source. It does not warn and
continue.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import os
import re
import sys
from datetime import date, datetime, timezone
from typing import Any

import asyncpg
import httpx
from motor.motor_asyncio import AsyncIOMotorClient

PG_DSN = os.environ["SUPABASE_DB_URL"]
MONGODB_URI = os.environ["MONGODB_URI"]
CF_ACCOUNT_ID = os.environ["CF_ACCOUNT_ID"]
CF_API_TOKEN = os.environ["CF_API_TOKEN"]

EMBED_MODEL = "@cf/baai/bge-m3"
EMBED_DIMS = 1024
TARGET_TOKENS = 500
OVERLAP_TOKENS = 60


# ---------------------------------------------------------------------------
# Chunking
# ---------------------------------------------------------------------------

# Legal text has natural boundaries. Splitting on them keeps a citation
# meaningful — "Section 56(3)" rather than "chunk 47".
HEADING = re.compile(
    r"^\s*("
    r"(?:PART|CHAPTER|SCHEDULE)\s+[IVXLC\d]+.*"
    r"|(?:Section|Article|Clause)\s+\d+[A-Za-z]?.*"
    r"|\d+\.\s+[A-Z][^\n]{3,80}"
    r")\s*$",
    re.MULTILINE,
)


def approx_tokens(text: str) -> int:
    """Cheap estimate. Good enough for sizing; not used for billing."""
    return max(1, len(text) // 4)


def chunk_document(text: str) -> list[dict[str, Any]]:
    """
    Heading-aware chunking with overlap.

    Sections shorter than the target are kept whole rather than merged with
    a neighbour — a self-contained section is a better retrieval unit than
    a padded one, even if it is short.
    """
    text = text.replace("\r\n", "\n").strip()
    matches = list(HEADING.finditer(text))

    if not matches:
        segments = [(None, text)]
    else:
        segments = []
        if matches[0].start() > 0:
            segments.append((None, text[: matches[0].start()].strip()))
        for i, m in enumerate(matches):
            end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
            segments.append((m.group(1).strip(), text[m.end() : end].strip()))

    chunks: list[dict[str, Any]] = []
    for heading, body in segments:
        if not body:
            continue
        if approx_tokens(body) <= TARGET_TOKENS:
            chunks.append({"heading": heading, "content": body})
            continue

        # Split long sections on paragraph boundaries with overlap.
        paras = [p.strip() for p in body.split("\n\n") if p.strip()]
        buf: list[str] = []
        for para in paras:
            buf.append(para)
            if approx_tokens("\n\n".join(buf)) >= TARGET_TOKENS:
                chunks.append({"heading": heading, "content": "\n\n".join(buf)})
                # Carry the tail forward so a fact spanning a boundary is
                # still retrievable.
                tail, kept = [], 0
                for p in reversed(buf):
                    if kept >= OVERLAP_TOKENS:
                        break
                    tail.insert(0, p)
                    kept += approx_tokens(p)
                buf = tail
        if buf:
            chunks.append({"heading": heading, "content": "\n\n".join(buf)})

    for i, c in enumerate(chunks):
        c["ordinal"] = i
        c["tokenCount"] = approx_tokens(c["content"])
        c["contentHash"] = hashlib.sha256(c["content"].encode()).hexdigest()
    return chunks


# ---------------------------------------------------------------------------
# Embedding
# ---------------------------------------------------------------------------

async def embed_batch(http: httpx.AsyncClient, texts: list[str]) -> list[list[float]]:
    """
    Workers AI bge-m3. Multilingual, which is why it was chosen — it handles
    Shona and Ndebele, not just English. Same model as news.articles, so
    dimensions and similarity match across both corpora.
    """
    res = await http.post(
        f"https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}/ai/run/{EMBED_MODEL}",
        headers={"Authorization": f"Bearer {CF_API_TOKEN}"},
        json={"text": texts},
        timeout=90,
    )
    res.raise_for_status()
    payload = res.json()
    if not payload.get("success"):
        raise RuntimeError(f"embedding failed: {payload.get('errors')}")

    vectors = payload["result"]["data"]
    for v in vectors:
        if len(v) != EMBED_DIMS:
            raise RuntimeError(
                f"embedding dim {len(v)} != {EMBED_DIMS}; the vector index "
                "expects 1024. Do not ingest with mismatched dimensions."
            )
    return vectors


# ---------------------------------------------------------------------------
# Ingest
# ---------------------------------------------------------------------------

async def load_source(pg: asyncpg.Connection, slug_or_name: str) -> asyncpg.Record:
    row = await pg.fetchrow(
        """
        select id, name, url, authority, jurisdiction, resource_type, license,
               is_approved, ground_eligible, mind_eligible, language
        from corpus_sources
        where name ilike $1 or name ilike '%' || $1 || '%'
        limit 1
        """,
        slug_or_name,
    )
    if not row:
        sys.exit(f"no corpus_source matching '{slug_or_name}'. Run --list.")

    if not row["is_approved"]:
        sys.exit(
            f"REFUSED: '{row['name']}' is not approved.\n"
            f"  licence status: {row['license']}\n"
            "Read the source's terms, then set is_approved and ground_eligible "
            "in corpus_sources. This script will not guess at licensing."
        )
    if not row["ground_eligible"]:
        sys.exit(f"REFUSED: '{row['name']}' is approved but not ground_eligible.")
    return row


async def ingest(
    source_name: str,
    text: str,
    title: str,
    slug: str,
    effective_from: date | None,
    dataset: str,
) -> None:
    pg = await asyncpg.connect(PG_DSN)
    mongo = AsyncIOMotorClient(MONGODB_URI)
    http = httpx.AsyncClient()

    try:
        src = await load_source(pg, source_name)
        ds = await pg.fetchrow("select id from datasets where name = $1", dataset)
        if not ds:
            sys.exit(f"no dataset named '{dataset}'")

        chunks = chunk_document(text)
        if not chunks:
            sys.exit("no chunks produced — check the input file")
        print(f"  {len(chunks)} chunks from {len(text):,} chars")

        license_class = "open_weight" if src["mind_eligible"] else "restricted"

        # 1. Postgres audit record.
        doc_id = await pg.fetchval(
            """
            insert into documents
              (dataset_id, title, content, language, domain, source_url, source_name,
               quality, token_count, char_count, content_hash, authority,
               effective_from, license_class, source_license, metadata)
            values ($1,$2,$3,$4::language_code,$5::domain_tag,$6,$7,
                    'raw'::data_quality,$8,$9,$10,$11,$12,$13::license_class,$14,$15)
            returning id
            """,
            ds["id"], title, text, src["language"] or "en", "legal",
            src["url"], src["name"],
            sum(c["tokenCount"] for c in chunks), len(text),
            hashlib.sha256(text.encode()).hexdigest(),
            src["authority"], effective_from, license_class, src["license"],
            {"slug": slug, "chunker": "heading-aware-v1"},
        )
        print(f"  postgres document {doc_id}")

        # 2. Embed and write to Mongo.
        kb = mongo["shamwari"].knowledgeBase
        now = datetime.now(timezone.utc)
        written = 0

        for i in range(0, len(chunks), 32):
            batch = chunks[i : i + 32]
            vectors = await embed_batch(http, [c["content"] for c in batch])

            docs = [
                {
                    "sourceSlug": slug,
                    "documentId": str(doc_id),
                    "ordinal": c["ordinal"],
                    "heading": c["heading"],
                    "content": c["content"],
                    "contentHash": c["contentHash"],
                    "tokenCount": c["tokenCount"],
                    "embedding": vec,
                    "embeddingModel": EMBED_MODEL,
                    "title": title,
                    "authority": src["authority"],
                    "resourceType": src["resource_type"],
                    "jurisdiction": src["jurisdiction"],
                    "language": src["language"] or "en",
                    "sourceUrl": src["url"],
                    "effectiveFrom": (
                        datetime.combine(effective_from, datetime.min.time(), timezone.utc)
                        if effective_from
                        else None
                    ),
                    # null = shared platform corpus, per the three-layer model.
                    # A tenant-private document would carry the entity id here.
                    "ownerEntityId": None,
                    "supersededBy": None,
                    "licenseClass": license_class,
                    "isActive": True,
                    "lastCheckedAt": now,
                    "createdAt": now,
                }
                for c, vec in zip(batch, vectors)
            ]
            await kb.insert_many(docs, ordered=False)
            written += len(docs)
            print(f"  embedded and wrote {written}/{len(chunks)}")

        # 3. Close the loop.
        await pg.execute(
            "update documents set mongodb_ground_id = $1, quality = 'cleaned'::data_quality "
            "where id = $2",
            slug, doc_id,
        )
        await pg.execute(
            "update corpus_sources set last_checked_at = now(), "
            "doc_count = coalesce(doc_count,0) + 1 where id = $1",
            src["id"],
        )
        print(f"\n  done. {written} chunks live in shamwari.knowledgeBase")
        print(f"  licenseClass: {license_class}")
        if license_class == "restricted":
            print("  NOTE: retrieval-only. Not eligible as Mind training data.")

    finally:
        await pg.close()
        mongo.close()
        await http.aclose()


async def list_sources() -> None:
    pg = await asyncpg.connect(PG_DSN)
    rows = await pg.fetch(
        """
        select name, authority, resource_type, refresh_cadence,
               is_approved, ground_eligible, mind_eligible, license
        from corpus_sources
        order by ground_eligible desc, is_approved desc, name
        """
    )
    for r in rows:
        flag = "OK " if (r["is_approved"] and r["ground_eligible"]) else "BLOCKED"
        print(f"{flag:8} {r['name'][:52]:54} {r['resource_type'] or '-':14} {r['license'][:40]}")
    await pg.close()


async def due() -> None:
    pg = await asyncpg.connect(PG_DSN)
    rows = await pg.fetch("select name, authority, refresh_cadence, last_checked_at "
                          "from ground_refresh_due where is_due order by last_checked_at nulls first")
    if not rows:
        print("nothing due")
    for r in rows:
        print(f"{r['refresh_cadence']:10} {r['name'][:56]:58} last: {r['last_checked_at']}")
    await pg.close()


def main() -> None:
    p = argparse.ArgumentParser(description="Shamwari Ground ingestion")
    p.add_argument("--list", action="store_true", help="show corpus sources and licence status")
    p.add_argument("--due", action="store_true", help="show sources needing a refresh")
    p.add_argument("--source", help="corpus_sources name or fragment")
    p.add_argument("--file", help="local text file to ingest")
    p.add_argument("--title", help="document title as it should appear in citations")
    p.add_argument("--slug", help="stable slug, e.g. constitution-2013")
    p.add_argument("--effective-from", help="ISO date the text takes effect")
    p.add_argument("--dataset", default="zw-law-v1")
    a = p.parse_args()

    if a.list:
        asyncio.run(list_sources())
        return
    if a.due:
        asyncio.run(due())
        return
    if not (a.source and a.file and a.title and a.slug):
        p.error("--source, --file, --title and --slug are required")

    text = open(a.file, encoding="utf-8").read()
    eff = date.fromisoformat(a.effective_from) if a.effective_from else None
    print(f"ingesting '{a.title}' from source '{a.source}'")
    asyncio.run(ingest(a.source, text, a.title, a.slug, eff, a.dataset))


if __name__ == "__main__":
    main()
