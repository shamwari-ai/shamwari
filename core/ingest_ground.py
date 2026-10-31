"""
Shamwari Ground ingestion.

    python ingest_ground.py --source "Constitution of Zimbabwe" --file ./constitution.txt \
        --title "Constitution of Zimbabwe Amendment (No. 20) Act 2013" --slug constitution-2013 \
        --effective-from 2013-05-22 --dataset zw-law-v1
    python ingest_ground.py --dry-run --file ./constitution.txt   # chunk + show citations, touch nothing
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

CREDENTIALS
-----------
Read when a command needs them, not at import: `--dry-run` needs none, `--list`
and `--due` need only SUPABASE_DB_URL, an ingest needs all four of SUPABASE_DB_URL,
MONGODB_URI, CF_ACCOUNT_ID and CF_API_TOKEN. They are for this script, run from
the operator's own shell. The running Core service never reads them
(test_deploy_config.py).

LICENCE GATE
------------
A source must be `is_approved = true` AND `ground_eligible = true` before
anything is ingested. `mind_eligible` is tracked separately and copied onto
each chunk — Ground eligibility is broad (retrieval with citation),
Mind eligibility is narrow (training data, needs a licence that permits it).

The script refuses to ingest an unapproved source. It does not warn and
continue. It also does not fetch anything: the text comes from a file the
operator supplies, so the operator, not this script, has read the source's terms.

CITATIONS
---------
A chunk is a section, or a run of subsections of a long section, and carries its
chapter, section number, title and subsection range, so the answer can say
"section 56(1)–(3)" and not "chunk 47". `heading` is the human form; `section`
and `citation` are the machine and display forms. See chunk_document.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import os
import re
import sys
from collections.abc import Awaitable, Callable
from datetime import date, datetime, timezone
from typing import Any

EMBED_MODEL = "@cf/baai/bge-m3"
EMBED_DIMS = 1024
TARGET_TOKENS = 500
OVERLAP_TOKENS = 60
CHUNKER = "section-aware-v2"

Embedder = Callable[[list[str]], Awaitable[list[list[float]]]]


# ---------------------------------------------------------------------------
# Chunking
# ---------------------------------------------------------------------------

#: Ordinals, as they appear in "SIXTH SCHEDULE".
_ORDINALS = (
    "FIRST|SECOND|THIRD|FOURTH|FIFTH|SIXTH|SEVENTH|EIGHTH|NINTH|TENTH|ELEVENTH|TWELFTH"
)

#: Case-sensitive CHAPTER: a wrapped body line that begins "Chapter 4 applies" must not open one.
_CHAPTER = re.compile(r"^CHAPTER\s+(\d+|[IVXLC]+)\b[\s:.\-–—]*(.*)$")
_PART = re.compile(r"^(?:PART|Part)\s+(\d+|[IVXLC]+)\b[\s:.\-–—]*(.*)$")
#: Whole-line, upper-case: a wrapped "Second schedule of the Act sets out..." is body text.
_SCHEDULE = re.compile(rf"^(?:({_ORDINALS})\s+SCHEDULE|SCHEDULE\s+(\d+))(\s*\(.*\))?\s*$")
#: "56 Equality and non-discrimination", "56. Equality", "Section 56 Equality".
_SECTION = re.compile(r"^(?:Section\s+)?(\d{1,3}[A-Z]?)\.?\s+([A-Z][^\n]{2,110})$")
_SUBSECTION = re.compile(r"^\((\d{1,3}[A-Z]?)\)\s")
_PAGE_NUMBER = re.compile(r"^(?:page\s+)?\d{1,4}$", re.IGNORECASE)
_TOC_LEADER = re.compile(r"\s*(?:\.{3,}|·{3,}|_{3,})\s*\d*\s*$")
_ARRANGEMENT = re.compile(r"^\s*ARRANGEMENT OF (?:SECTIONS|PARAGRAPHS)\s*$", re.IGNORECASE)

#: A section heading is a short title, not a sentence. A line that ends like one
#: is a wrapped line of body text that happens to start with a number.
_NOT_A_TITLE_END = (".", ";", ",", ":")

#: Section numbers only go forward inside the body. A numbered line that goes
#: backwards ("22 May 2013" after section 91) is wrapped body text, not a heading.
#: The ceiling only has to be wider than a partial extract's gaps.
_MAX_JUMP = 400


def approx_tokens(text: str) -> int:
    """Cheap estimate. Good enough for sizing; not used for billing."""
    return max(1, len(text) // 4)


def clean_text(text: str) -> list[str]:
    """
    Lines, with the furniture of a PDF-to-text conversion removed: form feeds,
    page numbers, table-of-contents leaders, and running headers (a short line
    that repeats many times and is not a heading).
    """
    lines = [ln.rstrip() for ln in text.replace("\r\n", "\n").replace("\f", "\n").split("\n")]
    counts: dict[str, int] = {}
    for ln in lines:
        s = ln.strip()
        if s and len(s) < 100:
            counts[s] = counts.get(s, 0) + 1
    out: list[str] = []
    for ln in lines:
        s = _TOC_LEADER.sub("", ln.strip())
        if _PAGE_NUMBER.match(s):
            continue
        # A running header is a phrase, not a legal connective: "and" / "or" between the
        # items of a list repeat dozens of times and are part of the text.
        if (
            counts.get(ln.strip(), 0) >= 8
            and len(s) >= 15
            and " " in s
            and not _SECTION.match(s)
            and not _CHAPTER.match(s)
        ):
            continue
        out.append(s)
    return out


def strip_arrangement(lines: list[str]) -> list[str]:
    """
    Drop the cover matter and the table of contents. The contents list names
    every heading with no body, so left in it would register each section twice.

    The body starts where the contents list's first chapter heading appears for
    the second time. A PREAMBLE between the two (the Constitution puts it there)
    is kept.
    """
    start = next((i for i, ln in enumerate(lines) if _ARRANGEMENT.match(ln)), None)
    if start is None:
        return lines
    first = next((i for i in range(start + 1, len(lines)) if _CHAPTER.match(lines[i])), None)
    if first is None:
        return lines
    body = next((i for i in range(first + 1, len(lines)) if lines[i] == lines[first]), None)
    if body is None:
        # Only one chapter heading: nothing follows the list to find.
        return lines
    gap = lines[start:body]
    pre = next((i for i, ln in enumerate(gap) if ln.strip().upper() == "PREAMBLE"), None)
    return (gap[pre:] if pre is not None else []) + lines[body:]


def _roman_or_int(token: str) -> str:
    return token.upper()


def parse_structure(text: str) -> list[dict[str, Any]]:
    """
    Walk the text and return sections: {kind, number, title, chapter, chapter_title,
    part, lines}. `kind` is "section" in the body and "paragraph" inside a schedule.
    """
    lines = strip_arrangement(clean_text(text))

    chapter: str | None = None
    chapter_title: str | None = None
    part: str | None = None
    schedule: str | None = None
    expect_chapter_title = False
    expect_part_title = False
    part_title: str | None = None
    last_number = 0
    sections: list[dict[str, Any]] = []
    cur: dict[str, Any] | None = None
    preamble: list[str] = []

    def open_section(kind: str, number: str, title: str) -> dict[str, Any]:
        return {
            "kind": kind,
            "number": number,
            "title": title.strip(),
            "chapter": chapter,
            "chapter_title": chapter_title,
            "part": part,
            "part_title": part_title,
            "schedule": schedule,
            "lines": [],
        }

    for s in lines:
        if not s:
            if cur is not None:
                cur["lines"].append("")
            continue

        m = _SCHEDULE.match(s)
        if m:
            if cur:
                sections.append(cur)
                cur = None
            schedule = (m.group(1) or f"{m.group(2)}").strip().title()
            chapter, chapter_title, part, part_title, last_number = None, None, None, None, 0
            continue

        m = _CHAPTER.match(s)
        if m and schedule is None and len(s) < 120 and (not m.group(2) or m.group(2)[0].isupper()):
            if cur:
                sections.append(cur)
                cur = None
            chapter = _roman_or_int(m.group(1))
            chapter_title = m.group(2).strip().title() or None
            expect_chapter_title = chapter_title is None
            part, part_title = None, None
            continue

        if expect_chapter_title:
            expect_chapter_title = False
            if s.isupper() and len(s) < 100 and not _SECTION.match(s):
                chapter_title = s.title()
                continue

        m = _PART.match(s)
        if (
            m
            and len(s) < 100
            and not s.endswith(_NOT_A_TITLE_END)
            and (not m.group(2) or m.group(2)[0].isupper())
        ):
            part = f"{_roman_or_int(m.group(1))}"
            part_title = m.group(2).strip() or None
            expect_part_title = part_title is None
            continue

        if expect_part_title:
            expect_part_title = False
            if cur is None and len(s) < 100 and not _SECTION.match(s):
                part_title = s
                continue

        m = _SECTION.match(s)
        if m and not s.endswith(_NOT_A_TITLE_END):
            number, title = m.group(1), m.group(2)
            digits = int(re.match(r"\d+", number).group())  # type: ignore[union-attr]
            in_schedule = schedule is not None
            if last_number == 0:
                # The first heading: inside a chapter or schedule, or section 1, or spelled
                # "Section N". A cover line such as "22 May 2013 ..." is none of these and must
                # not open section 22 and swallow sections 1 to 21.
                plausible = (
                    chapter is not None
                    or in_schedule
                    or digits == 1
                    or s.startswith("Section ")
                ) and digits <= _MAX_JUMP * 40
            else:
                plausible = last_number <= digits <= last_number + _MAX_JUMP
            if plausible:
                if cur:
                    sections.append(cur)
                cur = open_section("paragraph" if in_schedule else "section", number, title)
                last_number = digits
                continue

        if cur is not None:
            cur["lines"].append(s)
        else:
            preamble.append(s)

    if cur:
        sections.append(cur)

    preamble = [x for x in preamble if x.strip().upper() != "PREAMBLE"]
    pre = "\n".join(x for x in preamble if x).strip()
    if pre:
        sections.insert(
            0,
            {
                "kind": "preamble" if sections else "document",
                "number": None,
                "title": "Preamble" if sections else None,
                "chapter": None,
                "chapter_title": None,
                "part": None,
                "part_title": None,
                "schedule": None,
                "lines": pre.split("\n"),
            },
        )
    return sections


def _subsection_blocks(lines: list[str]) -> list[tuple[str | None, str]]:
    """Split a section's body at its top-level (1), (2) ... markers."""
    blocks: list[tuple[str | None, list[str]]] = [(None, [])]
    for ln in lines:
        m = _SUBSECTION.match(ln)
        if m and ln.strip():
            blocks.append((m.group(1), [ln]))
        else:
            blocks[-1][1].append(ln)
    out = [(label, "\n".join(b).strip()) for label, b in blocks]
    return [(label, text) for label, text in out if text]


