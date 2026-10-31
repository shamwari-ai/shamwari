// End-to-end contract: the real Worker code, over real HTTP, against a real Core process.
//
//   scripts/e2e.sh
//
// Skipped unless E2E_CORE_URL is set, so `npm test` stays hermetic. The Core on the other
// end is core/e2e_app.py: Core's real app over an in-memory store that holds the ingested
// fixture corpus (and a chunk that must never be served). The model is a fake that reads the
// system prompt it is sent and answers from it, so a citation in the answer proves the
// section travelled Ground -> Core -> Worker -> prompt -> answer.
//
// What this proves that the unit tests cannot: that what the Worker sends is what Core
// accepts, and that Core's refusals are what the Worker expects. A mock of Core would agree
// with the Worker by construction.
//
// Rule 1 is stated as counts. A personal-scope request that reaches a provider, an embedder,
// the store or the sink queue is a leak even if the response is a 409.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';
import { drain } from '../src/sink';
import type { AuthContext, Env, SinkMessage } from '../src/types';

const CORE = process.env.E2E_CORE_URL;
const TOKEN = process.env.E2E_CORE_TOKEN ?? 'e2e-core-token';
const realFetch = globalThis.fetch;

const AUTH: AuthContext = {
  apiKeyId: 'k1',
  ownerEntityId: 'e1',
  ownerPersonId: null,
  keyType: 'shamwari',
  tier: 'community',
  monthlyTokenCap: 100_000,
};

interface Wire {
  /** Every request the Worker sent to Core: path and parsed body. */
  core: { path: string; body: Record<string, unknown> | null }[];
  /** Every request that would have reached a model provider. */
  inference: { system: string; headers: Record<string, string> }[];
  /** Every call to the Workers AI binding: embeddings, and the fallback model if it was reached. */
  ai: { model: string; text: string | null }[];
  sink: SinkMessage[];
  pending: Promise<unknown>[];
}

let served = { provider: 'workers-ai', model: '@cf/zai-org/glm-5.3-flash' };

let apiKey = '';

