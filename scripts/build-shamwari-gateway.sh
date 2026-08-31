#!/usr/bin/env bash
# ---------------------------------------------------------------
# Shamwari Cloud — edge gateway, v1.0
#
# Supersedes bootstrap-shamwari-cloud.sh and patch-split-datastore.sh.
# Writes the correct final state rather than another diff.
#
#   chmod +x build-shamwari-gateway.sh
#   ./build-shamwari-gateway.sh
#
# Architecture:
#   Worker (TypeScript, this)   routing, caching, AI Gateway, scope gate
#   Shamwari Core (FastAPI)     Mongo, Ground retrieval, auth, provenance
#   Supabase Postgres           training corpus, audit trail
#
# The Worker holds no database credentials and never talks to Mongo.
# ---------------------------------------------------------------
set -euo pipefail

# ---------------------------------------------------------------
# HISTORICAL. This produced gateway/ at v1.0. The tree has since moved
# on — routing-policy.json, test/, resolveJsonModule in tsconfig.json —
# and this script does not know about any of it. Kept because the
# comments in it record why each file looks the way it does.
#
# It refuses to run against an existing directory, so it cannot clobber
# gateway/. Do not "regenerate" from it; edit gateway/ directly.
# ---------------------------------------------------------------

DIR="${1:-shamwari-gateway}"
[ -e "$DIR" ] && { echo "error: $DIR exists" >&2; exit 1; }

echo "==> scaffolding $DIR"
mkdir -p "$DIR/src"
cd "$DIR"

cat > package.json << 'EOF'
{
  "name": "shamwari-gateway",
  "version": "1.0.0",
  "private": true,
  "description": "Shamwari Cloud edge gateway — routed inference grounded in Zimbabwean law, policy and economy",
  "license": "Apache-2.0",
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "typecheck": "tsc --noEmit",
    "tail": "wrangler tail"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^5.20260826.1",
    "typescript": "^5.9.0",
    "wrangler": "^4.126.0"
  }
}
EOF

cat > tsconfig.json << 'EOF'
{
  "compilerOptions": {
    "target": "es2022",
    "lib": ["es2022"],
    "module": "es2022",
    "moduleResolution": "bundler",
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src/**/*.ts"]
}
EOF

cat > wrangler.jsonc << 'EOF'
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "shamwari-gateway",
  "main": "src/index.ts",
  "compatibility_date": "2026-08-01",
  "observability": { "enabled": true },

  // Embeddings only. Also the last-resort inference fallback.
  "ai": { "binding": "AI" },

  "kv_namespaces": [
    { "binding": "AUTH_CACHE", "id": "REPLACE_ME" }
    // wrangler kv namespace create AUTH_CACHE
  ],

  "queues": {
    "producers": [{ "binding": "SINK", "queue": "shamwari-sink" }],
    "consumers": [
      {
        "queue": "shamwari-sink",
        "max_batch_size": 100,
        "max_batch_timeout": 10,
        "max_retries": 5,
        "dead_letter_queue": "shamwari-sink-dlq"
      }
    ]
  },

  "vars": {
    "CF_GATEWAY_ID": "shamwari",
    "CORE_URL": "https://core.shamwari.ai",
    "EMBEDDING_MODEL": "@cf/baai/bge-m3",
    "GROUND_TOP_K": "6",
    "AUTH_CACHE_TTL": "60",
    "ECONOMY_MODEL": "qwen3-32b-instruct",
    "STANDARD_MODEL": "kimi-k3",
    "SURFACE": "shamwari.ai",

    // Mind is not deployed yet. While false, personal-scope requests are
    // refused rather than routed to Cloud. Flip to "true" when Mind ships.
    "MIND_AVAILABLE": "false"
  }

  // wrangler secret put:
  //   CF_ACCOUNT_ID, CF_AIG_TOKEN
  //   SHAMWARI_CORE_TOKEN
  //   QWEN_API_KEY, MOONSHOT_API_KEY
}
EOF

cat > src/types.ts << 'EOF'
export interface Env {
  AI: Ai;
  AUTH_CACHE: KVNamespace;
  SINK: Queue<SinkMessage>;

  CF_ACCOUNT_ID: string;
  CF_AIG_TOKEN: string;
  CF_GATEWAY_ID: string;

