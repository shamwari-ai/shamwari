import type { AuthContext, Env, Scope, SinkMessage } from './types';
import { core } from './core';

/**
 * The seam between the gateway and whatever owns API keys and usage.
 *
 * Today that is Core (Mongo `platform.apiKeys` and `platform.usageEvents`).
 * It is expected to move to the Nyuchi Servers API, where keys live in the
 * ledger's `platform.api_keys` and not in Mongo. Nothing outside this file
 * knows which one is answering. The contract Shamwari needs from the Servers
 * API is docs/servers-api-contract.md.
 *
 * Two properties hold for every implementation, and the contract tests in
 * test/keys.test.ts fail if either breaks:
 *
 *   - Auth fails closed. 'unavailable' is never treated as 'ok', and is never
 *     cached as a verdict either way. (CoreKeyService is the one legacy
 *     exception: it reports every Core error as 'invalid', as it always did.
 *     Tightening that is a live-path behaviour change, tracked separately.)
 *   - Nothing here carries prompt, answer or scope-gated content. Key checks
 *     send a hash; metering sends counts and identifiers (Rule 1). The one
 *     exception is the scope *label* (personal, community or platform), which
 *     usageEventPayload enforces as exactly one of those three values and
 *     drops otherwise.
 */
export type VerifyOutcome =
  | { status: 'ok'; ctx: AuthContext }
  | { status: 'invalid' }
  | { status: 'unavailable' };

const ALL_SCOPES: readonly Scope[] = ['personal', 'community', 'platform'];
const DEFAULT_SCOPES: readonly Scope[] = ['community', 'platform'];

/** The scopes a key may ask for. Personal is never a default. */
export function permittedScopes(auth: AuthContext): readonly Scope[] {
  return auth.scopes ?? DEFAULT_SCOPES;
}

/**
 * Reads `scopes` from a verify response. Absent means the default. Present but
 * not an array of strings is a malformed response (null here means that). Names
 * outside the three are dropped, so a response can narrow but never invent a scope.
 */
function parseKeyScopes(v: unknown): Scope[] | undefined | null {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) return null;
  return ALL_SCOPES.filter((s) => v.includes(s));
}

export interface KeyService {
  verify(keyPrefix: string, keyHash: string): Promise<VerifyOutcome>;
  /** Tokens used by an owner in a billing period (`YYYY-MM`). Throws when it cannot say. */
  usageTotal(ownerEntityId: string, billingPeriod: string): Promise<number>;
}

export interface UsageMeter {
  /** Never throws: metering must not fail a user request, and must not drop an event. */
  record(doc: Record<string, unknown>): Promise<void>;
}

/** The current implementation, unchanged in behaviour. */
export class CoreKeyService implements KeyService {
  constructor(private readonly env: Env) {}

  async verify(keyPrefix: string, keyHash: string): Promise<VerifyOutcome> {
    try {
      const r = await core<{
        api_key_id: string;
        owner_entity_id: string;
        owner_person_id: string | null;
        key_type: string;
        tier: string;
        monthly_token_cap: number;
      }>(this.env, '/auth/verify', {
        method: 'POST',
        // keyPrefix is indexed in platform.apiKeys; Core finds by prefix then
        // does a constant-time compare on the hash.
        body: { key_prefix: keyPrefix, key_hash: keyHash },
      });
      return {
        status: 'ok',
        ctx: {
          apiKeyId: r.api_key_id,
          ownerEntityId: r.owner_entity_id,
          ownerPersonId: r.owner_person_id,
          keyType: r.key_type,
          tier: r.tier,
          monthlyTokenCap: r.monthly_token_cap,
        },
      };
    } catch {
      // Legacy behaviour, kept so the seam changes nothing: a Core outage
      // reads as 'invalid' and is negatively cached for AUTH_CACHE_TTL.
      // Still fails closed. The Servers API implementation does better.
      return { status: 'invalid' };
    }
  }

  async usageTotal(ownerEntityId: string, billingPeriod: string): Promise<number> {
    const r = await core<{ total_tokens: number }>(
      this.env,
      `/rollup?owner_entity_id=${ownerEntityId}&billing_period=${billingPeriod}`,
    );
    return r.total_tokens;
  }
}