def _ref(number: str | None, kind: str, schedule: str | None, subs: list[str], whole: bool) -> str:
    if kind == "preamble":
        return "Preamble"
    if kind == "document":
        return ""
    base = f"s {number}" if kind == "section" else f"{schedule or ''} Schedule, para {number}".strip()
    if whole or not subs:
        return base
    return f"{base}({subs[0]})" if len(subs) == 1 else f"{base}({subs[0]})–({subs[-1]})"


def _pack(blocks: list[tuple[str | None, str]]) -> list[list[tuple[str | None, str]]]:
    """Group consecutive subsections up to TARGET_TOKENS; never split one across groups here."""
    groups: list[list[tuple[str | None, str]]] = []
    cur: list[tuple[str | None, str]] = []
    size = 0
    for b in blocks:
        t = approx_tokens(b[1])
        if cur and size + t > TARGET_TOKENS:
            groups.append(cur)
            cur, size = [], 0
        cur.append(b)
        size += t
    if cur:
        groups.append(cur)
    return groups


def _split_long(text: str) -> list[str]:
    """One over-long subsection: split on paragraphs, with a carried tail."""
    paras = [p.strip() for p in re.split(r"\n\s*\n|\n(?=\([a-z]{1,3}\)\s)", text) if p.strip()]
    pieces: list[str] = []
    buf: list[str] = []
    fresh = False  # paragraphs added since the last cut, beyond the carried overlap
    for para in paras:
        buf.append(para)
        fresh = True
        if approx_tokens("\n\n".join(buf)) >= TARGET_TOKENS:
            pieces.append("\n\n".join(buf))
            fresh = False
            tail: list[str] = []
            kept = 0
            for p in reversed(buf):
                if kept >= OVERLAP_TOKENS:
                    break
                tail.insert(0, p)
                kept += approx_tokens(p)
            buf = tail
    if buf and (fresh or not pieces):
        pieces.append("\n\n".join(buf))
    return pieces or [text]