  CORE_URL: string;
  SHAMWARI_CORE_TOKEN: string;

  QWEN_API_KEY: string;
  MOONSHOT_API_KEY: string;

  EMBEDDING_MODEL: string;
  GROUND_TOP_K: string;
  AUTH_CACHE_TTL: string;
  ECONOMY_MODEL: string;
  STANDARD_MODEL: string;
  SURFACE: string;
  MIND_AVAILABLE: string;
}

export type Tier = 'economy' | 'standard' | 'premium';

/**
 * Shamwari's three layers of intelligence. These are data scopes, not
 * deployment tiers.
 *
 *   personal   the user's own pod data      — never leaves the device
 *   community  anonymised platform data     — may reach Cloud
 *   platform   base Mukoko knowledge        — may reach Cloud
 */
export type Scope = 'personal' | 'community' | 'platform';

/** Gates Mind training eligibility. Stamped at generation, never inferred. */
export type LicenseClass = 'open_weight' | 'restricted';

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GroundChunk {
  content: string;
  heading: string | null;
  title: string;
  authority: string;
  resource_type: string;
  source_url: string | null;
  effective_from: string | null;
  scope: string;
}

export interface AuthContext {
  apiKeyId: string;
  ownerEntityId: string;
  ownerPersonId: string | null;
  keyType: string;
  tier: string;
  monthlyTokenCap: number;
}

export type SinkMessage = {
  database: 'shamwari' | 'platform';
  collection: string;
  doc: Record<string, unknown>;
};
EOF

cat > src/core.ts << 'EOF'
import type { Env } from './types';

/**
 * Client for Shamwari Core, the service that owns MongoDB.
 *
 * The Worker holds no database credentials. Core runs on Nyuchi
 * infrastructure, which is also why scope enforcement lives there —
 * it needs to be somewhere Cloudflare cannot see.
 */