/** The current implementation: the sink queue, drained into Core. */
export class QueueUsageMeter implements UsageMeter {
  /**
   * `spilled` marks an event the Servers API did not take. Core's replay job
   * (core/replay.py) delivers exactly the rows carrying it, and nothing else.
   */
  constructor(
    private readonly env: Env,
    private readonly spilled = false,
  ) {}

  async record(doc: Record<string, unknown>): Promise<void> {
    const msg: SinkMessage = {
      database: 'platform',
      collection: 'usageEvents',
      doc: this.spilled ? { ...doc, spilled: true } : doc,
    };
    await this.env.SINK.send(msg).catch((e) => console.error('sink enqueue failed', String(e)));
  }
}

const VERIFY_TIMEOUT_MS = 800;
const ROLLUP_TIMEOUT_MS = 800;
const METER_TIMEOUT_MS = 2000;

/**
 * Fields a usage event may carry to the Servers API. An allowlist, so a field
 * added to the event later (or a content field added by mistake) does not
 * leave the gateway until someone decides it should.
 */
export const USAGE_EVENT_FIELDS = [
  'ownerEntityId',
  'apiKeyId',
  'requestId',
  'billingPeriod',
  'scope',
  'tier',
  'routedTier',
  'reach',
  'reachClamped',
  'provider',
  'model',
  'requestedProvider',
  'requestedModel',
  'modelSubstituted',
  'licenseClass',
  'inputTokens',
  'outputTokens',
  'costUsdEstimate',
  'priceTableVersion',
  'cacheHit',
  'groundHit',
  'inferencePath',
  'edgeEmbedding',
  'degraded',
  'latencyMs',
  'createdAt',
] as const;

const SCOPE_LABELS = new Set(['personal', 'community', 'platform']);

export function usageEventPayload(doc: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of USAGE_EVENT_FIELDS) if (k in doc) out[k] = doc[k];
  // A label, never a value: anything but the three scope names is dropped, so a
  // scope-gated identifier or payload put here by mistake cannot leave.
  if ('scope' in out && !SCOPE_LABELS.has(out.scope as string)) delete out.scope;
  return out;
}

interface ServersApiConn {
  url: string;
  token: string;
  /** Second factor the internal routes require, when the owner has set one. */
  internalKey: string | undefined;
}

function serversApi(env: Env): ServersApiConn | null {
  return env.SERVERS_API_URL && env.SERVERS_API_TOKEN
    ? {
        url: env.SERVERS_API_URL.replace(/\/$/, ''),
        token: env.SERVERS_API_TOKEN,
        internalKey: env.SERVERS_API_INTERNAL_KEY || undefined,
      }
    : null;
}

/** Bearer token plus, when configured, the internal key the Servers API requires. */
function authHeaders(api: ServersApiConn): Record<string, string> {
  return {
    Authorization: `Bearer ${api.token}`,
    ...(api.internalKey ? { 'x-nyuchi-internal-key': api.internalKey } : {}),
  };
}

/** What a key is issued for decides its type; Shamwari customer keys are this type. */
export const SHAMWARI_KEY_TYPE = 'shamwari';

const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** A 200 that does not satisfy this is 'unavailable', never a context we cache. */
function isAuthContext(r: Record<string, unknown>): boolean {
  return (
    nonEmpty(r.api_key_id) &&
    nonEmpty(r.owner_entity_id) &&
    nonEmpty(r.key_type) &&
    nonEmpty(r.tier) &&
    typeof r.monthly_token_cap === 'number' &&
    Number.isInteger(r.monthly_token_cap) &&
    r.monthly_token_cap > 0
  );
}

/** Only a body that says so makes a 401/403/404 the key's fault and not ours. */
async function saysInvalidKey(res: Response): Promise<boolean> {
  try {
    return ((await res.json()) as { error?: unknown }).error === 'invalid_key';
  } catch {
    return false;
  }
}

/**
 * Key verification and quota rollups against the Nyuchi Servers API.
 * Off unless SERVERS_API_ENABLED is "true".
 */
export class ServersApiKeyService implements KeyService {
  constructor(private readonly env: Env) {}