function world(
  over: Partial<AuthContext> = {},
  envOver: Record<string, string> = {},
  opts: { realAuth?: boolean } = {},
) {
  // With realAuth the key check is not stubbed: the Worker asks Core's /auth/verify.
  const kv = new Map<string, string>();
  const wire: Wire = { core: [], inference: [], ai: [], sink: [], pending: [] };
  const env = {
    AI: {
      run: async (model: string, input: { text?: string[] }) => {
        const text = input.text?.[0] ?? null;
        wire.ai.push({ model, text });
        if (text === null) throw new Error('the Workers AI fallback must not be reached in this test');
        const res = await realFetch(`${CORE}/__e2e/embed`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        });
        return res.json();
      },
    },
    AUTH_CACHE: opts.realAuth
      ? {
          get: async (k: string) => (kv.has(k) ? JSON.parse(kv.get(k)!) : null),
          put: async (k: string, v: string) => void kv.set(k, v),
        }
      : { get: async () => ({ ...AUTH, ...over }), put: async () => {} },
    SINK: {
      send: async (m: SinkMessage) => void wire.sink.push(m),
      sendBatch: async (ms: { body: SinkMessage }[]) => void wire.sink.push(...ms.map((m) => m.body)),
    },
    CORE_URL: CORE,
    SHAMWARI_CORE_TOKEN: TOKEN,
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
    ...envOver,
  } as unknown as Env;

  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.startsWith(CORE!)) {
      const raw = init?.body ? String(init.body) : null;
      wire.core.push({
        path: new URL(u).pathname,
        body: raw ? (JSON.parse(raw) as Record<string, unknown>) : null,
      });
      return realFetch(url, init);
    }
    if (u.includes('gateway.ai.cloudflare.com')) {
      const body = JSON.parse(String(init?.body)) as { messages: { role: string; content: string }[] };
      const system = body.messages.find((m) => m.role === 'system')?.content ?? '';
      wire.inference.push({ system, headers: (init?.headers ?? {}) as Record<string, string> });
      // The fake model answers from the Ground context it was handed: it cites the first
      // numbered source, by its heading, or says it has none.
      const first = /\[1\] ([^\n]+)/.exec(system)?.[1];
      const text = first ? `According to [1] ${first}.` : 'Ground has nothing on this.';
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: text }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 120, completion_tokens: 12 },
        }),
        {
          headers: {
            'Content-Type': 'application/json',
            'cf-aig-provider': served.provider,
            'cf-aig-model': served.model,
          },
        },
      );
    }
    throw new Error(`unexpected outbound request: ${u}`);
  });

  const ctx = {
    waitUntil: (p: Promise<unknown>) => void wire.pending.push(p.catch(() => {})),
  } as unknown as ExecutionContext;

  const call = async (path: string, body: Record<string, unknown>, key = apiKey) => {
    const res = await worker.fetch(
      new Request(`https://gw.example${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
      env,
      ctx,
    );
    await Promise.all(wire.pending);
    return { status: res.status, body: (await res.json()) as Record<string, any> };
  };

  /** What the queue consumer does with what the Worker enqueued. */
  const flush = async () => {
    const messages = wire.sink.map((body) => ({ body })) as unknown as MessageBatch<SinkMessage>['messages'];
    await drain({ messages } as unknown as MessageBatch<SinkMessage>, env);
  };

  return { env, wire, call, flush };
}

async function coreState() {
  const res = await realFetch(`${CORE}/__e2e/state`);
  return (await res.json()) as {
    kb_reads: number;
    embed_calls: number;
    stored: Record<string, Record<string, any>[]>;
  };
}

const ask = (content: string, extra: Record<string, unknown> = {}) => ({
  messages: [{ role: 'user', content }],
  ...extra,
});

describe.skipIf(!CORE)('gateway -> Core -> Ground -> answer (real HTTP, fake model)', () => {
  beforeAll(async () => {
    apiKey = ((await (await realFetch(`${CORE}/__e2e/key`)).json()) as { key: string }).key;
  });
  beforeEach(async () => {
    served = { provider: 'workers-ai', model: '@cf/zai-org/glm-5.3-flash' };
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await realFetch(`${CORE}/__e2e/reset`, { method: 'POST' });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('a platform-scope question', () => {
    it('is answered from the section Core retrieved, with the citation in the response', async () => {
      const w = world();
      const r = await w.call('/v1/chat/completions', ask('What does section 56 say about equality?'));

      expect(r.status).toBe(200);
      expect(r.body.shamwari.grounded).toBe(true);
      expect(r.body.shamwari.scope).toBe('platform');
      const cite = r.body.shamwari.citations[0];
      expect(cite.heading).toBe('s 56 Equality and non-discrimination');
      expect(cite.authority).toBe('Parliament of Zimbabwe');
      expect(cite.effective_from).toBe('2013-05-22');
      expect(cite.title).toBe('Constitution of Zimbabwe Amendment (No. 20) Act 2013');

      // The section travelled Core -> Worker -> the prompt the model saw -> the answer.
      expect(w.wire.inference).toHaveLength(1);
      expect(w.wire.inference[0]!.system).toContain('s 56 Equality and non-discrimination');
      expect(w.wire.inference[0]!.system).toContain('All persons are equal before the law');
      expect(r.body.choices[0].message.content).toBe(
        'According to [1] Constitution of Zimbabwe Amendment (No. 20) Act 2013 — s 56 Equality and non-discrimination — Parliament of Zimbabwe (effective 2013-05-22).',
      );
    });

    it('sends Core a cloud search with a 1024-dim question vector, and nothing but the question text', async () => {
      const w = world();
      await w.call('/v1/chat/completions', ask('Is it unlawful to discriminate because of tribe or sex?'));

      const search = w.wire.core.filter((c) => c.path === '/ground/search');
      expect(search).toHaveLength(1);
      expect(search[0]!.body).toMatchObject({ scope: 'platform', destination: 'cloud', owner_entity_id: 'e1' });
      expect((search[0]!.body!.embedding as number[]).length).toBe(1024);
      expect(w.wire.ai.map((a) => a.model)).toEqual(['@cf/baai/bge-m3']);
    });

    it("never serves another entity's chunk that matches the question exactly", async () => {
      const w = world();
      const r = await w.call('/v1/chat/completions', ask('All persons are equal before the law'));

      expect(r.status).toBe(200);
      const authorities = r.body.shamwari.citations.map((c: { authority: string }) => c.authority);
      expect(authorities.length).toBeGreaterThan(0);
      expect(authorities).not.toContain('PRIVATE');
      expect(w.wire.inference[0]!.system).not.toContain('PRIVATE');
    });

    // Found by this test: with a question vector, $vectorSearch returns the nearest chunks
    // however far away they are, so an off-topic question is still "grounded" and is handed
    // unrelated sections to cite. Core has no relevance floor on the vector branch, and a
    // miss (and so a groundMisses roadmap entry) can only happen on the keyword path. Needs a
    // score threshold, which needs real Atlas scores to tune: an owner/measurement decision.
    it.todo('reports a miss, not weak citations, when the question is off-topic (needs a relevance floor)');
  });

  describe("key verification against Core's /auth/verify (not stubbed)", () => {
    it('admits the real key, sends only the prefix and the hash, and carries the owner through', async () => {
      const w = world({}, {}, { realAuth: true });
      const r = await w.call('/v1/chat/completions', ask('What does section 56 say about equality?'));
      expect(r.status).toBe(200);

      const verify = w.wire.core.filter((c) => c.path === '/auth/verify');
      expect(verify).toHaveLength(1);
      expect(Object.keys(verify[0]!.body!).sort()).toEqual(['key_hash', 'key_prefix']);
      expect(verify[0]!.body!.key_prefix).toBe('sk_shamwari_');
      expect(verify[0]!.body!.key_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(w.wire.core)).not.toContain(apiKey); // the raw key never leaves the Worker

      await w.flush();
      const conv = (await coreState()).stored['shamwari.conversations']![0]!;
      expect(conv.ownerEntityId).toBe('e1'); // from Core's entity lookup, via the verify response
    });

    it('refuses a key Core does not know, before Ground, a provider or the sink', async () => {
      const w = world({}, {}, { realAuth: true });
      const r = await w.call(
        '/v1/chat/completions',
        ask('What does section 56 say about equality?'),
        'sk_shamwari_not_a_real_key_000000',
      );
      expect(r.status).toBe(401);
      expect(w.wire.core.map((c) => c.path)).toEqual(['/auth/verify']);
      expect(w.wire.inference).toHaveLength(0);
      expect(w.wire.ai).toHaveLength(0);
      expect(w.wire.sink).toHaveLength(0);
    });
  });

  describe('provenance stamping (rule 2), through the queue into Core', () => {
    it('stamps open_weight and trainable when an open-weight model served, and Core accepts it', async () => {
      const w = world();
      const r = await w.call('/v1/chat/completions', ask('What does section 56 say about equality?'));
      expect(r.body.shamwari.model_served).toBe('workers-ai/@cf/zai-org/glm-5.3-flash');
      expect(r.body.shamwari.model_substituted).toBe(false);

      await w.flush();
      const s = await coreState();
      const conv = s.stored['shamwari.conversations']![0]!;
      expect(conv).toMatchObject({
        scope: 'platform',
        licenseClass: 'open_weight',
        trainingEligible: true,
        grounded: true,
        teacherModel: 'workers-ai/@cf/zai-org/glm-5.3-flash',
      });
      expect(conv.citations[0].heading).toBe('s 56 Equality and non-discrimination');
      const usage = s.stored['platform.usageEvents']![0]!;
      expect(usage).toMatchObject({ licenseClass: 'open_weight', scope: 'platform', groundHit: true });
      expect(JSON.stringify(usage)).not.toContain('equality'); // metering carries no content
    });

    it('stamps restricted and not trainable when a dynamic route substituted an unlisted model', async () => {
      served = { provider: 'someone', model: 'unlisted-model-v1' };
      const w = world();
      const r = await w.call('/v1/chat/completions', ask('What does section 56 say about equality?'));
      expect(r.body.shamwari.model_substituted).toBe(true);

      await w.flush();
      const conv = (await coreState()).stored['shamwari.conversations']![0]!;
      expect(conv).toMatchObject({
        licenseClass: 'restricted',
        trainingEligible: false,
        teacherModel: 'someone/unlisted-model-v1',
        modelSubstituted: true,
      });
    });

    it('Core, independently, refuses a restricted row marked trainable', async () => {
      served = { provider: 'someone', model: 'unlisted-model-v1' };
      const w = world();
      await w.call('/v1/chat/completions', ask('What does section 56 say about equality?'));
      const tampered = w.wire.sink.map((m) =>
        m.collection === 'conversations' ? { ...m, doc: { ...m.doc, trainingEligible: true } } : m,
      );
      const res = await realFetch(`${CORE}/sink/bulk`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          database: 'shamwari',
          collections: { conversations: tampered.filter((m) => m.collection === 'conversations').map((m) => m.doc) },
        }),
      });
      expect(res.status).toBe(400);
      expect(await res.text()).toContain('restricted provenance');
      expect((await coreState()).stored['shamwari.conversations']).toEqual([]);
    });
  });

  describe('rule 1: personal scope never reaches a provider or an embedder', () => {
    const personal = { scope: 'personal' };

    /** Everything that must be zero when a personal-scope request is refused. */
    async function expectNothingTouched(w: ReturnType<typeof world>) {
      expect(w.wire.inference).toHaveLength(0);
      expect(w.wire.ai).toHaveLength(0);
      expect(w.wire.core.filter((c) => c.path === '/ground/search')).toHaveLength(0);
      expect(w.wire.sink).toHaveLength(0);
      const s = await coreState();
      expect(s.embed_calls).toBe(0);
      expect(s.kb_reads).toBe(0);
    }

    it('chat completions: 409 scope_requires_local_inference, with zero provider, embedding and store calls', async () => {
      const w = world({ scopes: ['personal', 'community', 'platform'] });
      const r = await w.call('/v1/chat/completions', ask('what is on my payslip?', personal));

      expect(r.status).toBe(409);
      expect(r.body.error).toBe('scope_requires_local_inference');
      expect(r.body.scope).toBe('personal');
      await expectNothingTouched(w);
    });

    it('chat completions: still a 409 when MIND_AVAILABLE is true (Mind is a client, not a backend)', async () => {
      const w = world({ scopes: ['personal', 'community', 'platform'] }, { MIND_AVAILABLE: 'true' });
      const r = await w.call('/v1/chat/completions', ask('what is on my payslip?', personal));

      expect(r.status).toBe(409);
      expect(r.body.error).toBe('scope_requires_local_inference');
      await expectNothingTouched(w);
    });

    it('chat completions: a key that does not hold personal gets the same 409, not a 403 about key scopes', async () => {
      const w = world(); // default scopes: community, platform
      const r = await w.call('/v1/chat/completions', ask('what is on my payslip?', personal));
      expect(r.status).toBe(409);
      expect(r.body.error).toBe('scope_requires_local_inference');
      await expectNothingTouched(w);
    });

    it('ground/context with Mind not available: 409, nothing touched', async () => {
      const w = world({ scopes: ['personal', 'community', 'platform'] });
      const r = await w.call('/v1/ground/context', ask('what is on my payslip?', personal));

      expect(r.status).toBe(409);
      expect(r.body.error).toBe('scope_requires_local_inference');
      await expectNothingTouched(w);
    });

    it('ground/context with Mind available: retrieval only, no embedding, no provider, no foreign chunk', async () => {
      const w = world({ scopes: ['personal', 'community', 'platform'] }, { MIND_AVAILABLE: 'true' });
      const r = await w.call('/v1/ground/context', ask('All persons are equal before the law', personal));

      expect(r.status).toBe(200);
      expect(r.body.shamwari.destination).toBe('mind');
      expect(r.body.shamwari.scope).toBe('personal');

      const search = w.wire.core.filter((c) => c.path === '/ground/search');
      expect(search).toHaveLength(1);
      expect(search[0]!.body).toMatchObject({ scope: 'personal', destination: 'mind' });
      expect(search[0]!.body).not.toHaveProperty('embedding');

      expect(w.wire.ai).toHaveLength(0); // no edge embedding of the user's words
      expect(w.wire.inference).toHaveLength(0); // no provider
      expect((await coreState()).embed_calls).toBe(0);
      expect(JSON.stringify(r.body)).not.toContain('someone-else');
    });

    it('Core refuses the same thing by itself: a buggy Worker cannot talk it into serving personal scope to Cloud', async () => {
      const res = await realFetch(`${CORE}/ground/search`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: 'my payslip',
          owner_entity_id: 'e1',
          scope: 'personal',
          destination: 'cloud',
        }),
      });
      expect(res.status).toBe(409);
      expect(((await res.json()) as any).detail.error).toBe('scope_requires_local_inference');
      expect((await coreState()).kb_reads).toBe(0);
    });

    it('Core refuses a mind-destination query that arrives with an edge embedding', async () => {
      const res = await realFetch(`${CORE}/ground/search`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: 'my payslip',
          embedding: Array.from({ length: 1024 }, () => 0.1),
          owner_entity_id: 'e1',
          scope: 'personal',
          destination: 'mind',
        }),
      });
      expect(res.status).toBe(409);
      expect(((await res.json()) as any).detail.error).toBe('edge_embedding_forbidden');
      expect((await coreState()).kb_reads).toBe(0);
    });
  });
});
