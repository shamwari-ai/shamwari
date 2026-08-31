import type { Env, Message, SinkMessage, AuthContext } from './types';
import { authenticate } from './auth';
import { parseScope, decideDestination, ScopeRefusal } from './scope';
import type { Capability, ScopeDecision } from './scope';
import { route } from './router';
import { infer } from './gateway';
import { ground } from './ground';
import { drain } from './sink';
import { detectLanguage } from './lang';
import { core } from './core';
import { probe, healthDoc } from './probe';

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

interface ChatBody {
  messages?: Message[];
  model?: string;
  scope?: string;
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
): Promise<
  | { ok: false; response: Response }
  | { ok: true; auth: AuthContext; body: ChatBody; messages: Message[]; decision: ScopeDecision }
> {
  const auth = await authenticate(req, env);
  if (!auth) return { ok: false, response: json({ error: 'invalid_api_key' }, 401) };
  if (await overQuota(env, auth)) {
    return {
      ok: false,
      response: json(
        {
          error: 'quota_exceeded',
          tier: auth.tier,
          upgrade: 'https://platform.shamwari.ai/billing',
        },
        429,
      ),
    };
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
    return { ok: true, auth, body, messages, decision: decideDestination(scope, env, capability) };
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
      citations: g.chunks.map((c) => ({
        title: c.title,
        heading: c.heading,
        authority: c.authority,
        effective_from: c.effective_from,
        url: c.source_url,
      })),
    },
  });
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
    if (url.pathname === '/v1/ground/context' && req.method === 'POST') {
      return groundContext(req, env, ctx);
    }
    if (url.pathname !== '/v1/chat/completions' || req.method !== 'POST') {
      return json({ error: 'not_found' }, 404);
    }

    const a = await admit(req, env, 'cloud_inference');
    if (!a.ok) return a.response;
    const { auth, body, messages, decision } = a;

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
    const result = await infer(
      env,
      target,
      [{ role: 'system', content: g.systemPrompt }, ...messages.filter((m) => m.role !== 'system')],
      {
        tier: target.tier,
        scope: decision.scope,
        ownerEntityId: auth.ownerEntityId,
        surface: env.SURFACE,
        requestId,
      },
    );
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
          trainingEligible: decision.scope !== 'personal' && result.licenseClass === 'open_weight',
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
        model_served: `${result.provider}/${result.model}`,
        // Surfaced rather than buried in the usage event: a dynamic route
        // substituting the model is otherwise invisible to the caller.
        model_substituted: result.substituted,
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
