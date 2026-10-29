// The extractive rung through the real handler. The counts are the tests:
// an extractive answer must make no inference call, must never be stored as a
// conversation (rule 2: no teacher model, unknown mind_eligible terms), and the
// scope gate must run before any of it (rule 1).
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import worker from '../src/index';
import type { Env, GroundChunk, SinkMessage } from '../src/types';

const CHUNK: GroundChunk = {
  content: 'Every person has the right to life.',
  heading: 'Section 48',
  title: 'Constitution of Zimbabwe',
  authority: 'Parliament of Zimbabwe',
  resource_type: 'legislation',
  source_url: 'https://example.invalid/constitution',
  effective_from: '2013-05-22',
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

interface Calls {
  embed: number;
  ground: number;
  inference: number;
  sink: SinkMessage[];
}

function setup(
  opts: {
    chunks?: GroundChunk[];
    inferenceFails?: boolean;
    embedFails?: boolean;
    coreDown?: boolean;
    mind?: boolean;
    /** What the key is allowed to ask for; absent means the default (no personal). */
    scopes?: string[];
  } = {},
) {
  const calls: Calls = { embed: 0, ground: 0, inference: 0, sink: [] };
  const chunks = opts.chunks ?? [CHUNK];
  const env = {
    AI: {
      run: vi.fn(async () => {
        calls.embed += 1;
        if (opts.embedFails) throw new Error('workers ai down');
        if (opts.inferenceFails && calls.embed > 1) throw new Error('workers ai down');
        return { data: [Array.from({ length: 1024 }, () => 0.1)], response: 'generated' };
      }),
    },
    AUTH_CACHE: {
      get: async () => (opts.scopes ? { ...AUTH, scopes: opts.scopes } : AUTH),
      put: async () => {},
    },
    SINK: {
      send: async (m: SinkMessage) => void calls.sink.push(m),
      sendBatch: async (ms: { body: SinkMessage }[]) =>
        void calls.sink.push(...ms.map((m) => m.body)),
    },
    CORE_URL: 'https://core.example',
    SHAMWARI_CORE_TOKEN: 't',
    EMBEDDING_MODEL: '@cf/baai/bge-m3',
    GROUND_TOP_K: '6',
    AUTH_CACHE_TTL: '300',
    ECONOMY_MODEL: '@cf/zai-org/glm-5.3-flash',
    STANDARD_MODEL: '@cf/zai-org/glm-5.3',
    SURFACE: 'shamwari.ai',
    MIND_AVAILABLE: opts.mind ? 'true' : 'false',
    CF_ACCOUNT_ID: 'acct',
    CF_GATEWAY_ID: 'gw',
    CF_ROUTE_NAME: 'shamwari',
    CF_AIG_TOKEN: { get: async () => 'aig' },
  } as unknown as Env;

  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('/rollup')) return Response.json({ total_tokens: 0 });
    if (u.includes('/ground/search')) {
      calls.ground += 1;
      if (opts.coreDown) return new Response('down', { status: 503 });
      return Response.json({ chunks, hit: chunks.length > 0 });
    }
    calls.inference += 1;
    void init;
    return opts.inferenceFails
      ? new Response('down', { status: 503 })
      : Response.json({ choices: [{ message: { content: 'generated' } }], usage: {} });
  });
  return { env, calls };
}

const ctx = {
  waitUntil: (p: Promise<unknown>) => void p.catch(() => {}),
} as unknown as ExecutionContext;

