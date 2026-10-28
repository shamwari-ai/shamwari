// Idempotent requests and the compact envelope. The counts are the tests: a
// replay must make no Ground, inference or sink call, so a retry over a flaky
// link is neither slow nor billed twice; and personal scope (rule 1) must be
// refused before anything is stored, so a stored answer is always a Platform or
// Community one.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import worker from '../src/index';
import { toCompact } from '../src/envelope';
import { DONE_TTL_SECONDS, PENDING_TTL_SECONDS } from '../src/idempotency';
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

const authFor = (owner: string) => ({
  apiKeyId: 'k1',
  ownerEntityId: owner,
  ownerPersonId: null,
  keyType: 'standard',
  tier: 'community',
  monthlyTokenCap: 100_000,
});

interface Counts {
  ground: number;
  inference: number;
  sink: SinkMessage[];
}

/** One KV shared by every env, as one namespace is shared by every caller. */
function makeKv() {
  const store = new Map<string, string>();
  const puts: { key: string; ttl: number | undefined }[] = [];
  return { store, puts };
}

function setup(opts: {
  kv?: ReturnType<typeof makeKv>;
  owner?: string;
  chunks?: GroundChunk[];
  inferenceFails?: boolean;
}) {
  const kv = opts.kv ?? makeKv();
  const counts: Counts = { ground: 0, inference: 0, sink: [] };
  const chunks = opts.chunks ?? [CHUNK];
  const env = {
    AI: { run: vi.fn(async () => ({ data: [Array.from({ length: 1024 }, () => 0.1)] })) },
    AUTH_CACHE: {
      get: async (k: string) =>
        k.startsWith('auth:') ? authFor(opts.owner ?? 'e1') : JSON.parse(kv.store.get(k) ?? 'null'),
      put: async (k: string, v: string, o?: { expirationTtl?: number }) => {
        if (!k.startsWith('auth:')) {
          kv.store.set(k, v);
          kv.puts.push({ key: k, ttl: o?.expirationTtl });
        }
      },
      delete: async (k: string) => void kv.store.delete(k),
    },
    SINK: {
      send: async (m: SinkMessage) => void counts.sink.push(m),
      sendBatch: async (ms: { body: SinkMessage }[]) =>
        void counts.sink.push(...ms.map((m) => m.body)),
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

  vi.stubGlobal('fetch', async (url: string) => {
    const u = String(url);
    if (u.includes('/rollup')) return Response.json({ total_tokens: 0 });
    if (u.includes('/ground/search')) {
      counts.ground += 1;
      return Response.json({ chunks, hit: chunks.length > 0 });
    }
    counts.inference += 1;
    if (opts.inferenceFails) return new Response('down', { status: 503 });
    return Response.json({ choices: [{ message: { content: 'ok' } }], usage: {} });
  });
  return { env, counts, kv };
}

const pending: Promise<unknown>[] = [];
const ctx = {
  waitUntil: (p: Promise<unknown>) => void pending.push(p.catch(() => {})),
} as unknown as ExecutionContext;
const settle = () => Promise.all(pending.splice(0));

function ask(
  body: Record<string, unknown> = {},
  key?: string,
  content = 'Do I have a right to life?',
) {
  return new Request('https://gw.example/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer sk_shamwari_test',
      'Content-Type': 'application/json',
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    body: JSON.stringify({ messages: [{ role: 'user', content }], ...body }),
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

describe('Idempotency-Key', () => {
  it('a retry with the same key and request is the same answer, with nothing run again', async () => {
    const { env, counts } = setup({});
    const first = await worker.fetch(ask({}, 'retry-1'), env, ctx);
    const firstBody = await first.text();
    await settle();
    const afterFirst = {
      ground: counts.ground,
      inference: counts.inference,
      sink: counts.sink.length,
    };

    const second = await worker.fetch(ask({}, 'retry-1'), env, ctx);
    expect(second.status).toBe(200);
    expect(second.headers.get('Idempotent-Replayed')).toBe('true');
    expect(await second.text()).toBe(firstBody);
    await settle();
    expect({
      ground: counts.ground,
      inference: counts.inference,
      sink: counts.sink.length,
    }).toEqual(afterFirst);
    expect(first.headers.get('Idempotent-Replayed')).toBeNull();
  });

  it('without a key every request runs and nothing is stored', async () => {
    const { env, counts, kv } = setup({});
    await worker.fetch(ask({}), env, ctx);
    await worker.fetch(ask({}), env, ctx);
    await settle();
    expect(counts.inference).toBe(2);
    expect(kv.store.size).toBe(0);
  });

  it('the same key with a different request is refused, not answered', async () => {
    const { env, counts } = setup({});
    await worker.fetch(ask({}, 'k'), env, ctx);
    await settle();
    const before = counts.inference;
    const res = await worker.fetch(ask({}, 'k', 'Something else entirely'), env, ctx);
    expect(res.status).toBe(422);
    expect(((await res.json()) as any).error).toBe('idempotency_key_reuse');
    expect(counts.inference).toBe(before);
  });

  it('the format is part of the request, so the same key cannot change shape', async () => {
    const { env } = setup({});
    await worker.fetch(ask({}, 'k'), env, ctx);
    await settle();
    const res = await worker.fetch(ask({ format: 'compact' }, 'k'), env, ctx);
    expect(res.status).toBe(422);
  });

  it('is scoped to the calling entity: another entity with the same key runs afresh', async () => {
    const kv = makeKv();
    const a = setup({ kv, owner: 'entity-a' });
    await worker.fetch(ask({}, 'shared'), a.env, ctx);
    await settle();
    const b = setup({ kv, owner: 'entity-b' });
    const res = await worker.fetch(ask({}, 'shared'), b.env, ctx);
    expect(res.headers.get('Idempotent-Replayed')).toBeNull();
    expect(b.counts.inference).toBe(1);
  });

  it('a request still in flight is a 409 with Retry-After, not a second run', async () => {
    const { env, counts, kv } = setup({});
    // Start one and do not let it settle: its pending marker is what a retry sees.
    const first = worker.fetch(ask({}, 'slow'), env, ctx);
    await first;
    const key = [...kv.store.keys()][0]!;
    kv.store.set(
      key,
      JSON.stringify({ ...JSON.parse(kv.store.get(key)!), state: 'pending', response: undefined }),
    );
    const before = counts.inference;
    const res = await worker.fetch(ask({}, 'slow'), env, ctx);
    expect(res.status).toBe(409);
    expect(res.headers.get('Retry-After')).toBe('2');
    expect(counts.inference).toBe(before);
  });

  it('a failed attempt is not an answer: the retry runs', async () => {
    const { env, counts } = setup({ inferenceFails: true, chunks: [] });
    await expect(worker.fetch(ask({}, 'boom'), env, ctx)).rejects.toThrow();
    await settle();
    await expect(worker.fetch(ask({}, 'boom'), env, ctx)).rejects.toThrow();
    expect(counts.inference).toBeGreaterThanOrEqual(2);
  });

  it('a non-200 answer is not stored either', async () => {
    const { env, kv } = setup({ chunks: [] });
    vi.stubGlobal('fetch', async (u: string) =>
      String(u).includes('/rollup')
        ? Response.json({ total_tokens: 0 })
        : new Response('down', { status: 503 }),
    );
    const res = await worker.fetch(ask({ mode: 'extractive' }, 'g'), env, ctx);
    expect(res.status).toBe(503);
    await settle();
    expect(kv.store.size).toBe(0);
  });

  it('rejects a malformed key before anything is called', async () => {
    const { env, counts } = setup({});
    for (const bad of ['has space', 'x'.repeat(65), 'café']) {
      const res = await worker.fetch(ask({}, bad), env, ctx);
      expect(res.status).toBe(400);
      expect(((await res.json()) as any).error).toBe('invalid_idempotency_key');
    }
    expect(counts.ground + counts.inference).toBe(0);
  });

  // RULE 1. Personal scope is refused in admit(), before the key is read, so a
  // personal request is never stored and can never be replayed.
  it('stores nothing for a personal-scope request, which is refused first', async () => {
    const { env, counts, kv } = setup({});
    const res = await worker.fetch(ask({ scope: 'personal' }, 'p1'), env, ctx);
    expect(res.status).toBe(409);
    await settle();
    expect(kv.store.size).toBe(0);
    expect(counts.ground + counts.inference).toBe(0);
  });

  it('stores only what it needs: the response, for ten minutes, under a hashed key', async () => {
    const { env, kv } = setup({});
    await worker.fetch(ask({}, 'my-secret-looking-key'), env, ctx);
    await settle();
    const stored = kv.puts.filter((p) => p.key.startsWith('idem:'));
    expect(stored.map((p) => p.ttl)).toEqual([PENDING_TTL_SECONDS, DONE_TTL_SECONDS]);
    expect(stored.every((p) => !p.key.includes('my-secret-looking-key'))).toBe(true);
    expect(stored.every((p) => p.key.startsWith('idem:e1:'))).toBe(true);
  });
});

describe('the compact envelope', () => {
  it('has only what a narrow channel needs', async () => {
    const { env } = setup({});
    const res = await worker.fetch(ask({ format: 'compact' }), env, ctx);
    const j = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(j).sort()).toEqual(
      ['answer', 'cites', 'degraded', 'id', 'scope', 'truncated', 'via'].sort(),
    );
    expect(j.answer).toBe('ok');
    expect(j.scope).toBe('platform');
    expect(j.via).toBe('gateway');
    expect(j.cites).toEqual([
      {
        n: 1,
        label: 'Constitution of Zimbabwe - Section 48',
        url: 'https://example.invalid/constitution',
      },
    ]);
  });

  it('is smaller than the default shape for the same answer', async () => {
    const a = setup({});
    const verbose = await (await worker.fetch(ask({}), a.env, ctx)).text();
    const b = setup({});
    const compact = await (await worker.fetch(ask({ format: 'compact' }), b.env, ctx)).text();
    expect(compact.length).toBeLessThan(verbose.length);
  });

  it('works for an extractive answer, and says so', async () => {
    const { env, counts } = setup({});
    const j = (await (
      await worker.fetch(ask({ format: 'compact', mode: 'extractive' }), env, ctx)
    ).json()) as any;
    expect(j.via).toBe('extractive');
    expect(j.answer).toContain('Every person has the right to life.');
    expect(counts.inference).toBe(0);
  });

  it('is rejected when the name is unknown, before anything is called', async () => {
    const { env, counts } = setup({});
    const res = await worker.fetch(ask({ format: 'tiny' }), env, ctx);
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error).toBe('invalid_format');
    expect(counts.ground + counts.inference).toBe(0);
  });

  it('leaves an error as an error, not a compact answer', async () => {
    const { env } = setup({});
    const res = await worker.fetch(ask({ format: 'compact', scope: 'personal' }), env, ctx);
    expect(res.status).toBe(409);
    expect(((await res.json()) as any).error).toBe('scope_requires_local_inference');
  });

  it('a replay of a compact answer is compact', async () => {
    const { env } = setup({});
    const first = await (await worker.fetch(ask({ format: 'compact' }, 'c1'), env, ctx)).text();
    await settle();
    const again = await worker.fetch(ask({ format: 'compact' }, 'c1'), env, ctx);
    expect(again.headers.get('Idempotent-Replayed')).toBe('true');
    expect(await again.text()).toBe(first);
  });

  it('toCompact drops the url when a source has none', () => {
    const c = toCompact({
      id: 'x',
      choices: [{ message: { content: 'a' } }],
      shamwari: {
        scope: 'platform',
        inference_path: 'extractive',
        citations: [{ title: 'T', heading: null, url: null }],
      },
    });
    expect(c.cites).toEqual([{ n: 1, label: 'T' }]);
    expect(c.truncated).toBe(false);
  });
});