def chunk_document(text: str, cite_as: str | None = None) -> list[dict[str, Any]]:
    """
    Section-aware chunking.

    A section shorter than the target stays whole: a self-contained section is a
    better retrieval unit than a padded one. A longer one is cut at subsection
    boundaries, and only a single subsection that is itself too long is cut on
    paragraphs, with overlap so a fact spanning the cut is still retrievable.

    Each chunk carries what a citation needs: chapter, section, title, the
    subsection range it covers, and `heading` / `citation` strings built from them.
    """
    sections = parse_structure(text)
    chunks: list[dict[str, Any]] = []

    def emit(sec: dict[str, Any], content: str, subs: list[str], whole: bool) -> None:
        if not content.strip():
            return
        ref = _ref(sec["number"], sec["kind"], sec["schedule"], subs, whole)
        title = sec["title"] if sec["kind"] not in ("preamble", "document") else None
        heading = f"{ref} {title}".strip() if title else ref
        chunks.append(
            {
                "heading": heading,
                "content": content.strip(),
                "kind": sec["kind"],
                "chapter": sec["chapter"],
                "chapterTitle": sec["chapter_title"],
                "part": sec["part"],
                "partTitle": sec["part_title"],
                "schedule": sec["schedule"],
                # A schedule paragraph's number is not a section's: namespaced so "3" is only ever
                # section 3, in the store and in every consumer.
                "section": sec["number"] if sec["kind"] == "section" else (
                    f"{sec['schedule']}:{sec['number']}" if sec["kind"] == "paragraph" else None
                ),
                "sectionTitle": title,
                "subsections": subs,
                "citation": (f"{cite_as}, {ref}" if ref else cite_as) if cite_as else ref,
            }
        )

    for sec in sections:
        blocks = _subsection_blocks(sec["lines"])
        body = "\n".join(sec["lines"]).strip()
        if approx_tokens(body) <= TARGET_TOKENS:
            emit(sec, body, [lab for lab, _ in blocks if lab], True)
            continue
        for group in _pack(blocks):
            subs = [lab for lab, _ in group if lab]
            joined = "\n\n".join(t for _, t in group)
            if len(group) == 1 and approx_tokens(joined) > TARGET_TOKENS:
                for piece in _split_long(joined):
                    emit(sec, piece, subs, False)
            else:
                emit(sec, joined, subs, False)

    for i, c in enumerate(chunks):
        c["ordinal"] = i
        c["tokenCount"] = approx_tokens(c["content"])
        c["contentHash"] = hashlib.sha256(c["content"].encode()).hexdigest()
    return chunks