export async function core<T>(
  env: Env,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(`${env.CORE_URL}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${env.SHAMWARI_CORE_TOKEN}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new CoreError(res.status, detail);
  }
  return (await res.json()) as T;
}

export class CoreError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(`core ${status}: ${detail}`);
  }
}
EOF

cat > src/auth.ts << 'EOF'
import type { Env, AuthContext } from './types';
import { core } from './core';

async function sha256(raw: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * KV first, Core on miss. Only the hash is ever transmitted or cached, so
 * neither a KV leak nor a Core log yields a usable key.
 *
 * Short TTL is the revocation window: a revoked key stops working within
 * AUTH_CACHE_TTL seconds without any cache invalidation step.
 */
export async function authenticate(req: Request, env: Env): Promise<AuthContext | null> {
  const header = req.headers.get('Authorization') ?? '';
  const raw = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!raw.startsWith('sk_shamwari_')) return null;

  const hash = await sha256(raw);
  const cacheKey = `auth:${hash}`;
  const ttl = Math.max(60, Number(env.AUTH_CACHE_TTL));

  const cached = await env.AUTH_CACHE.get(cacheKey, 'json');
  if (cached === 'invalid') return null;
  if (cached) return cached as AuthContext;

  try {
    const result = await core<{
      api_key_id: string;
      owner_entity_id: string;
      owner_person_id: string | null;
      key_type: string;
      tier: string;
      monthly_token_cap: number;
    }>(env, '/auth/verify', {
      method: 'POST',
      // keyPrefix is indexed in platform.apiKeys; Core finds by prefix then
      // does a constant-time compare on the hash.
      body: { key_prefix: raw.slice(0, 12), key_hash: hash },
    });

    const ctx: AuthContext = {
      apiKeyId: result.api_key_id,
      ownerEntityId: result.owner_entity_id,
      ownerPersonId: result.owner_person_id,
      keyType: result.key_type,
      tier: result.tier,
      monthlyTokenCap: result.monthly_token_cap,
    };
    await env.AUTH_CACHE.put(cacheKey, JSON.stringify(ctx), { expirationTtl: ttl });
    return ctx;
  } catch {
    // Cache the negative so key-guessing cannot hammer Core.
    await env.AUTH_CACHE.put(cacheKey, JSON.stringify('invalid'), { expirationTtl: ttl });
    return null;
  }
}
EOF

cat > src/scope.ts << 'EOF'
import type { Env, Scope } from './types';

/**
 * THE LOAD-BEARING RULE
 *
 * Personal-layer content never reaches a third-party inference provider.
 * Not Kimi, not Qwen, not Claude. That is what makes "sovereign AI
 * companion" a technical fact rather than a marketing line.
 *
 * Enforced twice on purpose. Here, so the request fails fast without
 * burning a Core round trip. And again in Core's resolve_scope, which is
 * authoritative and which the Worker cannot override. Defence in depth,
 * because a single check is a single bug away from a leak.
 */
const CLOUD_SAFE: ReadonlySet<Scope> = new Set<Scope>(['community', 'platform']);

export function parseScope(raw: unknown): Scope {
  return raw === 'personal' || raw === 'community' ? raw : 'platform';
}

export interface ScopeDecision {
  scope: Scope;
  destination: 'cloud' | 'mind';
}

export function decideDestination(scope: Scope, env: Env): ScopeDecision {
  if (CLOUD_SAFE.has(scope)) return { scope, destination: 'cloud' };
  if (env.MIND_AVAILABLE === 'true') return { scope, destination: 'mind' };

  // Refuse rather than silently downgrade to platform scope. A downgrade
  // would answer confidently while withholding the user's own data, with
  // no signal that anything was missing — worse than an error.
  throw new ScopeRefusal(scope);
}

export class ScopeRefusal extends Error {
  constructor(readonly scope: Scope) {
    super('scope_requires_local_inference');
  }

  toPayload() {
    return {
      error: 'scope_requires_local_inference',
      scope: this.scope,
      message:
        'Personal-layer data cannot be sent to an external inference provider. ' +
        'Shamwari Mind is required for this request and is not yet deployed on ' +
        'this surface.',
      docs: 'https://platform.shamwari.ai/docs/scopes',
    };
  }
}
EOF

cat > src/router.ts << 'EOF'
import type { Env, Message, Tier, LicenseClass } from './types';

export interface Target {
  tier: Tier;
  provider: string;
  model: string;
  licenseClass: LicenseClass;
  directUrl: string;
  apiKey: (env: Env) => string;
}

/**
 * VERIFY provider slugs against the AI Gateway provider list before deploy.
 * Anything not natively supported is added as an OpenAI-compatible custom
 * provider in the Gateway dashboard.
 */
export function targets(env: Env): Record<Tier, Target> {
  return {
    economy: {
      tier: 'economy',
      provider: 'qwen',
      model: env.ECONOMY_MODEL,
      licenseClass: 'open_weight',
      directUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
      apiKey: (e) => e.QWEN_API_KEY,
    },
    standard: {
      tier: 'standard',
      provider: 'moonshot',
      model: env.STANDARD_MODEL,
      licenseClass: 'open_weight',
      directUrl: 'https://api.moonshot.ai/v1/chat/completions',
      apiKey: (e) => e.MOONSHOT_API_KEY,
    },
    // Premium is deliberately unconfigured. When Claude or GPT are added,
    // licenseClass MUST stay 'restricted' — their terms bar using outputs
    // to train competing models, and Core rejects restricted rows from the
    // Mind training path.
    premium: {
      tier: 'premium',
      provider: 'unconfigured',
      model: '',
      licenseClass: 'restricted',
      directUrl: '',
      apiKey: () => '',
    },
  };
}

const HARD = [
  'calculate', 'compute', 'derive', 'compare', 'analyse', 'analyze',
  'step by step', 'write code', 'debug', 'reconcile', 'draft a contract',
  'tsanangura', 'verenga',
];

/**
 * Heuristic v0. Deliberately not an LLM classifier — paying for a model
 * call to decide which model to call doubles latency and cost on every
 * request. Revisit once platform.usageEvents shows where economy fails.
 *
 * Economy handles the bulk; that is where the margin comes from, since
 * AI Gateway passes provider pricing through at cost.
 */
export function route(messages: Message[], requested: string | undefined, env: Env): Target {
  const t = targets(env);
  if (requested === 'shamwari-standard') return t.standard;
  if (requested === 'shamwari-economy') return t.economy;

  const text = messages.map((m) => m.content).join(' ');
  if (text.length > 6000 || messages.length > 12) return t.standard;

  const lower = text.toLowerCase();
  if (HARD.some((s) => lower.includes(s))) return t.standard;
  return t.economy;
}
EOF

cat > src/gateway.ts << 'EOF'
import type { Env, Message } from './types';
import type { Target } from './router';

export interface InferenceResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  cacheHit: boolean;
  provider: string;
  model: string;
  path: 'gateway' | 'direct' | 'workers-ai';
}

async function post(
  url: string,
  headers: Record<string, string>,
  model: string,
  messages: Message[],
): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ model, messages, temperature: 0.3, max_tokens: 2048 }),
  });
}

/**
 * Three-step degradation, so Cloudflare is an enhancement and not a
 * dependency:
 *   1. AI Gateway   caching, spend limits, observability
 *   2. Direct       same provider, no Cloudflare in the path
 *   3. Workers AI   last resort, lower quality, still answers
 *
 * Exercise steps 2 and 3 monthly or they will rot silently.
 */
export async function infer(
  env: Env,
  target: Target,
  messages: Message[],
): Promise<InferenceResult> {
  const key = target.apiKey(env);

  try {
    const res = await post(
      `https://gateway.ai.cloudflare.com/v1/${env.CF_ACCOUNT_ID}/${env.CF_GATEWAY_ID}/compat/chat/completions`,
      {
        'cf-aig-authorization': `Bearer ${env.CF_AIG_TOKEN}`,
        Authorization: `Bearer ${key}`,
      },
      `${target.provider}/${target.model}`,
      messages,
    );
    if (res.ok) {
      return parse(res, target, res.headers.get('cf-aig-cache-status') === 'HIT', 'gateway');
    }
    console.warn('gateway', res.status);
  } catch (e) {
    console.warn('gateway threw', String(e));
  }

  if (target.directUrl) {
    try {
      const res = await post(
        target.directUrl,
        { Authorization: `Bearer ${key}` },
        target.model,
        messages,
      );
      if (res.ok) return parse(res, target, false, 'direct');
      console.warn('direct', res.status);
    } catch (e) {
      console.warn('direct threw', String(e));
    }
  }

  const fb = (await env.AI.run('@cf/qwen/qwen2.5-coder-32b-instruct' as never, {
    messages,
  } as never)) as { response?: string };

  return {
    text: fb.response ?? 'Shamwari cannot answer right now. Please retry.',
    inputTokens: 0,
    outputTokens: 0,
    cacheHit: false,
    provider: 'workers-ai',
    model: 'fallback',
    path: 'workers-ai',
  };
}

