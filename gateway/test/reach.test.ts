// Reach is how the caller reaches Shamwari (r0 SMS/USSD, r1 chat app, r2 Lite
// PWA). It is a ceiling: it clamps the model tier down and caps generation, and
// it never raises anything. It must not weaken either rule: personal scope is
// still a 409 before anything is called, and the tier it clamps to still gets
// its licence class from code (router.ts), not from the policy file.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import worker from '../src/index';
import {
  applyReach,
  targets,
  policy,
  validatePolicy,
  DEFAULT_MAX_OUTPUT_TOKENS,
} from '../src/router';
import { viaGateway, viaWorkersAI } from '../src/gateway';
import type { Env, GroundChunk, SinkMessage, Message } from '../src/types';

const CHUNK: GroundChunk = {
  content: 'Rainfall of 20 mm is expected this week. '.repeat(60),
  heading: 'Weekly outlook',
  title: 'Mukoko Weather',
  authority: 'Nyuchi',
  resource_type: 'weather',
  source_url: null,
  effective_from: '2026-10-28',
  scope: 'platform',
};

const AUTH = {
  apiKeyId: 'k1',
  ownerEntityId: 'e1',
  ownerPersonId: null,
  keyType: 'standard',
  tier: 'community',
  monthlyTokenCap: 100_000,
};

interface Seen {
  inference: { body: Record<string, unknown>; headers: Record<string, string> }[];
  ground: number;
  embed: number;
  sink: SinkMessage[];
}

function setup() {
  const seen: Seen = { inference: [], ground: 0, embed: 0, sink: [] };
  const env = {
    AI: {
      run: vi.fn(async () => {
        seen.embed += 1;
        return { data: [Array.from({ length: 1024 }, () => 0.1)] };
      }),
    },
    AUTH_CACHE: { get: async () => AUTH, put: async () => {} },
    SINK: {
      send: async (m: SinkMessage) => void seen.sink.push(m),
      sendBatch: async (ms: { body: SinkMessage }[]) =>
        void seen.sink.push(...ms.map((m) => m.body)),
    },
    CORE_URL: 'https://core.example',
    SHAMWARI_CORE_TOKEN: 't',
    EMBEDDING_MODEL: '@cf/baai/bge-m3',
    GROUND_TOP_K: '6',
    AUTH_CACHE_TTL: '300',
    ECONOMY_MODEL: '@cf/zai-org/glm-5.3-flash',
    STANDARD_MODEL: '@cf/zai-org/glm-5.3',
    SURFACE: 'shamwari.ai',
    MIND_AVAILABLE: 'false',
    CF_ACCOUNT_ID: 'acct',
    CF_GATEWAY_ID: 'gw',
    CF_ROUTE_NAME: 'shamwari',
    CF_AIG_TOKEN: { get: async () => 'aig' },
  } as unknown as Env;

  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('/rollup')) return Response.json({ total_tokens: 0 });
    if (u.includes('/ground/search')) {
      seen.ground += 1;
      return Response.json({ chunks: [CHUNK], hit: true });
    }
    seen.inference.push({
      body: JSON.parse(String(init?.body)),
      headers: init?.headers as Record<string, string>,
    });
    return Response.json({ choices: [{ message: { content: 'ok' } }], usage: {} });
  });
  return { env, seen };
}

const ctx = {
  waitUntil: (p: Promise<unknown>) => void p.catch(() => {}),
} as unknown as ExecutionContext;

const ESCALATING = 'Please calculate the total rainfall for my three fields step by step.';
const SIMPLE = 'Will it rain tomorrow?';

function ask(body: Record<string, unknown>, content = SIMPLE) {
  return new Request('https://gw.example/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer sk_shamwari_test', 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content }], ...body }),
  });
}

const tierSent = (s: Seen) => JSON.parse(s.inference[0]!.headers['cf-aig-metadata']!).tier;

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('applyReach', () => {
  const env = { ECONOMY_MODEL: 'e', STANDARD_MODEL: 's' } as unknown as Env;

  it('clamps a standard route down to economy at r0, and says so', () => {
    const r = applyReach(targets(env).standard, 'r0', env);
    expect(r.target.tier).toBe('economy');
    expect(r.clamped).toBe(true);
  });

  it('is a ceiling, never a floor', () => {
    expect(applyReach(targets(env).economy, 'r2', env).clamped).toBe(false);
    expect(applyReach(targets(env).economy, 'r2', env).target.tier).toBe('economy');
    expect(applyReach(targets(env).standard, 'r1', env).clamped).toBe(false);
  });

  it('leaves a request with no reach untouched', () => {
    const t = targets(env).standard;
    expect(applyReach(t, undefined, env)).toEqual({
      target: t,
      clamped: false,
      routedTier: 'standard',
    });
  });

  it('can never be the way to premium: a premium target is clamped to the ceiling', () => {
    const r = applyReach(targets(env).premium, 'r2', env);
    expect(r.target.tier).toBe('standard');
    expect(r.clamped).toBe(true);
  });

  it('takes provenance from code: the clamped tier is open_weight as router.ts says', () => {
    expect(applyReach(targets(env).standard, 'r0', env).target.licenseClass).toBe('open_weight');
  });
});