def embed_input(title: str, chunk: dict[str, Any]) -> str:
    """What is embedded: the heading travels with the text, so 'section 56' finds section 56."""
    return f"{title} — {chunk['heading']}\n{chunk['content']}"


# ---------------------------------------------------------------------------
# Embedding
# ---------------------------------------------------------------------------


def check_dims(vectors: list[list[float]], expected: int = EMBED_DIMS) -> None:
    """Refuse a vector the live index cannot query. Applies to any embedder, real or injected."""
    for v in vectors:
        if len(v) != expected:
            raise RuntimeError(
                f"embedding dim {len(v)} != {expected}; the vector index "
                f"expects {expected}. Do not ingest with mismatched dimensions."
            )


async def embed_batch(http: Any, texts: list[str], account_id: str, api_token: str) -> list[list[float]]:
    """
    Workers AI bge-m3. Multilingual, which is why it was chosen — it handles
    Shona and Ndebele, not just English. Same model as news.articles, so
    dimensions and similarity match across both corpora.
    """
    res = await http.post(
        f"https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run/{EMBED_MODEL}",
        headers={"Authorization": f"Bearer {api_token}"},
        json={"text": texts},
        timeout=90,
    )
    res.raise_for_status()
    payload = res.json()
    if not payload.get("success"):
        raise RuntimeError(f"embedding failed: {payload.get('errors')}")

    vectors = payload["result"]["data"]
    if len(vectors) != len(texts):
        raise RuntimeError(f"embedded {len(vectors)} of {len(texts)} texts")
    check_dims(vectors)
    return vectors


