/**
 * Idempotent requests: the same `Idempotency-Key` with the same request is the
 * same answer, so a retry on a flaky link costs nothing and is not billed or
 * stored a second time (docs/tiered-access-design.md, "Low-bandwidth protocol").
 *
 * It lives in the existing KV namespace under an `idem:` prefix. That is the
 * edge, and it is **best effort, not exactly-once**: KV is eventually
 * consistent (a retry that lands in another location within about a minute
 * may not see the first attempt) and the read-then-write is not atomic (two
 * truly simultaneous attempts can both run). A stronger guarantee needs the
 * sink to refuse a second `usageEvents` row for the same `requestId`.
 *
 * What is stored, and for how long: the response body of a request that
 * carried a key, for ten minutes, scoped to the calling entity. A request
 * without a key stores nothing. Personal scope never reaches here: it is
 * refused in `admit()` before anything is stored, so a stored answer is always
 * a Platform or Community one.
 */

export const KEY_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;

/** Long enough for a client to retry over a bad link; short, because it holds an answer. */
export const DONE_TTL_SECONDS = 600;
/** A started request that never finished expires. 60 s is KV's minimum. */
export const PENDING_TTL_SECONDS = 60;

interface Stored {
  fp: string;
  state: 'pending' | 'done';
  response?: { status: number; body: string };
}

export type Begin =
  | { state: 'new' }
  | { state: 'replay'; status: number; body: string }
  /** The key was used before for a different request. */
  | { state: 'conflict' }
  /** The first attempt has not finished. */
  | { state: 'in_progress' };

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** JSON with object keys sorted, so the same request always hashes the same. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

export function fingerprint(request: unknown): Promise<string> {
  return sha256Hex(canonical(request));
}

/** Scoped to the entity, and the caller's key is hashed, never stored. */
export async function storageKey(ownerEntityId: string, key: string): Promise<string> {
  return `idem:${ownerEntityId}:${await sha256Hex(key)}`;
}

export async function begin(kv: KVNamespace, k: string, fp: string): Promise<Begin> {
  const existing = (await kv.get(k, 'json')) as Stored | null;
  if (!existing) {
    const pending: Stored = { fp, state: 'pending' };
    await kv.put(k, JSON.stringify(pending), { expirationTtl: PENDING_TTL_SECONDS });
    return { state: 'new' };
  }
  if (existing.fp !== fp) return { state: 'conflict' };
  if (existing.state === 'done' && existing.response) {
    return { state: 'replay', ...existing.response };
  }
  return { state: 'in_progress' };
}

export async function complete(
  kv: KVNamespace,
  k: string,
  fp: string,
  response: { status: number; body: string },
): Promise<void> {
  const done: Stored = { fp, state: 'done', response };
  await kv.put(k, JSON.stringify(done), { expirationTtl: DONE_TTL_SECONDS });
}

/** A failed attempt is not an answer: let the retry run. */
export async function release(kv: KVNamespace, k: string): Promise<void> {
  await kv.delete(k);
}
