"""
Ground citation evaluation: does retrieval put the right section in front of the model?

The gate for every change to the corpus, the chunker, the embedding model or the
retrieval pipeline. A question is a hit when one of its expected sections is among
the top k chunks. The score is hit-rate at 1, 3 and k, and mean reciprocal rank.

    python eval_ground.py --fixture                        # offline, synthetic corpus
    python eval_ground.py --text ./constitution.txt        # offline, YOUR text, lexical baseline
    python eval_ground.py --verify-labels --text ./constitution.txt
    python eval_ground.py --core-url https://shamwari-core.fly.dev --k 6   # the real store

Three things it does not claim:

  * `--fixture` runs on a synthetic corpus written for tests. It proves the harness,
    the chunker's citations and the metrics work. It says nothing about retrieval
    quality on the real law.
  * `--text` scores a keyword (BM25-style) retriever over the chunker's output. That is
    the floor the real store should beat: Core's hybrid retrieval adds vectors. A real
    store scoring below this floor is a bug in the corpus or the indexes.
  * Only `--core-url` measures what users get. It needs SHAMWARI_CORE_TOKEN, and for the
    vector half CF_ACCOUNT_ID and CF_API_TOKEN to embed the question as the Worker does;
    without them it measures the keyword half only and says so.

The text is never fetched here. `--text` reads a file you supply.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import os
import re
import sys
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

import ingest_ground

HERE = Path(__file__).parent
QUESTIONS = HERE / "eval" / "ground_questions.json"
FIXTURE = HERE / "eval" / "fixtures" / "synthetic-constitution.txt"

_STOP = frozenset(
    "a an and are as at be by can do does for from has have how i in is it its may me my of on or "
    "say says the their there this to under what when where which who why will with you your "
    "someone anyone person people".split()
)


def tokens(text: str) -> list[str]:
    return [t for t in re.findall(r"[a-z0-9]+", text.lower()) if t not in _STOP and len(t) > 1]


def stem(t: str) -> str:
    """Crude suffix stripping. Enough that 'discriminate' and 'discrimination' meet."""
    for suf in ("ations", "ation", "ions", "ion", "ings", "ing", "ers", "er", "ies", "es", "ed", "s", "e"):
        if t.endswith(suf) and len(t) - len(suf) >= 4:
            return t[: -len(suf)]
    return t


def terms(text: str) -> list[str]:
    return [stem(t) for t in tokens(text)]


@dataclass
class Hit:
    section: str | None
    heading: str = ""
    citation: str = ""


class Retriever(Protocol):
    async def search(self, question: str, k: int) -> list[Hit]: ...


class LexicalRetriever:
    """BM25 over chunks, with the heading counted three times and 'section N' honoured."""

    def __init__(self, chunks: list[dict[str, Any]], k1: float = 1.4, b: float = 0.75) -> None:
        self.chunks = chunks
        self.k1, self.b = k1, b
        self.docs = [
            Counter(terms(c["heading"]) * 3 + terms(c.get("sectionTitle") or "") * 2 + terms(c["content"]))
            for c in chunks
        ]
        self.lens = [sum(d.values()) for d in self.docs]
        self.avg = (sum(self.lens) / len(self.lens)) if self.lens else 1.0
        df: Counter[str] = Counter()
        for d in self.docs:
            df.update(d.keys())
        n = len(self.docs)
        self.idf = {t: math.log(1 + (n - f + 0.5) / (f + 0.5)) for t, f in df.items()}

    async def search(self, question: str, k: int) -> list[Hit]:
        q = terms(question)
        named = {n.upper() for n in re.findall(r"\b(?:section|sections|s)\s*(\d{1,3}[A-Za-z]?)\b", question, re.I)}
        scored: list[tuple[float, int]] = []
        for i, d in enumerate(self.docs):
            score = 0.0
            for t in q:
                f = d.get(t, 0)
                if f:
                    norm = f * (self.k1 + 1) / (f + self.k1 * (1 - self.b + self.b * self.lens[i] / self.avg))
                    score += self.idf.get(t, 0.0) * norm
            if self.chunks[i].get("kind") == "section" and self.chunks[i].get("section") in named:
                score += 100.0
            scored.append((score, i))
        scored.sort(key=lambda x: (-x[0], x[1]))
        return [
            Hit(self.chunks[i].get("section"), self.chunks[i]["heading"], self.chunks[i].get("citation", ""))
            for s, i in scored[:k]
            if s > 0
        ]


def section_of(chunk: dict[str, Any]) -> str | None:
    """The cited section of a chunk Core returned: the `section` field, else the heading's 's 56'."""
    if chunk.get("section"):
        return str(chunk["section"])
    m = re.match(r"\s*s\s+(\d+[A-Z]?)\b", chunk.get("heading") or "")
    return m.group(1) if m else None