function ask(body: Record<string, unknown>) {
  return new Request('https://gw.example/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer sk_shamwari_test', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'Do I have a right to life?' }],
      ...body,
    }),
  });
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('mode: extractive', () => {
  it('answers with the cited passage and makes no inference call', async () => {
    const { env, calls } = setup();
    const res = await worker.fetch(ask({ mode: 'extractive' }), env, ctx);
    const j = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(j.choices[0].message.content).toContain('Every person has the right to life.');
    expect(j.choices[0].message.content).toContain('Closest source: Constitution of Zimbabwe');
    expect(j.shamwari.inference_path).toBe('extractive');
    expect(j.shamwari.degraded).toBe(false);
    expect(j.shamwari.citations).toHaveLength(1);
    expect(j.usage.total_tokens).toBe(0);
    expect(calls.inference).toBe(0);
  });

  it('is metered, and is never stored as a conversation or marked trainable', async () => {
    const { env, calls } = setup();
    await worker.fetch(ask({ mode: 'extractive' }), env, ctx);
    await Promise.resolve();
    expect(calls.sink.map((m) => m.collection)).toEqual(['usageEvents']);
    expect(calls.sink.some((m) => m.collection === 'conversations')).toBe(false);
    expect(calls.sink[0]?.doc).toMatchObject({
      scope: 'platform',
      inferencePath: 'extractive',
      inputTokens: 0,
      outputTokens: 0,
    });
  });

  it('says plainly that it found nothing, and cites nothing, when Ground is empty', async () => {
    const { env } = setup({ chunks: [] });
    const j = (await (await worker.fetch(ask({ mode: 'extractive' }), env, ctx)).json()) as any;
    expect(j.shamwari.grounded).toBe(false);
    expect(j.shamwari.citations).toEqual([]);
    expect(j.choices[0].message.content).toMatch(/will not guess/);
  });

  // RULE 1. The scope gate runs in admit(), before the mode is read.
  it('still refuses personal scope for a cloud destination, before anything is called', async () => {
    const { env, calls } = setup();
    const res = await worker.fetch(ask({ mode: 'extractive', scope: 'personal' }), env, ctx);
    expect(res.status).toBe(409);
    expect(((await res.json()) as any).error).toBe('scope_requires_local_inference');
    expect(calls.embed + calls.ground + calls.inference).toBe(0);
  });

  it('rejects a mode it does not know instead of ignoring it', async () => {
    const { env, calls } = setup();
    const res = await worker.fetch(ask({ mode: 'turbo' }), env, ctx);
    expect(res.status).toBe(400);
    expect(calls.embed + calls.ground + calls.inference).toBe(0);
  });
});

describe('when every inference path fails', () => {
  it('answers from Ground, says it degraded, rather than failing', async () => {
    const { env } = setup({ inferenceFails: true });
    const res = await worker.fetch(ask({}), env, ctx);
    const j = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(j.shamwari.inference_path).toBe('extractive');
    expect(j.shamwari.degraded).toBe(true);
    expect(j.choices[0].message.content).toContain('Closest source: Constitution of Zimbabwe');
  });

  it('has nothing honest to say without a Ground hit, so the failure stands', async () => {
    const { env } = setup({ inferenceFails: true, chunks: [] });
    await expect(worker.fetch(ask({}), env, ctx)).rejects.toThrow();
  });
});

describe('a normal answer is unchanged', () => {
  it('still goes to inference and still stores the conversation', async () => {
    const { env, calls } = setup();
    const res = await worker.fetch(ask({}), env, ctx);
    const j = (await res.json()) as any;
    expect(j.shamwari.inference_path).toBe('gateway');
    expect(calls.inference).toBe(1);
    await Promise.resolve();
    expect(calls.sink.map((m) => m.collection).sort()).toEqual(['conversations', 'usageEvents']);
    // Every usage event carries the scope label, on every path.
    const usage = calls.sink.find((m) => m.collection === 'usageEvents')?.doc as any;
    expect(usage).toMatchObject({ scope: 'platform' });
    // The cost is an estimate from a versioned table; null when the model is unpriced.
    expect(usage.priceTableVersion).toBeTruthy();
    expect(usage).toHaveProperty('costUsdEstimate');
    expect(usage.costUsdEstimate === null || typeof usage.costUsdEstimate === 'number').toBe(true);
  });
});