async function parse(
  res: Response,
  target: Target,
  cacheHit: boolean,
  path: InferenceResult['path'],
): Promise<InferenceResult> {
  const j = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  return {
    text: j.choices?.[0]?.message?.content ?? '',
    inputTokens: j.usage?.prompt_tokens ?? 0,
    outputTokens: j.usage?.completion_tokens ?? 0,
    cacheHit,
    provider: target.provider,
    model: target.model,
    path,
  };
}
EOF

cat > src/ground.ts << 'EOF'
import type { Env, GroundChunk, Message, Scope } from './types';
import { core } from './core';

const BASE = `You are Shamwari, an AI companion built in Zimbabwe.

- Answer in the language the user writes in. Shona, Ndebele, English and code-switched mixtures are all normal. Never apologise for the user's language choice.
- When Ground context is supplied, ground your answer in it and cite the source by name and section.
- If Ground context does not cover the question, say so plainly, then answer from general knowledge and mark it as such. Never invent a section number, a statutory instrument, a rate or a date.
- Zimbabwean law and rates change often. Where an answer turns on a current figure you cannot confirm from Ground, say the figure must be verified and name the authority to verify it with.
- Be direct and practical. Assume a slow connection and a small screen.`;

export interface GroundResult {
  chunks: GroundChunk[];
  systemPrompt: string;
  hit: boolean;
}

async function embed(env: Env, text: string): Promise<number[]> {
  const out = (await env.AI.run(env.EMBEDDING_MODEL as never, { text: [text] } as never)) as {
    data?: number[][];
  };
  const v = out.data?.[0];
  if (!v) throw new Error('embedding failed');
  return v;
}