describe('through the handler', () => {
  it('a request with no reach behaves exactly as before', async () => {
    const { env, seen } = setup();
    const res = await worker.fetch(ask({}), env, ctx);
    const j = (await res.json()) as any;
    expect(seen.inference[0]!.body.max_tokens).toBe(DEFAULT_MAX_OUTPUT_TOKENS);
    expect(j.shamwari.reach).toBeNull();
    expect(j.shamwari.reach_clamped).toBe(false);
  });

  it('r0 clamps an escalating question to economy and caps the output', async () => {
    const { env, seen } = setup();
    const j = (await (
      await worker.fetch(ask({ reach: 'r0' }, ESCALATING), env, ctx)
    ).json()) as any;
    expect(tierSent(seen)).toBe('economy');
    expect(seen.inference[0]!.body.max_tokens).toBe(policy.reach.r0.max_output_tokens);
    expect(j.shamwari).toMatchObject({ tier: 'economy', reach: 'r0', reach_clamped: true });
  });

  it('r1 lets the same question reach standard, with its own cap', async () => {
    const { env, seen } = setup();
    const j = (await (
      await worker.fetch(ask({ reach: 'r1' }, ESCALATING), env, ctx)
    ).json()) as any;
    expect(tierSent(seen)).toBe('standard');
    expect(seen.inference[0]!.body.max_tokens).toBe(policy.reach.r1.max_output_tokens);
    expect(j.shamwari.reach_clamped).toBe(false);
  });

  it('r2 has the largest cap', async () => {
    const { env, seen } = setup();
    await worker.fetch(ask({ reach: 'r2' }), env, ctx);
    expect(seen.inference[0]!.body.max_tokens).toBe(policy.reach.r2.max_output_tokens);
  });

  it('records the reach on the usage event and the conversation', async () => {
    const { env, seen } = setup();
    await worker.fetch(ask({ reach: 'r1' }), env, ctx);
    await Promise.resolve();
    const usage = seen.sink.find((m) => m.collection === 'usageEvents')!;
    const convo = seen.sink.find((m) => m.collection === 'conversations')!;
    expect(usage.doc).toMatchObject({ reach: 'r1', reachClamped: false });
    expect(convo.doc).toMatchObject({ reach: 'r1' });
  });

  it('rejects a reach it does not know, before any embedding, retrieval or inference', async () => {
    const { env, seen } = setup();
    for (const bad of ['r3', 'R0', 'sms', 5, null]) {
      const res = await worker.fetch(ask({ reach: bad }), env, ctx);
      expect(res.status).toBe(400);
      expect(((await res.json()) as any).error).toBe('invalid_reach');
    }
    expect(seen.embed + seen.ground + seen.inference.length).toBe(0);
  });

  // RULE 1. R0 to R2 all hand text to a provider, so none may carry personal scope.
  it('still refuses personal scope on every reach, with nothing called', async () => {
    for (const reach of ['r0', 'r1', 'r2']) {
      const { env, seen } = setup();
      const res = await worker.fetch(ask({ reach, scope: 'personal' }), env, ctx);
      expect(res.status).toBe(409);
      expect(((await res.json()) as any).error).toBe('scope_requires_local_inference');
      expect(seen.embed + seen.ground + seen.inference.length).toBe(0);
    }
  });

  it('caps an extractive answer by reach', async () => {
    const small = setup();
    const a = (await (
      await worker.fetch(ask({ reach: 'r0', mode: 'extractive' }), small.env, ctx)
    ).json()) as any;
    const big = setup();
    const b = (await (
      await worker.fetch(ask({ reach: 'r2', mode: 'extractive' }), big.env, ctx)
    ).json()) as any;
    const lenA = a.choices[0].message.content.length;
    const lenB = b.choices[0].message.content.length;
    expect(lenA).toBeLessThanOrEqual(policy.reach.r0.extractive_max_chars);
    expect(lenB).toBeGreaterThan(lenA);
    expect(lenB).toBeLessThanOrEqual(policy.reach.r2.extractive_max_chars);
    expect(a.shamwari.reach).toBe('r0');
    expect(small.seen.inference.length).toBe(0);
  });
});

