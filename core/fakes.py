"""
In-memory stand-ins for the stores, for tests and the offline end-to-end run.

Test-only: not copied into the image (the Dockerfile lists the files it ships).

The knowledge base here does not reimplement retrieval, it INTERPRETS the real
aggregation pipelines Core builds: `$rankFusion`, `$search`, `$vectorSearch`,
`$match`, `$limit`, `$project`. So the owner filter, the supersededBy filter and the
isActive filter that implement the three-layer scope model are the ones in
main.py::ground_search, running against fixture data. Change the pipeline in a way
that drops a filter and a test that plants another entity's personal chunk goes red.

What it is not: Atlas. Scoring is keyword overlap for `$search` and cosine similarity
for `$vectorSearch`, enough to rank deterministically. It says nothing about how
Atlas ranks.
"""

from __future__ import annotations

import hashlib
import math
import re
import uuid
from typing import Any

from eval_ground import terms

EMBED_DIMS = 1024


# ---------------------------------------------------------------------------
# Embedding
# ---------------------------------------------------------------------------

def hash_vector(text: str, dims: int = EMBED_DIMS) -> list[float]:
    """Deterministic bag-of-words vector: similar wording, similar vector. Unit length."""
    v = [0.0] * dims
    for t in terms(text):
        h = int.from_bytes(hashlib.sha256(t.encode()).digest()[:8], "big")
        v[h % dims] += 1.0 if (h >> 63) == 0 else -1.0
        v[(h >> 20) % dims] += 0.5
    norm = math.sqrt(sum(x * x for x in v)) or 1.0
    return [x / norm for x in v]


class CountingEmbedder:
    """An embedder that records every text it was asked to embed. Zero calls is a claim."""

    def __init__(self, dims: int = EMBED_DIMS) -> None:
        self.dims = dims
        self.calls: list[list[str]] = []

    async def __call__(self, texts: list[str]) -> list[list[float]]:
        self.calls.append(list(texts))
        return [hash_vector(t, self.dims) for t in texts]

    @property
    def texts(self) -> int:
        return sum(len(c) for c in self.calls)


# ---------------------------------------------------------------------------
# Mongo-ish matching
# ---------------------------------------------------------------------------

def _get(doc: dict[str, Any], key: str) -> Any:
    return doc.get(key)


def matches(doc: dict[str, Any], flt: dict[str, Any]) -> bool:
    """Equality, None-matches-missing, $in, $ne, $exists: the operators Core and the ingest use."""
    for key, want in flt.items():
        have = _get(doc, key)
        if isinstance(want, dict) and any(k.startswith("$") for k in want):
            for op, arg in want.items():
                if op == "$in":
                    if have not in arg and not (have is None and None in arg):
                        return False
                elif op == "$ne":
                    if have == arg:
                        return False
                elif op == "$exists":
                    if (key in doc) != bool(arg):
                        return False
                else:
                    raise NotImplementedError(f"operator {op}")
        elif have != want:
            return False
    return True


def cosine(a: list[float], b: list[float]) -> float:
    return sum(x * y for x, y in zip(a, b))


class Cursor:
    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self.rows = rows

    async def to_list(self, length: int | None = None) -> list[dict[str, Any]]:
        return self.rows if length is None else self.rows[:length]


class UpdateResult:
    def __init__(self, n: int) -> None:
        self.modified_count = n


class InsertResult:
    def __init__(self, ids: list[Any]) -> None:
        self.inserted_ids = ids