export async function ground(
  env: Env,
  messages: Message[],
  ownerEntityId: string,
  scope: Scope,
  destination: 'cloud' | 'mind',
  language: string | null,
): Promise<GroundResult> {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  if (!lastUser) return { chunks: [], systemPrompt: BASE, hit: false };

  let chunks: GroundChunk[] = [];
  try {
    // Core runs $rankFusion over the vector and lexical indexes and applies
    // the scope filter. It also logs the miss if there is one.
    const res = await core<{ chunks: GroundChunk[]; hit: boolean }>(env, '/ground/search', {
      method: 'POST',
      body: {
        query: lastUser.content,
        embedding: await embed(env, lastUser.content),
        owner_entity_id: ownerEntityId,
        scope,
        destination,
        language,
        top_k: Number(env.GROUND_TOP_K),
      },
    });
    chunks = res.chunks;
  } catch (e) {
    // Ungrounded is degraded, not broken. Answer anyway and say so.
    console.warn('ground unavailable', String(e));
  }

  if (chunks.length === 0) return { chunks: [], systemPrompt: BASE, hit: false };

  const context = chunks
    .map((c, i) => {
      const cite = [c.title, c.heading, c.authority].filter(Boolean).join(' — ');
      const eff = c.effective_from ? ` (effective ${c.effective_from})` : '';
      return `[${i + 1}] ${cite}${eff}\n${c.content}`;
    })
    .join('\n\n');

  return {
    chunks,
    hit: true,
    systemPrompt: `${BASE}\n\n--- SHAMWARI GROUND CONTEXT ---\n${context}\n--- END CONTEXT ---`,
  };
}
EOF

cat > src/lang.ts << 'EOF'
/**
 * Crude language tag for training-set stratification and Ground filtering.
 * Deliberately not a model call — this runs on every request.
 *
 * Replace once groundMisses and the corpus show where it misfires.
 */
const SN = /\b(ndeipi|mutero|ndinoda|zvakanaka|chii|sei|vanhu|mari|ndiri|tinoda|handisi|munhu|basa|mhoro)\b/i;
const ND = /\b(yini|ngingathanda|kuhle|ngicela|umuntu|imali|kanjani|ngiyabonga|sikhona|lokhu|umsebenzi|sawubona)\b/i;
const EN = /\b(the|and|what|how|is|are|please|tax|law|price)\b/i;

export function detectLanguage(text: string): string | null {
  const sn = SN.test(text);
  const nd = ND.test(text);
  const en = EN.test(text);
  if (sn && en) return 'sn-en';
  if (nd && en) return 'nd-en';
  if (sn) return 'sn';
  if (nd) return 'nd';
  if (en) return 'en';
  return null;
}
EOF

cat > src/sink.ts << 'EOF'
import type { Env, SinkMessage } from './types';

/**
 * Queue consumer. Batches up to 100 and hands them to Core, which owns the
 * Mongo connection pool.
 *
 * The Atlas Data API was removed in September 2025 and the native driver is
 * not production-hardened in Workers, so the Worker never talks to Mongo.
 * A Core outage produces a queue backlog, not a failed user request.
 */
