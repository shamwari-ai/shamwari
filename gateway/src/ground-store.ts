import type { Env, GroundChunk } from './types';

/**
 * Ground in MongoDB, through the Nyuchi API (owner, 2026-11-23: "use mongodb for the store").
 *
 * The passages live in `shamwari.knowledgeBase` (Atlas vector and text search indexes, bge-m3, 1024 numbers).
 * The gateway holds no database login and no service key: it calls `POST /v1/shamwari/ground/search` on the
 * Nyuchi API with the signed-in person's own WorkOS session token, so the API acts with that person's base access
 * and takes the owner from the token (owner, 2026-11-23: no single key, no permission creep). A caller with an
 * API key has no person behind it and gets no Mongo search; our own sites (own-sites.ts) still answer. The API
 * makes the Rule 1 checks again before it reads anything (personal scope to the cloud, an embedded mind query),
 * and answers in the shape Core did, so `ground()` treats both the same.
 *
 * Getting to an answer must never wait on this: a short time limit, and a breaker of its own, so a down API is
 * skipped at once instead of being waited on by every question.
 */

/** The API answers a search in well under this from the edge; past it the answer goes on without sources. */
export const GROUND_TIMEOUT_MS = 1500;
/** After a failure (no connection, the limit above, a 5xx), later searches skip the API for this long. */
export const GROUND_COOLDOWN_MS = 30_000;
/** A refused token (401/403) here means the API does not accept our people's sessions (not configured, or
 * the first-party client not listed): the gateway verified the token first, so it is not this person's. That will
 * not fix itself in seconds, so the API is skipped for longer and no question pays for a call that cannot succeed. */
export const GROUND_REFUSED_KEY_COOLDOWN_MS = 5 * 60_000;
let downUntil = 0;

export const groundStoreDown = (now = Date.now()): boolean => now < downUntil;

/** For tests: close the breaker. */
export function resetGroundStoreBreaker(): void {
  downUntil = 0;
}

/** Ground in Mongo is used when the API is configured and a signed-in person is asking; otherwise Core. */
export const groundStoreConfigured = (env: Env, personToken?: string): boolean =>
  Boolean(env.NYUCHI_API_URL && personToken);

export interface GroundQuery {
  query: string;
  embedding?: number[];
  owner_entity_id: string;
  scope: string;
  destination: string;
  language: string | null;
  top_k: number;
}

export interface GroundAnswer {
  chunks: GroundChunk[];
  hit: boolean;
  scope?: string;
  needs_own_information?: boolean;
}

/** A refusal or failure from the store, with the status the API gave (503 for a skip or a timeout). */
export class GroundStoreError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`ground store ${status}: ${code}`);
    this.name = 'GroundStoreError';
  }
}

export async function groundSearch(env: Env, q: GroundQuery, personToken: string): Promise<GroundAnswer> {
  if (groundStoreDown()) throw new GroundStoreError(503, 'ground_unavailable: skipped while the breaker is open');
  let base = String(env.NYUCHI_API_URL);
  while (base.endsWith('/')) base = base.slice(0, -1);
  let res: Response;
  try {
    res = await fetch(`${base}/v1/shamwari/ground/search`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${personToken}`, 'Content-Type': 'application/json' },
      // Only the fields the API accepts.
      body: JSON.stringify({
        query: q.query,
        ...(q.embedding ? { embedding: q.embedding } : {}),
        owner_entity_id: q.owner_entity_id,
        scope: q.scope,
        destination: q.destination,
        language: q.language,
        top_k: Math.min(20, Math.max(1, q.top_k)),
      }),
      signal: AbortSignal.timeout(GROUND_TIMEOUT_MS),
    });
  } catch (e) {
    downUntil = Date.now() + GROUND_COOLDOWN_MS;
    throw new GroundStoreError(503, `ground_unavailable: ${e instanceof Error ? e.name : 'error'}`);
  }
  if (!res.ok) {
    // A 5xx is an outage. A 401/403 is our people's sessions refused (see above): every later search would fail
    // the same way, so it is skipped for longer. Any other 4xx is the API answering (a Rule 1
    // refusal, a bad argument) and never opens the breaker.
    if (res.status >= 500) downUntil = Date.now() + GROUND_COOLDOWN_MS;
    else if (res.status === 401 || res.status === 403) downUntil = Date.now() + GROUND_REFUSED_KEY_COOLDOWN_MS;
    else downUntil = 0;
    let code = `http_${res.status}`;
    try {
      const j = (await res.json()) as { detail?: unknown };
      const d = j.detail as { error?: unknown } | string | undefined;
      if (typeof d === 'string') code = d;
      else if (d && typeof d.error === 'string') code = d.error;
    } catch {
      /* no body */
    }
    throw new GroundStoreError(res.status, code);
  }
  downUntil = 0;
  return (await res.json()) as GroundAnswer;
}