describe('the token cap at the inference steps', () => {
  const messages: Message[] = [{ role: 'user', content: 'hi' }];
  const meta = {
    tier: 'economy',
    scope: 'platform',
    ownerEntityId: 'e',
    surface: 's',
    requestId: 'r',
  } as const;

  function env() {
    return {
      AI: { run: vi.fn(async () => ({ response: 'ok' })) },
      CF_ACCOUNT_ID: 'a',
      CF_GATEWAY_ID: 'g',
      CF_ROUTE_NAME: 'shamwari',
      CF_AIG_TOKEN: { get: async () => 't' },
      ECONOMY_MODEL: 'e',
      STANDARD_MODEL: 's',
    } as unknown as Env;
  }

  it('the gateway step sends the lower cap and never a higher one', async () => {
    const sent: number[] = [];
    vi.stubGlobal('fetch', async (_u: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)).max_tokens);
      return Response.json({ choices: [{ message: { content: 'ok' } }] });
    });
    const e = env();
    await viaGateway(e, targets(e).economy, messages, { ...meta }, false, 200);
    await viaGateway(e, targets(e).economy, messages, { ...meta }, false, 999_999);
    expect(sent).toEqual([200, DEFAULT_MAX_OUTPUT_TOKENS]);
  });

  it('the Workers AI step sends max_tokens only when a reach asks for less', async () => {
    const e = env();
    await viaWorkersAI(e, targets(e).economy, messages);
    await viaWorkersAI(e, targets(e).economy, messages, 200);
    const calls = (e.AI.run as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(calls[0]![1]).not.toHaveProperty('max_tokens');
    expect(calls[1]![1]).toMatchObject({ max_tokens: 200 });
  });
});

describe('what the review of this change found', () => {
  it('keeps the tier it was routed to before the clamp, so clamping can be measured', async () => {
    const { env, seen } = setup();
    await worker.fetch(ask({ reach: 'r0' }, ESCALATING), env, ctx);
    await Promise.resolve();
    const usage = seen.sink.find((m) => m.collection === 'usageEvents')!;
    expect(usage.doc).toMatchObject({
      tier: 'economy',
      routedTier: 'standard',
      reachClamped: true,
    });
  });

  it('tells the caller when the output cap cut the answer off', async () => {
    const { env } = setup();
    vi.stubGlobal('fetch', async (url: string) => {
      const u = String(url);
      if (u.includes('/rollup')) return Response.json({ total_tokens: 0 });
      if (u.includes('/ground/search')) return Response.json({ chunks: [CHUNK], hit: true });
      return Response.json({
        choices: [{ message: { content: 'cut off mid' }, finish_reason: 'length' }],
      });
    });
    const j = (await (await worker.fetch(ask({ reach: 'r0' }), env, ctx)).json()) as any;
    expect(j.choices[0].finish_reason).toBe('length');
    expect(j.shamwari.truncated).toBe(true);
  });

  it('does not accept a cap the code would never honour', () => {
    const p = JSON.parse(JSON.stringify(policy)) as typeof policy;
    p.reach.r2.max_output_tokens = DEFAULT_MAX_OUTPUT_TOKENS + 1;
    expect(() => validatePolicy(p)).toThrow(/max_output_tokens must be at most/);
  });

  it('keeps r0 extractive text to plain characters, so an SMS stays in one encoding', async () => {
    const fancy: GroundChunk = {
      ...CHUNK,
      title: 'Constitution \u2014 Zimbabwe',
      content: 'It\u2019s \u201Cthe right\u201D \u2013 and more\u2026',
    };
    const { env } = setup();
    vi.stubGlobal('fetch', async (url: string) => {
      const u = String(url);
      if (u.includes('/rollup')) return Response.json({ total_tokens: 0 });
      return Response.json({ chunks: [fancy], hit: true });
    });
    const r0 = (await (
      await worker.fetch(ask({ reach: 'r0', mode: 'extractive' }), env, ctx)
    ).json()) as any;
    const text: string = r0.choices[0].message.content;
    expect(text).not.toMatch(/[\u2013\u2014\u2018\u2019\u201C\u201D\u2026]/);
    expect(text).toContain('It\'s "the right" - and more...');
    const r1 = (await (
      await worker.fetch(ask({ reach: 'r1', mode: 'extractive' }), env, ctx)
    ).json()) as any;
    expect(r1.choices[0].message.content).toContain('\u2014');
  });
});
