import type { Env, GroundChunk } from './types';

/**
 * Ground on Supabase (owner, 2026-11-23: "build core on supabase for now, use pgvector").
 *
 * Calls `public.ground_search` in the Shamwari database (db/supabase/03-ground-pgvector.sql) over Supabase's
 * REST API with the publishable key. That function makes Core's Rule 1 checks itself before it reads anything
 * (personal scope to the cloud, an embedded mind query, an embedded question that needs the person's own
 * information, a scope the key does not hold) and answers in Core's /ground/search shape, so `ground()` treats
 * both the same. The publishable key can run that one function and read platform passages; it cannot read the
 * table, write anything, or read community passages.
 *
 * Getting to an answer must never wait on this: a short time limit, and a breaker of its own, so a down
 * database is skipped at once instead of being waited on by every question.
 */

/** Supabase answers a search in well under this from the edge; past it the answer goes on without sources. */
export const GROUND_TIMEOUT_MS = 1500;
/** After a failure (no connection, the limit above, a 5xx), later searches skip Supabase for this long. */
export const GROUND_COOLDOWN_MS = 30_000;
let downUntil = 0;

export const groundStoreDown = (now = Date.now()): boolean => now < downUntil;

/** For tests: close the breaker. */
export function resetGroundStoreBreaker(): void {
  downUntil = 0;
}

/** Ground on Supabase is used when it is configured; otherwise the gateway asks Core, as before. */
export const groundStoreConfigured = (env: Env): boolean => Boolean(env.SUPABASE_URL && env.SUPABASE_PUBLISHABLE_KEY);

export interface GroundQuery {
  query: string;
  embedding?: number[];
  owner_entity_id: string;
  scope: string;
  destination: string;
  language: string | null;
  top_k: number;
  granted_scopes?: readonly string[];
  needs_own_information: boolean;
}

export interface GroundAnswer {
  chunks: GroundChunk[];
  hit: boolean;
  scope?: string;
  needs_own_information?: boolean;
}

/** A refusal or failure from the store, with the status the REST API gave (503 for a skip or a timeout). */
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
  const base = String(env.SUPABASE_URL).replace(/\/+$/, '');
  let res: Response;
  try {
    // Read at request time from the Secrets Store; a failed read is an outage like any other.
    const key = await env.SUPABASE_PUBLISHABLE_KEY!.get();
    res = await fetch(`${base}/rest/v1/rpc/ground_search`, {
      method: 'POST',
      headers: { apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_query: q.query,
        // pgvector reads a vector from its text form, "[0.1,0.2,...]".
        ...(q.embedding ? { p_embedding: `[${q.embedding.join(',')}]` } : {}),
        p_scope: q.scope,
        p_destination: q.destination,
        p_owner_entity_id: q.owner_entity_id,
        p_language: q.language,
        p_top_k: q.top_k,
        p_needs_own_information: q.needs_own_information,
        ...(q.granted_scopes ? { p_granted_scopes: q.granted_scopes } : {}),
      }),
      signal: AbortSignal.timeout(GROUND_TIMEOUT_MS),
    });
  } catch (e) {
    downUntil = Date.now() + GROUND_COOLDOWN_MS;
    throw new GroundStoreError(503, `ground_unavailable: ${e instanceof Error ? e.name : 'error'}`);
  }
  if (!res.ok) {
    // A 4xx is the database answering (a Rule 1 refusal, a bad argument): it never opens the breaker.
    if (res.status >= 500) downUntil = Date.now() + GROUND_COOLDOWN_MS;
    else downUntil = 0;
    let code = `http_${res.status}`;
    try {
      const j = (await res.json()) as { message?: unknown };
      if (typeof j.message === 'string') code = j.message;
    } catch {
      /* no body */
    }
    throw new GroundStoreError(res.status, code);
  }
  downUntil = 0;
  return (await res.json()) as GroundAnswer;
}