describe('what the review found', () => {
  it('still answers when the embedding model is down, by keyword search', async () => {
    const { env, calls } = setup({ embedFails: true });
    const res = await worker.fetch(ask({ mode: 'extractive' }), env, ctx);
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).shamwari.grounded).toBe(true);
    expect(calls.ground).toBe(1);
  });

  it('does not tell a person the corpus lacks something when Core could not be asked', async () => {
    const { env } = setup({ coreDown: true });
    const res = await worker.fetch(ask({ mode: 'extractive' }), env, ctx);
    expect(res.status).toBe(503);
    expect(res.headers.get('Retry-After')).toBe('30');
    expect(((await res.json()) as any).error).toBe('ground_unavailable');
  });

  it('the degraded answer is metered as degraded and is never stored as a conversation', async () => {
    const { env, calls } = setup({ inferenceFails: true });
    await worker.fetch(ask({}), env, ctx);
    await Promise.resolve();
    expect(calls.sink.map((m) => m.collection)).toEqual(['usageEvents']);
    expect(calls.sink[0]?.doc).toMatchObject({ inferencePath: 'extractive', degraded: true });
  });

  it('personal scope is refused on the degraded path as well, with nothing called', async () => {
    const { env, calls } = setup({ inferenceFails: true });
    const res = await worker.fetch(ask({ scope: 'personal' }), env, ctx);
    expect(res.status).toBe(409);
    expect(calls.embed + calls.ground + calls.inference).toBe(0);
  });

  it('does not make the mind endpoint start refusing a field it has always ignored', async () => {
    const { env } = setup({ mind: true, scopes: ['personal', 'community', 'platform'] });
    const req = new Request('https://gw.example/v1/ground/context', {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_shamwari_test', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'ndiri kuda alert' }],
        scope: 'personal',
        mode: 'chat',
      }),
    });
    const calls = (env as unknown as { SINK: { send: (m: unknown) => void } }).SINK;
    const sent: any[] = [];
    calls.send = (m) => void sent.push(m);
    const res = await worker.fetch(req, env, ctx);
    expect(res.status).toBe(200);
    await Promise.resolve();
    expect(sent.find((m) => m.collection === 'usageEvents')?.doc).toMatchObject({
      scope: 'personal',
      inferencePath: 'mind',
    });
  });
});

describe('a key may only ask for the scopes it holds', () => {
  const mindAsk = (scope: string) =>
    new Request('https://gw.example/v1/ground/context', {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_shamwari_test', 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'my payslip' }], scope }),
    });

  it('RULE 1: a key without personal cannot make a personal request, and nothing is called', async () => {
    const { env, calls } = setup({ mind: true }); // default scopes: community and platform
    const res = await worker.fetch(mindAsk('personal'), env, ctx);
    expect(res.status).toBe(403);
    expect(((await res.json()) as any).error).toBe('scope_not_permitted_for_key');
    expect(calls.embed).toBe(0);
    expect(calls.ground).toBe(0);
    expect(calls.inference).toBe(0);
    expect(calls.sink).toEqual([]);
  });

  it('a key that holds personal may use it on the retrieval-only endpoint', async () => {
    const { env, calls } = setup({ mind: true, scopes: ['personal', 'platform'] });
    const res = await worker.fetch(mindAsk('personal'), env, ctx);
    expect(res.status).toBe(200);
    expect(calls.inference).toBe(0);
  });

  it('holding personal never lets personal reach Cloud: chat still answers 409', async () => {
    const { env, calls } = setup({ scopes: ['personal', 'community', 'platform'] });
    const res = await worker.fetch(ask({ scope: 'personal' }), env, ctx);
    expect(res.status).toBe(409);
    expect(calls.embed + calls.ground + calls.inference).toBe(0);
  });

  it('a key limited to platform cannot ask for community', async () => {
    const { env } = setup({ scopes: ['platform'] });
    const res = await worker.fetch(ask({ scope: 'community' }), env, ctx);
    expect(res.status).toBe(403);
  });

  it('the default allows community and platform, so existing keys keep working', async () => {
    const { env } = setup();
    expect((await worker.fetch(ask({ scope: 'platform' }), env, ctx)).status).toBe(200);
  });
});
