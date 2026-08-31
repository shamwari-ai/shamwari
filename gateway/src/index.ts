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
