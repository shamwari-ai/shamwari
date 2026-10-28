import type { Env, Message, SinkMessage, AuthContext, GroundChunk } from './types';
import { authenticate } from './auth';
import { parseScope, decideDestination, ScopeRefusal } from './scope';
import type { Capability, ScopeDecision } from './scope';
import { route, applyReach, isReach, policy, REACHES } from './router';
import type { Reach } from './router';
import { infer } from './gateway';
import { ground } from './ground';
import type { GroundResult } from './ground';
import { extractiveAnswer, NO_SOURCE_MESSAGE } from './extractive';
import { FORMATS, isFormat, toCompact } from './envelope';
import type { Format } from './envelope';
import { handleChannel } from './channels/channel';
import { sms } from './channels/sms';
import { ussd } from './channels/ussd';
import * as idem from './idempotency';
import { drain } from './sink';
import { detectLanguage } from './lang';
import { core } from './core';
import { probe, healthDoc } from './probe';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

/** The citations a caller sees, in the shape every response uses. */
const citationsOf = (chunks: GroundChunk[]) =>
  chunks.map((c) => ({
    title: c.title,
    heading: c.heading,
    authority: c.authority,
    effective_from: c.effective_from,
    url: c.source_url,
  }));

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

interface ChatBody {
  messages?: Message[];
  model?: string;
  scope?: string;
  /** `extractive` answers from Ground alone, with no inference call. */
  mode?: string;
  /** How the caller reaches Shamwari: r0 SMS/USSD, r1 chat app, r2 Lite PWA. */
  reach?: string;
  /** `compact` asks for the compact envelope (src/envelope.ts). */
  format?: string;
}

/**
 * Everything both endpoints do before they diverge: authenticate, meter,
 * parse, and gate on scope. The capability argument is what makes the gate
 * mean different things on the two endpoints — see scope.ts.
 */
async function admit(
  req: Request,
  env: Env,
  capability: Capability,
  deferQuota = false,
): Promise<
  | { ok: false; response: Response }
  | {
      ok: true;
      auth: AuthContext;
      body: ChatBody;
      messages: Message[];
      decision: ScopeDecision;
      /** Only meaningful with `deferQuota`: the 429, or null when there is quota left. */
      quota: () => Promise<Response | null>;
    }
> {
  const auth = await authenticate(req, env);
  if (!auth) return { ok: false, response: json({ error: 'invalid_api_key' }, 401) };
  const quota = async (): Promise<Response | null> =>
    (await overQuota(env, auth))
      ? json(
          {
            error: 'quota_exceeded',
            tier: auth.tier,
            upgrade: 'https://platform.shamwari.ai/billing',
          },
          429,
        )
      : null;
  // A retry of an answered request is replayed without a quota check, so the
  // chat endpoint defers it until it knows the request is new.
  if (!deferQuota) {
    const over = await quota();
    if (over) return { ok: false, response: over };
  }

  let body: ChatBody;
  try {
    body = await req.json();
  } catch {
    return { ok: false, response: json({ error: 'invalid_json' }, 400) };
  }

  const messages = body.messages ?? [];
  if (messages.length === 0) {
    return { ok: false, response: json({ error: 'messages_required' }, 400) };
  }

  // Scope gate, before anything expensive happens.
  const scope = parseScope(body.scope);
  try {
    return {
      ok: true,
      auth,
      body,
      messages,
      decision: decideDestination(scope, env, capability),
      quota,
    };
  } catch (e) {
    if (e instanceof ScopeRefusal) return { ok: false, response: json(e.toPayload(), 409) };
    throw e;
  }
}

/**
 * Retrieval without generation. This is the endpoint Shamwari Mind calls.
 *
 * It is the only endpoint that may see personal scope, and it can only do
 * so because nothing here reaches a provider: ground() skips the edge
 * embedding for a `mind` destination, and infer() is never called. The
 * device gets the system prompt and the citations, and answers for itself.
 */