class CoreRetriever:
    """The real store, through Core's /ground/search with platform scope (public corpus only)."""

    def __init__(self, url: str, token: str, embed: Any = None) -> None:
        self.url, self.token, self.embed = url.rstrip("/"), token, embed

    async def search(self, question: str, k: int) -> list[Hit]:
        import httpx

        body: dict[str, Any] = {
            "query": question,
            "owner_entity_id": "eval-harness",
            "scope": "platform",
            "destination": "cloud",
            "top_k": k,
        }
        if self.embed is not None:
            body["embedding"] = (await self.embed([question]))[0]
        async with httpx.AsyncClient(timeout=30) as http:
            r = await http.post(
                f"{self.url}/ground/search", json=body, headers={"Authorization": f"Bearer {self.token}"}
            )
        r.raise_for_status()
        return [
            Hit(section_of(c), c.get("heading") or "", c.get("citation") or "")
            for c in r.json().get("chunks", [])
        ]


@dataclass
class Result:
    id: str
    question: str
    expected: list[str]
    rank: int | None
    got: list[str | None]


@dataclass
class Report:
    k: int
    results: list[Result] = field(default_factory=list)

    def hit_at(self, n: int) -> float:
        return sum(1 for r in self.results if r.rank is not None and r.rank <= n) / max(1, len(self.results))

    @property
    def mrr(self) -> float:
        return sum((1 / r.rank) for r in self.results if r.rank) / max(1, len(self.results))

    def metrics(self) -> dict[str, float | int]:
        return {
            "questions": len(self.results),
            "k": self.k,
            "hit_at_1": round(self.hit_at(1), 4),
            "hit_at_3": round(self.hit_at(3), 4),
            f"hit_at_k": round(self.hit_at(self.k), 4),
            "mrr": round(self.mrr, 4),
        }

    def misses(self) -> list[Result]:
        return [r for r in self.results if r.rank is None]


def load_questions(path: Path = QUESTIONS) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    qs = data["questions"]
    ids = [q["id"] for q in qs]
    if len(set(ids)) != len(ids):
        raise ValueError("duplicate question ids")
    for q in qs:
        if not q.get("expected"):
            raise ValueError(f"{q['id']} has no expected section")
    return data


async def evaluate(retriever: Retriever, questions: list[dict[str, Any]], k: int = 6) -> Report:
    report = Report(k=k)
    for q in questions:
        hits = await retriever.search(q["question"], k)
        expected = {str(e).upper() for e in q["expected"]}
        rank = next(
            (i + 1 for i, h in enumerate(hits) if h.section and h.section.upper() in expected), None
        )
        report.results.append(
            Result(q["id"], q["question"], q["expected"], rank, [h.section for h in hits])
        )
    return report


def verify_labels(chunks: list[dict[str, Any]], questions: list[dict[str, Any]]) -> list[str]:
    """
    Check every label against the text it will be scored on. Returns problems; empty means
    every expected section exists and contains its evidence.
    """
    by_section: dict[str, str] = {}
    for c in chunks:
        if c.get("section") and c.get("kind") == "section":
            by_section[c["section"].upper()] = by_section.get(c["section"].upper(), "") + "\n" + c["content"]
    problems: list[str] = []
    for q in questions:
        present = [str(e).upper() for e in q["expected"] if str(e).upper() in by_section]
        for e in q["expected"]:
            if str(e).upper() not in by_section:
                problems.append(f"{q['id']}: section {e} not found in the text")
        if not present:
            continue
        # Real text is hard-wrapped, so a phrase can straddle a line break.
        blob = re.sub(r"\s+", " ", "\n".join(by_section[s] for s in present))
        for ev in q.get("evidence", []):
            if not re.search(ev, blob, re.I):
                problems.append(
                    f"{q['id']}: evidence /{ev}/ not found in section(s) {', '.join(present)}"
                )
    return problems