  async verify(keyPrefix: string, keyHash: string): Promise<VerifyOutcome> {
    const api = serversApi(this.env);
    if (!api) return { status: 'unavailable' }; // enabled but unconfigured: closed, not open
    try {
      const res = await fetch(`${api.url}/v1/shamwari/keys/verify`, {
        method: 'POST',
        headers: {
          ...authHeaders(api),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ key_prefix: keyPrefix, key_hash: keyHash }),
        signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
      });
      // A definitive "no" needs the body to say so. A bare 401/403/404 is as
      // likely our own rotated SERVERS_API_TOKEN or a wrong route, and caching
      // that as "invalid" would reject every good key for the TTL.
      if ([401, 403, 404].includes(res.status)) {
        return (await saysInvalidKey(res)) ? { status: 'invalid' } : { status: 'unavailable' };
      }
      if (res.status !== 200) return { status: 'unavailable' };
      const r = (await res.json()) as Record<string, unknown>;
      if (!isAuthContext(r)) return { status: 'unavailable' };
      // The shared key table holds every Nyuchi product's keys. A key issued
      // for something else is a valid key that is not valid here.
      if (r.key_type !== SHAMWARI_KEY_TYPE) return { status: 'invalid' };
      const scopes = parseKeyScopes(r.scopes);
      if (scopes === null) return { status: 'unavailable' };
      return {
        status: 'ok',
        ctx: {
          apiKeyId: r.api_key_id as string,
          ownerEntityId: r.owner_entity_id as string,
          ownerPersonId: typeof r.owner_person_id === 'string' ? r.owner_person_id : null,
          keyType: r.key_type as string,
          tier: r.tier as string,
          monthlyTokenCap: r.monthly_token_cap as number,
          ...(scopes ? { scopes } : {}),
        },
      };
    } catch {
      return { status: 'unavailable' };
    }
  }

  async usageTotal(ownerEntityId: string, billingPeriod: string): Promise<number> {
    const api = serversApi(this.env);
    if (!api) throw new Error('servers api not configured');
    const q = new URLSearchParams({
      owner_entity_id: ownerEntityId,
      billing_period: billingPeriod,
    });
    const res = await fetch(`${api.url}/v1/shamwari/usage/rollup?${q}`, {
      headers: authHeaders(api),
      signal: AbortSignal.timeout(ROLLUP_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`servers api rollup ${res.status}`);
    const r = (await res.json()) as { total_tokens?: unknown };
    if (typeof r.total_tokens !== 'number') throw new Error('servers api rollup malformed');
    return r.total_tokens;
  }
}

/**
 * Usage events to the Servers API, falling back to the sink queue so an
 * outage there does not lose the event.
 *
 * The fallback is a spill, not a second ledger: with the flag on, quota and
 * billing read the Servers API, so a spilled row in Core's usageEvents counts
 * for nothing until it is replayed there (idempotent on requestId). That
 * replay belongs to whoever owns the Servers API and is in the contract. A
 * timeout after the Servers API accepted can spill a duplicate; the replay's
 * requestId dedup is what makes that harmless.
 */
export class ServersApiUsageMeter implements UsageMeter {
  private readonly fallback: UsageMeter;
  constructor(
    private readonly env: Env,
    fallback?: UsageMeter,
  ) {
    this.fallback = fallback ?? new QueueUsageMeter(env, true);
  }

  async record(doc: Record<string, unknown>): Promise<void> {
    const api = serversApi(this.env);
    try {
      if (!api) throw new Error('servers api not configured');
      const res = await fetch(`${api.url}/v1/shamwari/usage/events`, {
        method: 'POST',
        headers: {
          ...authHeaders(api),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ events: [usageEventPayload(doc)] }),
        signal: AbortSignal.timeout(METER_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`servers api usage ${res.status}`);
    } catch (e) {
      console.warn('servers api metering failed, queueing', String(e));
      await this.fallback.record(doc);
    }
  }
}

export function serversApiEnabled(env: Env): boolean {
  return env.SERVERS_API_ENABLED === 'true';
}

export function keyService(env: Env): KeyService {
  return serversApiEnabled(env) ? new ServersApiKeyService(env) : new CoreKeyService(env);
}

export function usageMeter(env: Env): UsageMeter {
  return serversApiEnabled(env) ? new ServersApiUsageMeter(env) : new QueueUsageMeter(env);
}