async function groundContext(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const a = await admit(req, env, 'retrieval_only');
  if (!a.ok) return a.response;
  const { auth, messages, decision } = a;

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
  const latencyMs = Date.now() - started;

  // Metered, but no conversation document. The gateway never sees the
  // answer on this path, and a personal-scope exchange is not Mind training
  // data — see the trainingEligible note on the completion path.
  ctx.waitUntil(
    env.SINK.send({
      database: 'platform',
      collection: 'usageEvents',
      doc: {
        ownerEntityId: auth.ownerEntityId,
        apiKeyId: auth.apiKeyId,
        requestId,
        billingPeriod: billingPeriod(),
        tier: 'retrieval',
        provider: null,
        model: null,
        licenseClass: null,
        inputTokens: 0,
        outputTokens: 0,
        cacheHit: false,
        groundHit: g.hit,
        inferencePath: 'mind',
        edgeEmbedding: decision.destination === 'cloud',
        latencyMs,
        createdAt: new Date().toISOString(),
      },
    }).catch((e) => console.error('sink enqueue failed', String(e))),
  );

  return json({
    id: requestId,
    system_prompt: g.systemPrompt,
    shamwari: {
      scope: decision.scope,
      destination: decision.destination,
      language,
      grounded: g.hit,
      inference_path: 'mind',
      latency_ms: latencyMs,
      citations: citationsOf(g.chunks),
    },
  });
}

/**
 * The extractive rung: the cited passage from Ground, with no generation.
 *
 * Reached two ways: the caller asks for it (`mode: "extractive"`, the cheap
 * path for narrow channels), or every inference path failed and Ground has
 * something to say (`degraded`). Either way the scope gate has already run in
 * admit(), and nothing here reaches a provider.
 *
 * It writes a usage event and NO conversation row. An extractive answer has no
 * teacher model, so there is no honest `licenseClass` to stamp, and the chunks
 * it quotes carry their own `mind_eligible` terms that are not visible here.
 * Storing it as a conversation would put text of unknown training status in
 * the corpus that rule 2 protects, so it is metered and nothing more.
 */
function extractiveResponse(
  ctx: ExecutionContext,
  env: Env,
  a: {
    auth: AuthContext;
    decision: ScopeDecision;
    g: GroundResult;
    language: string | null;
    requestId: string;
    started: number;
    degraded: boolean;
    reach: Reach | undefined;
  },
): Response {
  const { auth, decision, g, language, requestId, started, degraded, reach } = a;
  // r0 is SMS/USSD: typographic characters would force UCS-2 and turn three
  // segments into seven, so the text is plain there.
  const built = extractiveAnswer(
    g.chunks,
    reach ? policy.reach[reach].extractive_max_chars : undefined,
    { plainText: reach === 'r0' },
  );
  const text = built ? built.text : NO_SOURCE_MESSAGE;
  const used = built ? built.used : [];
  const latencyMs = Date.now() - started;

  ctx.waitUntil(
    env.SINK.send({
      database: 'platform',
      collection: 'usageEvents',
      doc: {
        ownerEntityId: auth.ownerEntityId,
        apiKeyId: auth.apiKeyId,
        requestId,
        billingPeriod: billingPeriod(),
        tier: 'extractive',
        provider: null,
        model: null,
        licenseClass: null,
        inputTokens: 0,
        outputTokens: 0,
        cacheHit: false,
        groundHit: g.hit,
        inferencePath: 'extractive',
        reach: reach ?? null,
        // No model tier is chosen on this rung, so there is nothing to clamp.
        reachClamped: false,
        degraded,
        latencyMs,
        createdAt: new Date().toISOString(),
      },
    }).catch((e) => console.error('sink enqueue failed', String(e))),
  );

  return json({
    id: requestId,
    model: 'shamwari-extractive',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: text },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    shamwari: {
      tier: 'extractive',
      scope: decision.scope,
      language,
      grounded: g.hit,
      cache_hit: false,
      inference_path: 'extractive',
      reach: reach ?? null,
      degraded,
      truncated: built?.truncated ?? false,
      latency_ms: latencyMs,
      citations: citationsOf(used),
    },
  });
}