def compare_baseline(metrics: dict[str, Any], baseline: dict[str, Any], tolerance: float = 0.0) -> list[str]:
    """A score below the recorded baseline (by more than `tolerance`) is a regression."""
    out = []
    for key in ("hit_at_1", "hit_at_3", "hit_at_k", "mrr"):
        if key in baseline and metrics[key] + tolerance < baseline[key]:
            out.append(f"{key} {metrics[key]} < baseline {baseline[key]}")
    return out


def print_report(rep: Report, title: str) -> None:
    m = rep.metrics()
    print(f"\n{title}")
    print(f"  questions {m['questions']}   k={m['k']}")
    print(f"  hit@1 {m['hit_at_1']:.3f}   hit@3 {m['hit_at_3']:.3f}   hit@{m['k']} {m['hit_at_k']:.3f}   MRR {m['mrr']:.3f}")
    for r in rep.misses():
        print(f"  MISS {r.id}: expected {r.expected}, got {r.got}   {r.question}")


def build_retriever(args: argparse.Namespace, data: dict[str, Any]) -> tuple[Retriever, str, list[dict[str, Any]] | None]:
    if args.core_url:
        token = os.environ.get("SHAMWARI_CORE_TOKEN")
        if not token:
            sys.exit("SHAMWARI_CORE_TOKEN is not set (read it from your secret manager; it is never printed)")
        embed = None
        if os.environ.get("CF_ACCOUNT_ID") and os.environ.get("CF_API_TOKEN"):
            import httpx

            async def embed(texts: list[str]) -> list[list[float]]:
                async with httpx.AsyncClient() as http:
                    return await ingest_ground.embed_batch(
                        http, texts, os.environ["CF_ACCOUNT_ID"], os.environ["CF_API_TOKEN"]
                    )
        else:
            print("note: no CF_ACCOUNT_ID/CF_API_TOKEN, so questions are not embedded; this scores the keyword half only")
        return CoreRetriever(args.core_url, token, embed), f"real store via {args.core_url}", None

    path = Path(args.text) if args.text else FIXTURE
    text = path.read_text(encoding="utf-8")
    chunks = ingest_ground.chunk_document(text, data.get("cite_as"))
    label = "synthetic fixture (harness check only)" if not args.text else f"{path.name}, keyword baseline"
    return LexicalRetriever(chunks), f"offline: {label}", chunks


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Ground citation evaluation")
    src = p.add_mutually_exclusive_group()
    src.add_argument("--fixture", action="store_true", help="offline on the synthetic fixture (default)")
    src.add_argument("--text", help="offline on a text file you supply (keyword baseline)")
    src.add_argument("--core-url", help="the real store, through Core")
    p.add_argument("--questions", default=str(QUESTIONS))
    p.add_argument("--k", type=int, default=6)
    p.add_argument("--min-hit-at-k", type=float, help="exit 1 if hit@k is below this")
    p.add_argument("--min-hit-at-1", type=float, help="exit 1 if hit@1 is below this")
    p.add_argument("--baseline", help="JSON file of accepted scores; exit 1 on a regression")
    p.add_argument("--tolerance", type=float, default=0.0)
    p.add_argument("--verify-labels", action="store_true", help="check expected sections and evidence against --text")
    p.add_argument("--json", action="store_true", help="print metrics as JSON")
    a = p.parse_args(argv)

    data = load_questions(Path(a.questions))
    questions = data["questions"]
    retriever, title, chunks = build_retriever(a, data)

    if a.verify_labels:
        if chunks is None:
            p.error("--verify-labels needs --text or --fixture")
        problems = verify_labels(chunks, questions)
        for pr in problems:
            print("LABEL", pr)
        print(f"{len(questions)} questions, {len(problems)} label problems")
        return 1 if problems else 0

    rep = asyncio.run(evaluate(retriever, questions, a.k))
    if a.json:
        print(json.dumps(rep.metrics()))
    else:
        print_report(rep, title)

    m = rep.metrics()
    failed: list[str] = []
    if a.min_hit_at_k is not None and m["hit_at_k"] < a.min_hit_at_k:
        failed.append(f"hit@{a.k} {m['hit_at_k']} < required {a.min_hit_at_k}")
    if a.min_hit_at_1 is not None and m["hit_at_1"] < a.min_hit_at_1:
        failed.append(f"hit@1 {m['hit_at_1']} < required {a.min_hit_at_1}")
    if a.baseline:
        failed += compare_baseline(m, json.loads(Path(a.baseline).read_text()), a.tolerance)
    for f in failed:
        print("FAIL", f)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
