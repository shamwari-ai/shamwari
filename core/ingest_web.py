"""
Load a website's full-text export into Ground (MongoDB `shamwari.knowledgeBase`) through the Nyuchi API.

    python ingest_web.py --source "Zimbabwe Travel Information (travel-info.co.zw)" \
        --file ./travel-info-llms-full.txt --slug travel-info-co-zw \
        --dataset zw-travel-v1 [--dry-run] [--replace]

The file is an `llms-full.txt` export: pages that each start with `# Title` and a `Source: <url>` line. Each
page is split at its `##`/`###` headings into passages of at most MAX_WORDS words. Legal and admin pages
(terms, privacy, cookies, changelog, contact) are skipped.

Each page goes to `POST /v1/shamwari/ground/ingest` as one document (source slug `<slug>.<page>`), so a
citation reads "<page title> — <section>". The API does the rest, so this script holds no database or
Workers AI credential: it refuses a source that is not approved and Ground-eligible in `corpus_sources`,
stamps the licence class from the source, embeds every passage with bge-m3, and writes to Mongo all or
nothing. Nothing is fetched here: the operator supplies the file.

Credential, read only when not --dry-run, and never printed:
  NYUCHI_TOKEN   a signed-in person's token (WorkOS permission `data:admin`), sent as a bearer token. Where
                 a network proxy adds it to requests, it may be a placeholder.
"""
from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

MAX_WORDS = 450
API = "https://api.nyuchi.com"
#: The ingest route allows 12 requests a minute per caller.
PAUSE_SECONDS = 5.5
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


def documents(text: str, slug: str) -> list[dict]:
    """One ingest document per page: {source_slug, title, url, chunks: [{text, ordinal, heading}]}."""
    out: list[dict] = []
    for page in pages(text):
        if any(p in page["url"] for p in SKIP_PATHS):
            continue
        chunks: list[dict] = []
        for heading, body in sections(page):
            for part in split_words(body):
                # The page title and section travel with the text, so a search on either finds it.
                text_ = f"{page['title']}{' — ' + heading if heading else ''}\n\n{part}"
                chunks.append({"text": text_[:8000], "ordinal": len(chunks), "heading": heading})
        if not chunks:
            continue
        path = re.sub(r"[^A-Za-z0-9._-]+", "-", page["url"].split("://", 1)[-1].split("/", 1)[-1].strip("/")) or "home"
        out.append({"source_slug": f"{slug}.{path}"[:100].rstrip("-."), "title": page["title"][:500], "url": page["url"], "chunks": chunks[:500]})
    return out


def ingest(doc: dict, a: argparse.Namespace) -> dict:
    body = {
        "source_name": a.source,
        "source_slug": doc["source_slug"],
        "title": doc["title"],
        "effective_from": a.effective_from,
        "dataset": a.dataset,
        "licence_class": a.licence_class,
        "chunks": doc["chunks"],
    }
    url = f"{a.api.rstrip('/')}/v1/shamwari/ground/ingest?replace={'true' if a.replace else 'false'}"
    token = os.environ.get("NYUCHI_TOKEN", "proxy-injected")
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode(),
        method="POST",
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as r:  # noqa: S310 (fixed https host)
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        detail = e.read()[:500].decode("utf-8", "replace")
        raise SystemExit(f"REFUSED: {doc['source_slug']}: HTTP {e.code} {detail}") from None


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(description="Load an llms-full.txt export into Ground through the Nyuchi API")
    p.add_argument("--source", required=True, help="exact corpus_sources name")
    p.add_argument("--file", required=True)
    p.add_argument("--slug", required=True, help="prefix for each page's source slug")
    p.add_argument("--dataset", required=True, help="datasets.name in the corpus registry")
    p.add_argument("--licence-class", default="restricted", choices=["restricted", "open_weight"],
                   help="must match the source: open_weight only if it is Mind-eligible")
    p.add_argument("--effective-from", default=datetime.date.today().isoformat())
    p.add_argument("--api", default=API)
    p.add_argument("--only", type=int, default=0, help="load only the first N pages (a trial run)")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--replace", action="store_true", help="retire each page's earlier passages")
    a = p.parse_args(argv)

    text = open(a.file, encoding="utf-8").read()
    docs = documents(text, a.slug)
    if a.only:
        docs = docs[: a.only]
    words = [len(c["text"].split()) for d in docs for c in d["chunks"]]
    print(f"{len(words)} passages in {len(docs)} pages; words per passage: max {max(words)}, mean {sum(words) // len(words)}")
    print("sha256 of source:", hashlib.sha256(text.encode()).hexdigest()[:16])
    if a.dry_run:
        for d in docs[:3]:
            print("---", d["source_slug"], "|", d["title"], "|", len(d["chunks"]), "passages")
            print(d["chunks"][0]["text"][:300])
        return

    total = 0
    for i, d in enumerate(docs):
        if i:
            time.sleep(PAUSE_SECONDS)
        out = ingest(d, a)
        total += int(out.get("chunks", 0))
        print(f"  {i + 1}/{len(docs)} {d['source_slug']}: {out.get('chunks')} passages")
    print(f"done: {total} passages from {len(docs)} pages are live in Ground")


if __name__ == "__main__":
    main(sys.argv[1:])