export async function drain(batch: MessageBatch<SinkMessage>, env: Env): Promise<void> {
  const byDb: Record<string, Record<string, Record<string, unknown>[]>> = {};
  for (const m of batch.messages) {
    const { database, collection, doc } = m.body;
    ((byDb[database] ??= {})[collection] ??= []).push(doc);
  }

  for (const [database, collections] of Object.entries(byDb)) {
    const res = await fetch(`${env.CORE_URL}/sink/bulk`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.SHAMWARI_CORE_TOKEN}`,
      },
      body: JSON.stringify({ database, collections }),
    });
    // Throwing retries the batch. Five attempts, then the DLQ.
    if (!res.ok) throw new Error(`sink ${res.status}: ${await res.text()}`);
  }
}
EOF

cat > src/index.ts << 'EOF'
import type { Env, Message, SinkMessage, AuthContext } from './types';
import { authenticate } from './auth';
import { parseScope, decideDestination, ScopeRefusal } from './scope';
import { route } from './router';
import { infer } from './gateway';
import { ground } from './ground';
import { drain } from './sink';
import { detectLanguage } from './lang';
import { core } from './core';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

function billingPeriod(d = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function overQuota(env: Env, auth: AuthContext): Promise<boolean> {
  try {
    const r = await core<{ total_tokens: number }>(
      env,
      `/rollup?owner_entity_id=${auth.ownerEntityId}&billing_period=${billingPeriod()}`,
    );
    return r.total_tokens > auth.monthlyTokenCap;
  } catch {
    // Fail open. A rollup outage must not stop a paying customer.
    return false;
  }
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === '/health') {
      return json({
        ok: true,
        service: 'shamwari-gateway',
        version: '1.0.0',
        mind: env.MIND_AVAILABLE === 'true',
      });
    }
    if (url.pathname !== '/v1/chat/completions' || req.method !== 'POST') {
      return json({ error: 'not_found' }, 404);
    }

    const auth = await authenticate(req, env);
    if (!auth) return json({ error: 'invalid_api_key' }, 401);
    if (await overQuota(env, auth)) {
      return json(
        {
          error: 'quota_exceeded',
          tier: auth.tier,
          upgrade: 'https://platform.shamwari.ai/billing',
        },
        429,
      );
    }

    let body: { messages?: Message[]; model?: string; scope?: string };
    try {
      body = await req.json();
    } catch {
      return json({ error: 'invalid_json' }, 400);
    }

    const messages = body.messages ?? [];
    if (messages.length === 0) return json({ error: 'messages_required' }, 400);

    // Scope gate, before anything expensive happens.
    const scope = parseScope(body.scope);
    let decision;
    try {
      decision = decideDestination(scope, env);
    } catch (e) {
      if (e instanceof ScopeRefusal) return json(e.toPayload(), 409);
      throw e;
    }

    const requestId = crypto.randomUUID();
    const started = Date.now();
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    const language = lastUser ? detectLanguage(lastUser.content) : null;

    const g = await ground(
      env,
      messages,
      auth.ownerEntityId,
      decision.scope,
      decision.destination,
      language,
    );
    const target = route(messages, body.model, env);
    const result = await infer(env, target, [
      { role: 'system', content: g.systemPrompt },
      ...messages.filter((m) => m.role !== 'system'),
    ]);
    const latencyMs = Date.now() - started;

    const now = new Date().toISOString();
    const sink: SinkMessage[] = [
      {
        database: 'shamwari',
        collection: 'conversations',
        doc: {
          ownerEntityId: auth.ownerEntityId,
          ownerPersonId: auth.ownerPersonId,
          requestId,
          surfaceContext: env.SURFACE,
          scope: decision.scope,
          language,
          messages,
          response: result.text,
          citations: g.chunks.map((c) => ({
            title: c.title,
            heading: c.heading,
            authority: c.authority,
            url: c.source_url,
            effectiveFrom: c.effective_from,
          })),
          teacherModel: `${result.provider}/${result.model}`,
          licenseClass: target.licenseClass,
          tier: target.tier,
          grounded: g.hit,
          promoted: false,
          lastMessageAt: now,
          createdAt: now,
        },
      },
      {
        database: 'platform',
        collection: 'usageEvents',
        doc: {
          ownerEntityId: auth.ownerEntityId,
          apiKeyId: auth.apiKeyId,
          requestId,
          billingPeriod: billingPeriod(),
          tier: target.tier,
          provider: result.provider,
          model: result.model,
          licenseClass: target.licenseClass,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          cacheHit: result.cacheHit,
          groundHit: g.hit,
          inferencePath: result.path,
          latencyMs,
          createdAt: now,
        },
      },
    ];

    ctx.waitUntil(
      env.SINK.sendBatch(sink.map((b) => ({ body: b }))).catch((e) =>
        console.error('sink enqueue failed', String(e)),
      ),
    );

    return json({
      id: requestId,
      model: `shamwari-${target.tier}`,
      choices: [
        { index: 0, message: { role: 'assistant', content: result.text }, finish_reason: 'stop' },
      ],
      usage: {
        prompt_tokens: result.inputTokens,
        completion_tokens: result.outputTokens,
        total_tokens: result.inputTokens + result.outputTokens,
      },
      shamwari: {
        tier: target.tier,
        scope: decision.scope,
        language,
        grounded: g.hit,
        cache_hit: result.cacheHit,
        inference_path: result.path,
        latency_ms: latencyMs,
        citations: g.chunks.map((c) => ({
          title: c.title,
          heading: c.heading,
          authority: c.authority,
          effective_from: c.effective_from,
          url: c.source_url,
        })),
      },
    });
  },

  async queue(batch: MessageBatch<SinkMessage>, env: Env): Promise<void> {
    await drain(batch, env);
  },
} satisfies ExportedHandler<Env, SinkMessage>;
EOF

cat > README.md << 'EOF'
# Shamwari Cloud — edge gateway

TypeScript on Cloudflare Workers. Routing, caching, AI Gateway, scope gate.
Holds no database credentials and never talks to MongoDB.

## Why TypeScript and not Rust

A gateway is I/O-bound: HTTP routing, header rewriting, `fetch`. No CPU-bound
work. workers-rs compiles to WASM, costing bundle size and cold-start time,
and the bindings this depends on — AI Gateway, Queues, KV — are
TypeScript-first. Rust earns its place in the `deno_core` sandbox host and in
queue consumers doing real computation. Not here.

## The scope rule

| Layer | Content | May reach Cloud? |
|---|---|---|
| `personal` | the user's own pod data | **No** |
| `community` | anonymised platform data | Yes |
| `platform` | base Mukoko knowledge | Yes |

Callers declare scope; `platform` is the default. A personal-scope request
returns **409 `scope_requires_local_inference`** while `MIND_AVAILABLE` is
false. It is not silently downgraded — a downgrade answers confidently while
withholding the user's own data, with no signal anything was missing.

Enforced in `src/scope.ts` (fast fail) and again in Core's `resolve_scope`
(authoritative). Two checks, because one is a single bug away from a leak.

## Setup

```
wrangler kv namespace create AUTH_CACHE     # paste id into wrangler.jsonc
wrangler queues create shamwari-sink
wrangler queues create shamwari-sink-dlq

wrangler secret put CF_ACCOUNT_ID
wrangler secret put CF_AIG_TOKEN
wrangler secret put SHAMWARI_CORE_TOKEN
wrangler secret put QWEN_API_KEY
wrangler secret put MOONSHOT_API_KEY

npm run dev
```

Shamwari Core must be reachable at `CORE_URL` first.

## Verify before deploy

- Provider slugs in `src/router.ts` against the current AI Gateway provider list
- A spend limit set in the AI Gateway dashboard — cheapest insurance available
- Exact-match caching enabled
- The Kimi K3 LICENSE file, read directly

## Degradation

AI Gateway → direct provider → Workers AI. Cloudflare is an enhancement, not
a dependency. `inference_path` in every response tells you which was used —
watch it, because steps 2 and 3 rot silently if never exercised.

## Provenance

`licenseClass` is stamped on every conversation and usage event at generation
time. Only `open_weight` may become Shamwari Mind training data; Anthropic and
OpenAI terms bar using their outputs to train competing models. Core rejects
any conversation missing a valid `licenseClass`, and Postgres
`training_examples` carries a CHECK constraint that a restricted row cannot
satisfy.

When premium tier is added, `licenseClass` stays `restricted` in
`src/router.ts`. Do not change it.

## Not in this phase

Streaming, semantic caching, premium tier, self-serve billing, Shamwari Mind,
`code.shamwari.ai` sandboxes. Meter usage now and invoice the first ten
customers by hand — you want to be talking to them anyway.
EOF

echo "==> installing"
npm install --silent 2>/dev/null || npm install
echo "==> typechecking"
npx tsc --noEmit && echo "typecheck clean"

cat << 'DONE'

==> shamwari-gateway v1.0 ready

  cd shamwari-gateway
  wrangler kv namespace create AUTH_CACHE
  wrangler queues create shamwari-sink && wrangler queues create shamwari-sink-dlq
  npm run dev

Smoke test:
  curl localhost:8787/health

Scope gate (should 409 while MIND_AVAILABLE=false):
  curl localhost:8787/v1/chat/completions \
    -H "Authorization: Bearer sk_shamwari_..." -H "Content-Type: application/json" \
    -d '{"scope":"personal","messages":[{"role":"user","content":"what did I spend last month"}]}'

Grounded query:
  curl localhost:8787/v1/chat/completions \
    -H "Authorization: Bearer sk_shamwari_..." -H "Content-Type: application/json" \
    -d '{"messages":[{"role":"user","content":"What does the Constitution say about equality?"}]}'

DONE