class Collection:
    def __init__(self, docs: list[dict[str, Any]] | None = None) -> None:
        self.docs: list[dict[str, Any]] = docs if docs is not None else []

    # -- writes -----------------------------------------------------------
    async def insert_many(self, docs: list[dict[str, Any]], ordered: bool = True) -> InsertResult:
        stored = [dict(d) for d in docs]
        for d in stored:
            d.setdefault("_id", uuid.uuid4().hex)
        self.docs.extend(stored)
        return InsertResult([d["_id"] for d in stored])

    async def insert_one(self, doc: dict[str, Any]) -> InsertResult:
        return await self.insert_many([doc])

    async def update_many(self, flt: dict[str, Any], update: dict[str, Any]) -> UpdateResult:
        n = 0
        for d in self.docs:
            if matches(d, flt):
                d.update(update.get("$set", {}))
                n += 1
        return UpdateResult(n)

    # -- reads ------------------------------------------------------------
    async def count_documents(self, flt: dict[str, Any]) -> int:
        return sum(1 for d in self.docs if matches(d, flt))

    async def find_one(self, flt: dict[str, Any], projection: Any = None) -> dict[str, Any] | None:
        return next((d for d in self.docs if matches(d, flt)), None)

    def aggregate(self, pipeline: list[dict[str, Any]]) -> Cursor:
        return Cursor(self._run(list(self.docs), pipeline))

    # -- pipeline ---------------------------------------------------------
    def _run(self, docs: list[dict[str, Any]], pipeline: list[dict[str, Any]]) -> list[dict[str, Any]]:
        rows = docs
        for stage in pipeline:
            (op, arg), = stage.items()
            if op == "$search":
                rows = self._search(rows, arg)
            elif op == "$vectorSearch":
                rows = self._vector(rows, arg)
            elif op == "$rankFusion":
                rows = self._rank_fusion(rows, arg)
            elif op == "$match":
                rows = [d for d in rows if matches(d, arg)]
            elif op == "$limit":
                rows = rows[:arg]
            elif op == "$group":
                rows = self._group(rows, arg)
            elif op == "$project":
                keep = [k for k, v in arg.items() if v == 1]
                rows = [{k: d[k] for k in keep if k in d} for d in rows]
            else:
                raise NotImplementedError(op)
        return rows

    @staticmethod
    def _group(rows: list[dict[str, Any]], arg: dict[str, Any]) -> list[dict[str, Any]]:
        """`$group` with `_id: None` and `$sum` of a field, of 1, or of an `$add`: the billing rollup."""
        if arg.get("_id") is not None:
            raise NotImplementedError("$group by key")
        if not rows:
            return []

        def value(d: dict[str, Any], expr: Any) -> float:
            if isinstance(expr, (int, float)):
                return expr
            if isinstance(expr, str):
                return d.get(expr.lstrip("$")) or 0
            (op, args), = expr.items()
            if op == "$add":
                return sum(value(d, a) for a in args)
            raise NotImplementedError(op)

        out: dict[str, Any] = {"_id": None}
        for name, spec in arg.items():
            if name == "_id":
                continue
            if set(spec) != {"$sum"}:
                raise NotImplementedError(f"accumulator {sorted(spec)}")
            out[name] = sum(value(d, spec["$sum"]) for d in rows)
        return [out]

    def _search(self, rows: list[dict[str, Any]], arg: dict[str, Any]) -> list[dict[str, Any]]:
        compound = arg["compound"]
        query = compound["must"][0]["text"]["query"]
        fields = compound["must"][0]["text"]["path"]
        # The compound filter Core passes to Atlas Search. Applied as Atlas would.
        for f in compound.get("filter", []):
            if "equals" in f:
                rows = [d for d in rows if d.get(f["equals"]["path"]) == f["equals"]["value"]]
        q = set(terms(query))
        scored = []
        for d in rows:
            have = set(terms(" ".join(str(d.get(p) or "") for p in fields)))
            score = len(q & have)
            if score:
                scored.append((score, d))
        scored.sort(key=lambda x: -x[0])
        return [d for _, d in scored]

    def _vector(self, rows: list[dict[str, Any]], arg: dict[str, Any]) -> list[dict[str, Any]]:
        rows = [d for d in rows if matches(d, arg.get("filter", {})) and d.get("embedding")]
        q = arg["queryVector"]
        rows.sort(key=lambda d: -cosine(q, d["embedding"]))
        return rows[: arg["limit"]]

    def _rank_fusion(self, rows: list[dict[str, Any]], arg: dict[str, Any]) -> list[dict[str, Any]]:
        weights = arg.get("combination", {}).get("weights", {})
        fused: dict[int, float] = {}
        by_id: dict[int, dict[str, Any]] = {}
        for name, sub in arg["input"]["pipelines"].items():
            for rank, d in enumerate(self._run(list(rows), sub), start=1):
                fused[id(d)] = fused.get(id(d), 0.0) + weights.get(name, 1) / (60 + rank)
                by_id[id(d)] = d
        return [by_id[i] for i in sorted(fused, key=lambda i: -fused[i])]