# ---------------------------------------------------------------------------
# Ingest
# ---------------------------------------------------------------------------


def _like_escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


async def load_source(pg: Any, slug_or_name: str) -> Any:
    """
    Resolve the source the licence gate applies to. An exact name wins; otherwise the
    fragment must match exactly one source. An ambiguous fragment is an error, never an
    arbitrary row: the approval and the licence class come from this row.
    """
    rows = await pg.fetch(
        """
        select id, name, url, authority, jurisdiction, resource_type, license,
               is_approved, ground_eligible, mind_eligible, language
        from corpus_sources
        where name ilike '%' || $1 || '%' escape '\\'
        order by name
        """,
        _like_escape(slug_or_name),
    )
    exact = [r for r in rows if r["name"].lower() == slug_or_name.lower()]
    candidates = exact or list(rows)
    if not candidates:
        sys.exit(f"no corpus_source matching '{slug_or_name}'. Run --list.")
    if len(candidates) > 1:
        sys.exit(
            f"'{slug_or_name}' matches {len(candidates)} sources: "
            + ", ".join(r["name"] for r in candidates)
            + ".\nUse the full name, so the licence gate applies to the source you mean."
        )
    row = candidates[0]

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


async def run_ingest(
    pg: Any,
    kb: Any,
    embed: Embedder,
    *,
    source_name: str,
    text: str,
    title: str,
    slug: str,
    effective_from: date | None,
    dataset: str,
    cite_as: str | None = None,
    replace: bool = False,
    log: Callable[[str], None] = print,
) -> dict[str, Any]:
    """
    The ingest itself, with its three collaborators passed in: a Postgres
    connection, the knowledgeBase collection and an embedder. The command line
    wires the real ones; the tests wire fakes, so every gate below is exercised
    without a network.
    """
    src = await load_source(pg, source_name)
    ds = await pg.fetchrow("select id from datasets where name = $1", dataset)
    if not ds:
        sys.exit(f"no dataset named '{dataset}'")

    chunks = chunk_document(text, cite_as or title)
    if not chunks:
        sys.exit("no chunks produced — check the input file")
    log(f"  {len(chunks)} chunks from {len(text):,} chars")

    # Ingest is additive. Running it twice would double every citation, so an
    # active slug already in the store is a stop, not a merge.
    existing = await kb.count_documents({"sourceSlug": slug, "isActive": True})
    if existing and not replace:
        sys.exit(
            f"REFUSED: '{slug}' already has {existing} active chunks in knowledgeBase.\n"
            "Re-run with --replace to retire them (soft: isActive=false, supersededBy set) "
            "and write the new text, or choose a new --slug."
        )

    license_class = "open_weight" if src["mind_eligible"] else "restricted"

    # Embed everything BEFORE writing anything, so a failed batch leaves no half-ingested
    # document behind: the vector dimension check, the one that protects the index, runs first.
    vectors: list[list[float]] = []
    for i in range(0, len(chunks), 32):
        batch = chunks[i : i + 32]
        got = await embed([embed_input(title, c) for c in batch])
        if len(got) != len(batch):
            raise RuntimeError(f"embedded {len(got)} of {len(batch)} texts")
        check_dims(got)
        vectors.extend(got)
        log(f"  embedded {len(vectors)}/{len(chunks)}")

    now = datetime.now(timezone.utc)
    doc_id: Any = None
    retired = 0
    try:
        # One transaction for the audit record: it commits only if the chunks reached Mongo
        # and the bookkeeping succeeded. A failure anywhere rolls the Postgres row back, and
        # whatever did reach Mongo is switched off below, so a half ingest never serves and
        # never leaves an audit row for text that is not there.
        async with pg.transaction():
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
                {"slug": slug, "chunker": CHUNKER},
            )
            log(f"  postgres document {doc_id}")

            docs = [
                {
                    "sourceSlug": slug,
                    "documentId": str(doc_id),
                    "ordinal": c["ordinal"],
                    "heading": c["heading"],
                    "content": c["content"],
                    "contentHash": c["contentHash"],
                    "tokenCount": c["tokenCount"],
                    # Citation fields: what an answer needs to say "section 56(1)-(3)".
                    "section": c["section"],
                    "sectionTitle": c["sectionTitle"],
                    "subsections": c["subsections"],
                    "chapter": c["chapter"],
                    "chapterTitle": c["chapterTitle"],
                    "part": c["part"],
                    "partTitle": c["partTitle"],
                    "kind": c["kind"],
                    "citation": c["citation"],
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
                for c, vec in zip(chunks, vectors)
            ]
            await kb.insert_many(docs, ordered=False)
            await pg.execute(
                "update documents set mongodb_ground_id = $1, quality = 'cleaned'::data_quality "
                "where id = $2",
                slug, doc_id,
            )
            if existing and replace:
                # The audit trail says which document is current.
                await pg.execute(
                    "update documents set superseded_by = $1 "
                    "where mongodb_ground_id = $2 and id <> $1 and superseded_by is null",
                    doc_id, slug,
                )
            await pg.execute(
                "update corpus_sources set last_checked_at = now(), "
                "doc_count = coalesce(doc_count,0) + $2 where id = $1",
                src["id"], 0 if (existing and replace) else 1,
            )
    except BaseException:
        if doc_id is not None:
            try:
                await kb.update_many({"documentId": str(doc_id)}, {"$set": {"isActive": False}})
            except Exception:  # noqa: BLE001 - the original error is the one to report
                pass
        raise

    # Retire the old text only after the new text is in and the audit record committed: a
    # failure above leaves the old text serving. If this step fails, old and new are both
    # active (duplicated, nothing lost): re-run with --replace.
    if existing and replace:
        res = await kb.update_many(
            {"sourceSlug": slug, "isActive": True, "documentId": {"$ne": str(doc_id)}},
            {"$set": {"isActive": False, "supersededBy": str(doc_id)}},
        )
        retired = res.modified_count

    log(f"\n  done. {len(docs)} chunks live in shamwari.knowledgeBase")
    if retired:
        log(f"  retired {retired} chunks from the previous ingest of '{slug}'")
    log(f"  licenseClass: {license_class}")
    if license_class == "restricted":
        log("  NOTE: retrieval-only. Not eligible as Mind training data.")
    return {"document_id": str(doc_id), "chunks": len(docs), "license_class": license_class,
            "retired": retired}


# ---------------------------------------------------------------------------
# Command line
# ---------------------------------------------------------------------------


def require_env(*names: str) -> dict[str, str]:
    missing = [n for n in names if not os.environ.get(n)]
    if missing:
        sys.exit(
            "missing environment: " + ", ".join(missing) + "\n"
            "These are for this script, in your own shell. Do not set them on the Core Fly app."
        )
    return {n: os.environ[n] for n in names}


async def ingest(
    source_name: str,
    text: str,
    title: str,
    slug: str,
    effective_from: date | None,
    dataset: str,
    cite_as: str | None = None,
    replace: bool = False,
) -> None:
    env = require_env("SUPABASE_DB_URL", "MONGODB_URI", "CF_ACCOUNT_ID", "CF_API_TOKEN")

    # Drivers after the credential check: a missing credential is named before a missing
    # driver is, and neither is needed by --dry-run.
    import asyncpg
    import httpx
    from motor.motor_asyncio import AsyncIOMotorClient

    pg = await asyncpg.connect(env["SUPABASE_DB_URL"])
    mongo = AsyncIOMotorClient(env["MONGODB_URI"])
    http = httpx.AsyncClient()

    async def embed(texts: list[str]) -> list[list[float]]:
        return await embed_batch(http, texts, env["CF_ACCOUNT_ID"], env["CF_API_TOKEN"])

    try:
        await run_ingest(
            pg, mongo["shamwari"].knowledgeBase, embed,
            source_name=source_name, text=text, title=title, slug=slug,
            effective_from=effective_from, dataset=dataset, cite_as=cite_as, replace=replace,
        )
    finally:
        await pg.close()
        mongo.close()
        await http.aclose()


def dry_run(text: str, cite_as: str, limit: int | None = None) -> list[dict[str, Any]]:
    """Chunk and print what would be cited. Touches no network and needs no credentials."""
    chunks = chunk_document(text, cite_as)
    for c in chunks[:limit]:
        where = f"ch {c['chapter']}" if c["chapter"] else (f"{c['schedule']} Sch" if c["schedule"] else "-")
        print(f"{c['ordinal']:4} {where:>8}  {c['citation'][-60:]:60}  {c['tokenCount']:4}t")
    sections = {c["section"] for c in chunks if c["section"]}
    print(f"\n{len(chunks)} chunks, {len(sections)} distinct sections/paragraphs")
    return chunks


async def list_sources() -> None:
    env = require_env("SUPABASE_DB_URL")
    import asyncpg

    pg = await asyncpg.connect(env["SUPABASE_DB_URL"])
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
    env = require_env("SUPABASE_DB_URL")
    import asyncpg

    pg = await asyncpg.connect(env["SUPABASE_DB_URL"])
    rows = await pg.fetch("select name, authority, refresh_cadence, last_checked_at "
                          "from ground_refresh_due where is_due order by last_checked_at nulls first")
    if not rows:
        print("nothing due")
    for r in rows:
        print(f"{r['refresh_cadence']:10} {r['name'][:56]:58} last: {r['last_checked_at']}")
    await pg.close()


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(description="Shamwari Ground ingestion")
    p.add_argument("--list", action="store_true", help="show corpus sources and licence status")
    p.add_argument("--due", action="store_true", help="show sources needing a refresh")
    p.add_argument("--dry-run", action="store_true",
                   help="chunk --file and print the citations; no network, no credentials")
    p.add_argument("--source", help="corpus_sources name or fragment")
    p.add_argument("--file", help="local UTF-8 text file to ingest (you supply it; nothing is fetched)")
    p.add_argument("--title", help="document title as it should appear in citations")
    p.add_argument("--slug", help="stable slug, e.g. constitution-2013")
    p.add_argument("--effective-from", help="ISO date the text takes effect")
    p.add_argument("--dataset", default="zw-law-v1")
    p.add_argument("--cite-as", help="short name used in citations (default: --title)")
    p.add_argument("--replace", action="store_true",
                   help="retire the active chunks of an existing --slug (soft) and write the new text")
    a = p.parse_args(argv)

    if a.list:
        asyncio.run(list_sources())
        return
    if a.due:
        asyncio.run(due())
        return
    if a.dry_run:
        if not a.file:
            p.error("--dry-run needs --file")
        with open(a.file, encoding="utf-8") as f:
            dry_run(f.read(), a.cite_as or a.title or "Document")
        return
    if not (a.source and a.file and a.title and a.slug):
        p.error("--source, --file, --title and --slug are required")

    with open(a.file, encoding="utf-8") as f:
        text = f.read()
    eff = date.fromisoformat(a.effective_from) if a.effective_from else None
    print(f"ingesting '{a.title}' from source '{a.source}'")
    asyncio.run(ingest(a.source, text, a.title, a.slug, eff, a.dataset, a.cite_as, a.replace))


if __name__ == "__main__":
    main()