const worker = {
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
    if (url.pathname === '/v1/ground/context' && req.method === 'POST') {
      return groundContext(req, env, ctx);
    }
    if (url.pathname === '/v1/channels/sms' && req.method === 'POST') {
      return handleChannel(sms, req, env, (r) => worker.fetch(r, env, ctx));
    }
    if (url.pathname === '/v1/channels/ussd' && req.method === 'POST') {
      return handleChannel(ussd, req, env, (r) => worker.fetch(r, env, ctx));
    }
    if (url.pathname !== '/v1/chat/completions' || req.method !== 'POST') {
      return json({ error: 'not_found' }, 404);
    }

    const a = await admit(req, env, 'cloud_inference', true);
    if (!a.ok) return a.response;
    const { auth, body, messages, decision, quota } = a;

    // Only this endpoint has modes. /v1/ground/context shares admit() and must
    // not start refusing a field it has always ignored.
    if (body.mode !== undefined && body.mode !== 'extractive') {
      return json({ error: 'invalid_mode', allowed: ['extractive'] }, 400);
    }

    if (body.reach !== undefined && !isReach(body.reach)) {
      return json({ error: 'invalid_reach', allowed: REACHES }, 400);
    }
    const reach: Reach | undefined = isReach(body.reach) ? body.reach : undefined;
    const limits = reach ? policy.reach[reach] : undefined;

    if (body.format !== undefined && !isFormat(body.format)) {
      return json({ error: 'invalid_format', allowed: FORMATS }, 400);
    }
    const format: Format | undefined = isFormat(body.format) ? body.format : undefined;

    const rawKey = req.headers.get('Idempotency-Key');
    if (rawKey !== null && !idem.KEY_PATTERN.test(rawKey)) {
      return json({ error: 'invalid_idempotency_key', pattern: idem.KEY_PATTERN.source }, 400);
    }

    const produce = async (): Promise<Response> => {
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
      const rung = { auth, decision, g, language, requestId, started, reach };
      if (body.mode === 'extractive') {
        // "Ground could not be asked" is not "Ground has nothing": only the
        // second may be said to a person as a fact about the corpus.
        if (g.unavailable) {
          return new Response(
            JSON.stringify({ error: 'ground_unavailable', retry: true }, null, 2),
            {
              status: 503,
              headers: { 'Content-Type': 'application/json', 'Retry-After': '30' },
            },
          );
        }
        return extractiveResponse(ctx, env, { ...rung, degraded: false });
      }

      const routed = applyReach(route(messages, body.model, env), reach, env);
      const target = routed.target;
      let result: Awaited<ReturnType<typeof infer>>;
      try {
        result = await infer(
          env,
          target,
          [
            { role: 'system', content: g.systemPrompt },
            ...messages.filter((m) => m.role !== 'system'),
          ],
          {
            tier: target.tier,
            scope: decision.scope,
            ownerEntityId: auth.ownerEntityId,
            surface: env.SURFACE,
            requestId,
          },
          limits?.max_output_tokens,
        );
      } catch (e) {
        // Every inference path failed. With a Ground hit there is still a cited
        // answer to give; without one there is nothing honest to say, so the
        // failure stands.
        if (!g.hit) throw e;
        console.error('inference unavailable, answering from Ground', String(e));
        return extractiveResponse(ctx, env, { ...rung, degraded: true });
      }
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
            // Resolved from the model that actually answered, not from the
            // tier that was asked for. A dynamic route can substitute the
            // model without a deploy, and the Workers AI fallback always
            // does. See provenance.ts.
            licenseClass: result.licenseClass,
            requestedModel: `${result.requestedProvider}/${result.requestedModel}`,
            modelSubstituted: result.substituted,
            tier: target.tier,
            reach: reach ?? null,
            grounded: g.hit,
            // Two independent gates, and a row needs both.
            //
            // licenseClass gates the teacher model's terms. This gates the
            // user's: a personal-scope exchange is the user's own pod data and
            // is never Mind training material, whatever licence the teacher
            // model carries. Core rejects that combination outright.
            //
            // The licenceClass half is here too because the pipeline reads
            // trainingEligible, and a restricted row that is merely *labelled*
            // restricted while still flagged eligible relies on every future
            // reader joining the two fields correctly.
            //
            // Channel traffic (SMS, USSD) is never trainable. It arrives from
            // people who have not been asked, in the channel where they are
            // most likely to type something personal, so it is metered and
            // nothing more until the owner decides on consent.
            trainingEligible:
              decision.scope !== 'personal' &&
              result.licenseClass === 'open_weight' &&
              !req.headers.has('X-Shamwari-Channel'),
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
            reach: reach ?? null,
            reachClamped: routed.clamped,
            routedTier: routed.routedTier,
            provider: result.provider,
            model: result.model,
            requestedProvider: result.requestedProvider,
            requestedModel: result.requestedModel,
            modelSubstituted: result.substituted,
            licenseClass: result.licenseClass,
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
          {
            index: 0,
            message: { role: 'assistant', content: result.text },
            finish_reason: result.finishReason,
          },
        ],
        usage: {
          prompt_tokens: result.inputTokens,
          completion_tokens: result.outputTokens,
          total_tokens: result.inputTokens + result.outputTokens,
        },
        shamwari: {
          tier: target.tier,
          reach: reach ?? null,
          reach_clamped: routed.clamped,
          truncated: result.finishReason === 'length',
          scope: decision.scope,
          language,
          grounded: g.hit,
          cache_hit: result.cacheHit,
          inference_path: result.path,
          model_served: `${result.provider}/${result.model}`,
          // Surfaced rather than buried in the usage event: a dynamic route
          // substituting the model is otherwise invisible to the caller.
          model_substituted: result.substituted,
          latency_ms: latencyMs,
          citations: citationsOf(g.chunks),
        },
      });
    };

    // Compact is a shape, applied last, so both rungs and the replay agree.
    const shaped = async (): Promise<Response> => {
      const res = await produce();
      if (format !== 'compact' || res.status !== 200) return res;
      return new Response(JSON.stringify(toCompact(await res.json(), reach === 'r0')), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    // A degraded answer (every inference path failed, Ground answered) is real
    // but not final: the retry should get the chance of a proper one.
    const worthStoring = (text: string): boolean => {
      try {
        const o = JSON.parse(text);
        return !(o.degraded ?? o.shamwari?.degraded);
      } catch {
        return false;
      }
    };

    if (rawKey === null) return (await quota()) ?? shaped();

    // The key is scoped to the entity and to the whole request: the same key
    // with a different request is a mistake, not a retry.
    const k = await idem.storageKey(auth.ownerEntityId, rawKey);
    const fp = await idem.fingerprint({
      messages,
      model: body.model,
      scope: body.scope,
      mode: body.mode,
      reach: body.reach,
      format: body.format,
    });
    const begun = await idem.begin(env.AUTH_CACHE, k, fp);
    if (begun.state === 'conflict') {
      return json(
        { error: 'idempotency_key_reuse', message: 'This key was used for a different request.' },
        422,
      );
    }
    if (begun.state === 'in_progress') {
      return json({ error: 'request_in_progress', retry: true }, 409, { 'Retry-After': '2' });
    }
    if (begun.state === 'replay') {
      // No quota check, no Ground, no inference, no usage event: a replay is
      // free, is not stored again, and is an answer the caller already earned.
      return new Response(begun.body, {
        status: begun.status,
        headers: { 'Content-Type': 'application/json', 'Idempotent-Replayed': 'true' },
      });
    }

    try {
      const over = await quota();
      if (over) {
        ctx.waitUntil(idem.release(env.AUTH_CACHE, k));
        return over;
      }
      const res = await shaped();
      if (res.status === 200) {
        const text = await res.clone().text();
        ctx.waitUntil(
          worthStoring(text)
            ? idem.complete(
                env.AUTH_CACHE,
                k,
                fp,
                { status: res.status, body: text },
                decision.scope,
              )
            : idem.release(env.AUTH_CACHE, k),
        );
      } else {
        ctx.waitUntil(idem.release(env.AUTH_CACHE, k));
      }
      return res;
    } catch (e) {
      ctx.waitUntil(idem.release(env.AUTH_CACHE, k));
      throw e;
    }
  },

  async queue(batch: MessageBatch<SinkMessage>, env: Env): Promise<void> {
    await drain(batch, env);
  },

  /**
   * Weekly degradation probe. See probe.ts for why this is a cron rather
   * than the manual monthly chore CLAUDE.md used to prescribe.
   *
   * It writes through the same queue as everything else, so a Core outage
   * delays the reading rather than losing it, and so the probe does not
   * become the one thing in the Worker that talks to a database directly.
   */
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    const report = await probe(env);

    if (!report.allPathsHealthy) {
      // Loud in the Worker log as well as durable in Mongo. The fallback
      // paths existing is the whole basis of "Cloudflare is an enhancement,
      // never a dependency", so a rotted one should not be discoverable
      // only by remembering to query for it.
      console.error(
        'degradation probe: not all inference paths healthy',
        JSON.stringify(report.results),
      );
    }

    ctx.waitUntil(
      env.SINK.send(healthDoc(report)).catch((e) =>
        console.error('probe sink enqueue failed', String(e)),
      ),
    );
  },
} satisfies ExportedHandler<Env, SinkMessage>;

export default worker;