class Database:
    def __init__(self) -> None:
        self._cols: dict[str, Collection] = {}

    def __getattr__(self, name: str) -> Collection:
        if name.startswith("_"):
            raise AttributeError(name)
        return self._cols.setdefault(name, Collection())

    def __getitem__(self, name: str) -> Collection:
        return getattr(self, name)


class Client:
    """Stands in for motor's client: `client["shamwari"].knowledgeBase`."""

    def __init__(self) -> None:
        self._dbs: dict[str, Database] = {}

    def __getitem__(self, name: str) -> Database:
        return self._dbs.setdefault(name, Database())

    def close(self) -> None:
        pass


# ---------------------------------------------------------------------------
# Postgres
# ---------------------------------------------------------------------------

class Row(dict):
    """asyncpg's Record: item access."""


class _Tx:
    """asyncpg's transaction: writes made inside are kept only if the block exits cleanly."""

    def __init__(self, pg: "FakePg") -> None:
        self.pg = pg

    async def __aenter__(self) -> "_Tx":
        self.saved = (list(self.pg.inserted), list(self.pg.executed))
        return self

    async def __aexit__(self, exc_type: Any, exc: Any, tb: Any) -> bool:
        if exc_type is not None:
            self.pg.inserted, self.pg.executed = self.saved
            self.pg.rolled_back += 1
        return False


class FakePg:
    """Answers the handful of statements ingest_ground issues, and records every write."""

    def __init__(
        self,
        *,
        is_approved: bool = True,
        ground_eligible: bool = True,
        mind_eligible: bool = True,
        datasets: tuple[str, ...] = ("zw-law-v1",),
        extra_sources: tuple[str, ...] = (),
    ) -> None:
        def source(i: int, name: str, approved: bool) -> Row:
            return Row(
                id=i,
                name=name,
                url="https://www.parlzim.gov.zw/constitution-of-zimbabwe/",
                authority="Parliament of Zimbabwe",
                jurisdiction="ZW",
                resource_type="legislation",
                license="Public document (operator-confirmed)",
                is_approved=approved,
                ground_eligible=ground_eligible,
                mind_eligible=mind_eligible,
                language="en",
            )

        self.source = source(1, "Constitution of Zimbabwe", is_approved)
        self.sources = [self.source] + [source(i + 2, n, False) for i, n in enumerate(extra_sources)]
        self.datasets = datasets
        self.inserted: list[tuple[Any, ...]] = []
        self.executed: list[tuple[str, tuple[Any, ...]]] = []
        self.rolled_back = 0

    def transaction(self) -> _Tx:
        return _Tx(self)

    async def fetch(self, sql: str, *args: Any) -> list[Row]:
        if "from corpus_sources" in sql:
            # `ilike '%' || $1 || '%' escape '\\'`: a substring match with LIKE escapes undone.
            frag = re.sub(r"\\(.)", r"\1", args[0]).lower()
            return sorted((r for r in self.sources if frag in r["name"].lower()), key=lambda r: r["name"])
        raise NotImplementedError(sql)

    async def fetchrow(self, sql: str, *args: Any) -> Row | None:
        if "from datasets" in sql:
            return Row(id=7) if args[0] in self.datasets else None
        raise NotImplementedError(sql)

    async def fetchval(self, sql: str, *args: Any) -> Any:
        if "insert into documents" in sql:
            self.inserted.append(args)
            return uuid.uuid4()
        raise NotImplementedError(sql)

    async def execute(self, sql: str, *args: Any) -> None:
        self.executed.append((sql, args))
