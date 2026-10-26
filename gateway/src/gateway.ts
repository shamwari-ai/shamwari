import type { Env, Message, LicenseClass, Scope, Tier } from './types';
import type { Target } from './router';
import { resolveLicenseClass, WORKERS_AI_FALLBACK_MODEL } from './provenance';

export interface InferenceResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  cacheHit: boolean;
  /** The provider that actually served, per `cf-aig-provider` where present. */
  provider: string;
  /** The model that actually served, per `cf-aig-model` where present. */
  model: string;
  requestedProvider: string;
  requestedModel: string;
  /** Resolved from the served model, never from the requested tier. */
  licenseClass: LicenseClass;
  /** True when a dynamic route or a fallback answered with something else. */
  substituted: boolean;
  path: 'gateway' | 'workers-ai';
}

/**
 * Context attached to the AI Gateway log entry, and available to Conditional
 * nodes inside a dynamic route.
 *
 * Nothing derived from message content belongs here. These values are stored
 * in Cloudflare's logs, so the rule is the same shape as rule 1's:
 * identifiers and routing dimensions only, never the user's words.
 *
 * `scope` can only ever be `community` or `platform` on this path — personal
 * scope is refused before `infer()` is reachable — but it is sent so a route
 * and its log can show that rather than assume it.
 */
export interface RequestMetadata {
  tier: Tier;
  scope: Scope;
  ownerEntityId: string;
  surface: string;
  requestId: string;
}

/**
 * AI Gateway accepts at most FIVE custom metadata entries per request and
 * silently ignores the rest — so a sixth would not error, it would quietly
 * stop reaching the dynamic route that branches on it. Values must be
 * string, number or boolean; objects are not supported. Keys beginning
 * `cf.` are reserved and are stripped by Cloudflare.
 *
 * `test/gateway.test.ts` pins the count at five, so adding a dimension is a
 * deliberate trade against an existing one rather than a silent loss.
 */
export const AIG_METADATA_MAX_ENTRIES = 5;

export function buildMetadata(meta: RequestMetadata): Record<string, string> {
  return {
    tier: meta.tier,
    scope: meta.scope,
    owner_entity_id: meta.ownerEntityId,
    surface: meta.surface,
    request_id: meta.requestId,
  };
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
 * Step 1 of the degradation chain: the AI Gateway's dynamic route.
 *
 * The route (`dynamic/<CF_ROUTE_NAME>`) holds the spend cap, the tier branch
 * and its own fallbacks, all on Workers AI and billed through Cloudflare, so
 * no provider key is sent: `cf-aig-authorization` is the only credential.
 * Caching, spend limits and observability come with it.
 *
 * Returns null rather than throwing when the step is unavailable, so the
 * caller decides whether to degrade or to report. `skipCache` exists for the
 * probe: its prompt is constant, so a cached HIT would report a healthy
 * gateway while the route behind it was failing.
 */
export async function viaGateway(
  env: Env,
  target: Target,
  messages: Message[],
  meta: RequestMetadata,
  skipCache = false,
): Promise<InferenceResult | null> {
  try {
    // A Secrets Store binding, so the token is read at request time and never
    // sits in the Worker's own secrets. If the read fails the step is
    // unavailable and the caller degrades, like any other gateway failure.
    const aigToken = await env.CF_AIG_TOKEN.get();
    const res = await post(
      `https://gateway.ai.cloudflare.com/v1/${env.CF_ACCOUNT_ID}/${env.CF_GATEWAY_ID}/compat/chat/completions`,
      {
        'cf-aig-authorization': `Bearer ${aigToken}`,
        'cf-aig-metadata': JSON.stringify(buildMetadata(meta)),
        ...(skipCache ? { 'cf-aig-skip-cache': 'true' } : {}),
      },
      `dynamic/${env.CF_ROUTE_NAME}`,
      messages,
    );
    if (res.ok) {
      return parse(res, target, res.headers.get('cf-aig-cache-status') === 'HIT', 'gateway');
    }
    console.warn('gateway', res.status);
  } catch (e) {
    console.warn('gateway threw', String(e));
  }
  return null;
}

/**
 * Step 2. Last resort: the Workers AI binding with no AI Gateway in the path.
 * Lower quality, still answers.
 *
 * A general model, not the coder variant: this answers Shona and Ndebele
 * questions about law and tax when both providers are unreachable.
 */
export async function viaWorkersAI(
  env: Env,
  target: Target,
  messages: Message[],
): Promise<InferenceResult> {
  const fb = (await env.AI.run(WORKERS_AI_FALLBACK_MODEL as never, {
    messages,
  } as never)) as { response?: string };

  return {
    text: fb.response ?? 'Shamwari cannot answer right now. Please retry.',
    inputTokens: 0,
    outputTokens: 0,
    cacheHit: false,
    provider: 'workers-ai',
    model: WORKERS_AI_FALLBACK_MODEL,
    requestedProvider: target.provider,
    requestedModel: target.model,
    licenseClass: resolveLicenseClass('workers-ai', WORKERS_AI_FALLBACK_MODEL),
    substituted: true,
    path: 'workers-ai',
  };
}

/**
 * Two-step degradation:
 *   1. AI Gateway   dynamic route: caching, spend limits, observability,
 *                   tier branch and its own fallbacks
 *   2. Workers AI   the binding directly, no AI Gateway in the path
 *
 * Everything runs on Cloudflare (no third-party provider, no provider key),
 * so Cloudflare is the dependency; the second step only removes the AI
 * Gateway from the path. The steps are separate exported functions so that
 * `probe.ts` can exercise each one **on its own**: in one composed function
 * the second step is only reachable when the first fails, which is exactly
 * why fallbacks rot. See docs/degradation-probe.md.
 */
export async function infer(
  env: Env,
  target: Target,
  messages: Message[],
  meta: RequestMetadata,
): Promise<InferenceResult> {
  return (
    (await viaGateway(env, target, messages, meta)) ?? (await viaWorkersAI(env, target, messages))
  );
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

  // A dynamic route reports what it chose in these headers. When they are
  // absent, what was asked for is taken to be what served.
  const provider = res.headers.get('cf-aig-provider')?.trim() || target.provider;
  const model = res.headers.get('cf-aig-model')?.trim() || target.model;

  return {
    text: j.choices?.[0]?.message?.content ?? '',
    inputTokens: j.usage?.prompt_tokens ?? 0,
    outputTokens: j.usage?.completion_tokens ?? 0,
    cacheHit,
    provider,
    model,
    requestedProvider: target.provider,
    requestedModel: target.model,
    licenseClass: resolveLicenseClass(provider, model),
    substituted: provider !== target.provider || model !== target.model,
    path,
  };
}
