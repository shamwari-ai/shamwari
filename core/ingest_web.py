"""
Load a website's full-text export into Ground on Supabase (db/supabase/03-ground-pgvector.sql).

    python ingest_web.py --source "Zimbabwe Travel Information (travel-info.co.zw)" \
        --file ./travel-info-llms-full.txt --slug travel-info-co-zw --authority "Zimbabwe Travel Information" \
        --resource-type "travel guide" [--dry-run] [--replace]

The file is an `llms-full.txt` export: pages that each start with `# Title` and a `Source: <url>` line. Each
page is split at its `##`/`###` headings into passages of at most MAX_WORDS words, cited as "Page — Section".
Legal and admin pages (terms, privacy, cookies, changelog, contact) are skipped.

Same licence gate as ingest_ground.py: the source must exist in public.corpus_sources with is_approved and
ground_eligible, or nothing is written. Nothing is fetched here: the operator supplies the file.

Credentials, read only when not --dry-run, and never printed:
  CF_ACCOUNT_ID, CF_API_TOKEN (or CLOUDFLARE_TOKEN)  Workers AI, for the bge-m3 embeddings (1024 dims)
  SUPABASE_URL, SUPABASE_SECRET_KEY                   ground_ingest (service role). Where a network proxy adds
                                                      the key to requests, SUPABASE_SECRET_KEY may be a placeholder.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import urllib.parse
import urllib.request

MAX_WORDS = 450
CHUNKER = "llms-full-sections-v1"
EMBED_MODEL = "@cf/baai/bge-m3"
EMBED_BATCH = 50
WRITE_BATCH = 40
SKIP_PATHS = ("terms-of-service", "privacy-policy", "cookie-policy", "changelog", "contact")


def pages(text: str) -> list[dict]:
    """Split an llms-full.txt into pages: {title, url, body}."""
    out: list[dict] = []
    lines = text.splitlines()
    i = 0
    while i < len(lines):
        if lines[i].startswith("# ") and i + 1 < len(lines) and lines[i + 1].startswith("Source: "):
            title = lines[i][2:].strip()
            url = lines[i + 1][len("Source: "):].strip()
            j = i + 2
            while j < len(lines) and not (lines[j].startswith("# ") and j + 1 < len(lines) and lines[j + 1].startswith("Source: ")):
                j += 1
            out.append({"title": title, "url": url, "body": "\n".join(lines[i + 2 : j])})
            i = j
        else:
            i += 1
    return out


_FRONTMATTER = re.compile(r"^---\n.*?\n---\n", re.S)
_TITLED = re.compile(r'<(?:Accordion|Card|Tab|Step|Update)\b[^>]*\btitle=\{?"([^"]+)"\}?[^>]*>')
_TAG = re.compile(r"</?[A-Z][A-Za-z]*\b[^>]*/?>")
_IMG = re.compile(r"!\[[^\]]*\]\([^)]*\)")
_LINK = re.compile(r"\[([^\]]+)\]\((?:[^)(]|\([^)]*\))*\)")


def clean(md: str) -> str:
    """MDX to plain readable text: keep component titles as bold lines, drop tags and images, keep link text."""
    s = _FRONTMATTER.sub("", md)
    s = _TITLED.sub(lambda m: f"\n**{m.group(1)}**\n", s)
    s = _TAG.sub("", s)
    s = _IMG.sub("", s)
    s = _LINK.sub(r"\1", s)
    s = re.sub(r"\\([$*_])", r"\1", s)
    s = re.sub(r"[ \t]+\n", "\n", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()


def sections(page: dict) -> list[tuple[str | None, str]]:
    """(heading, text) for each ##/### section; text before the first heading has no heading."""
    out: list[tuple[str | None, str]] = []
    heading: str | None = None
    buf: list[str] = []
    for line in clean(page["body"]).splitlines():
        m = re.match(r"^(#{2,3})\s+(.*)$", line)
        if m:
            if "\n".join(buf).strip():
                out.append((heading, "\n".join(buf).strip()))
            heading, buf = m.group(2).strip(), []
        else:
            buf.append(line)
    if "\n".join(buf).strip():
        out.append((heading, "\n".join(buf).strip()))
    return out


def split_words(text: str, limit: int = MAX_WORDS) -> list[str]:
    """Split a long section at paragraph boundaries so no passage exceeds `limit` words (a single huge
    paragraph is split by words)."""
    parts: list[str] = []
    cur: list[str] = []
    n = 0
    for para in text.split("\n\n"):
        w = len(para.split())
        if w > limit:
            if cur:
                parts.append("\n\n".join(cur))
                cur, n = [], 0
            words = para.split()
            parts.extend(" ".join(words[k : k + limit]) for k in range(0, len(words), limit))
            continue
        if n + w > limit and cur:
            parts.append("\n\n".join(cur))
            cur, n = [], 0
        cur.append(para)
        n += w
    if cur:
        parts.append("\n\n".join(cur))
    return [p for p in parts if len(p.split()) >= 8]


