import type { Env, GroundChunk } from './types';

/**
 * Ground in MongoDB, through the Nyuchi API (owner, 2026-11-23: "use mongodb for the store").
 *
 * The passages live in `shamwari.knowledgeBase` (Atlas vector and text search indexes, bge-m3, 1024 numbers).
 * The gateway holds no database login: it calls `POST /v1/shamwari/ground/search` on the Nyuchi API with
 * Shamwari's service key (an internal key scoped `shamwari:service`), and the API runs the hybrid search. The API
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
let downUntil = 0;

export const groundStoreDown = (now = Date.now()): boolean => now < downUntil;

/** For tests: close the breaker. */
export function resetGroundStoreBreaker(): void {
  downUntil = 0;
}

/** Ground in Mongo is used when the API, the client id and the secret are all configured; otherwise Core. */
export const groundStoreConfigured = (env: Env): boolean =>
  Boolean(env.NYUCHI_API_URL && env.NYUCHI_SHAMWARI_CLIENT_ID && env.NYUCHI_SHAMWARI_CLIENT_SECRET);

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

export async function groundSearch(env: Env, q: GroundQuery): Promise<GroundAnswer> {
  if (groundStoreDown()) throw new GroundStoreError(503, 'ground_unavailable: skipped while the breaker is open');
  let base = String(env.NYUCHI_API_URL);
  while (base.endsWith('/')) base = base.slice(0, -1);
  let res: Response;
  try {
    // Read at request time from the Secrets Store; a failed read is an outage like any other.
    const secret = await env.NYUCHI_SHAMWARI_CLIENT_SECRET!.get();
    res = await fetch(`${base}/v1/shamwari/ground/search`, {
      method: 'POST',
      headers: {
        'X-Client-Id': String(env.NYUCHI_SHAMWARI_CLIENT_ID),
        'X-Client-Secret': secret,
        'Content-Type': 'application/json',
      },
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
    // A 4xx is the API answering (a Rule 1 refusal, a bad argument, a refused key): it never opens the breaker.
    if (res.status >= 500) downUntil = Date.now() + GROUND_COOLDOWN_MS;
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