def chunks(text: str, slug: str, authority: str, resource_type: str) -> list[dict]:
    rows: list[dict] = []
    for page in pages(text):
        if any(p in page["url"] for p in SKIP_PATHS):
            continue
        for heading, body in sections(page):
            for k, part in enumerate(split_words(body)):
                head = heading or None
                rows.append(
                    {
                        "slug": slug,
                        "chunk_index": len(rows),
                        "title": page["title"],
                        "heading": head,
                        "citation": f"{page['title']} — {head}" if head else page["title"],
                        "authority": authority,
                        "resource_type": resource_type,
                        "source_url": page["url"],
                        "language": "en",
                        "scope": "platform",
                        # The page title and section travel with the text, so a search on either finds it.
                        "content": f"{page['title']}{' — ' + head if head else ''}\n\n{part}",
                        "chunker": CHUNKER,
                        "mind_eligible": False,
                    }
                )
    return rows


def _post(url: str, headers: dict, body: object, timeout: int = 120) -> object:
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST", headers={"Content-Type": "application/json", **headers})
    with urllib.request.urlopen(req, timeout=timeout) as r:  # noqa: S310 (fixed https hosts)
        return json.loads(r.read() or b"null")


def embed(texts: list[str]) -> list[list[float]]:
    account = os.environ["CF_ACCOUNT_ID"]
    token = os.environ.get("CF_API_TOKEN") or os.environ["CLOUDFLARE_TOKEN"]
    out = _post(
        f"https://api.cloudflare.com/client/v4/accounts/{account}/ai/run/{EMBED_MODEL}",
        {"Authorization": f"Bearer {token}"},
        {"text": texts},
    )
    vecs = out["result"]["data"]  # type: ignore[index]
    if len(vecs) != len(texts) or any(len(v) != 1024 for v in vecs):
        raise SystemExit("REFUSED: embeddings came back the wrong shape")
    return vecs


def supabase(path: str, body: object, method: str = "POST") -> object:
    base = os.environ["SUPABASE_URL"].rstrip("/")
    key = os.environ.get("SUPABASE_SECRET_KEY", "proxy-injected")
    if method == "GET":
        req = urllib.request.Request(f"{base}{path}", headers={"apikey": key})
        with urllib.request.urlopen(req, timeout=60) as r:  # noqa: S310
            return json.loads(r.read())
    return _post(f"{base}{path}", {"apikey": key}, body)


def licence_gate(source: str) -> dict:
    q = urllib.parse.quote(source)
    rows = supabase(f"/rest/v1/corpus_sources?select=name,license,is_approved,ground_eligible,mind_eligible&name=eq.{q}", None, "GET")
    if not rows:
        raise SystemExit(f"REFUSED: no corpus_sources row named {source!r}")
    src = rows[0]  # type: ignore[index]
    if not (src["is_approved"] and src["ground_eligible"]):
        raise SystemExit(f"REFUSED: {source!r} is not approved and Ground-eligible ({src['license']})")
    return src


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(description="Load an llms-full.txt export into Ground on Supabase")
    p.add_argument("--source", required=True, help="exact corpus_sources name")
    p.add_argument("--file", required=True)
    p.add_argument("--slug", required=True)
    p.add_argument("--authority", required=True)
    p.add_argument("--resource-type", default="guide")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--replace", action="store_true", help="deactivate this slug's earlier passages first")
    a = p.parse_args(argv)

    text = open(a.file, encoding="utf-8").read()
    rows = chunks(text, a.slug, a.authority, a.resource_type)
    words = [len(r["content"].split()) for r in rows]
    print(f"{len(rows)} passages from {len(pages(text))} pages; words per passage: max {max(words)}, mean {sum(words) // len(words)}")
    print("sha256 of source:", hashlib.sha256(text.encode()).hexdigest()[:16])
    if a.dry_run:
        for r in rows[:3]:
            print("---", r["citation"], "|", r["source_url"]); print(r["content"][:300])
        return

    src = licence_gate(a.source)
    for r in rows:
        r["mind_eligible"] = bool(src["mind_eligible"])
    written = 0
    for i in range(0, len(rows), EMBED_BATCH):
        batch = rows[i : i + EMBED_BATCH]
        for r, v in zip(batch, embed([r["content"] for r in batch])):
            r["embedding"] = v
        for j in range(0, len(batch), WRITE_BATCH):
            part = batch[j : j + WRITE_BATCH]
            n = supabase("/rest/v1/rpc/ground_ingest", {"p_rows": part, "p_replace": a.replace and written == 0})
            written += int(n)  # type: ignore[arg-type]
        print(f"  {written}/{len(rows)} written")
    print(f"done: {written} passages for {a.slug!r} are live in ground.chunks")


if __name__ == "__main__":
    main(sys.argv[1:])
