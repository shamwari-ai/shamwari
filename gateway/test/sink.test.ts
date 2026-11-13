// The sink queue consumer: a permanent refusal of one document must not poison the other
// documents in its batch, and a transient failure must still retry as before.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { drain } from '../src/sink';
import type { Env, SinkMessage } from '../src/types';

const env = { CORE_URL: 'https://core.example', SHAMWARI_CORE_TOKEN: 'tok' } as unknown as Env;

type Doc = Record<string, unknown>;
const doc = (requestId: string, extra: Doc = {}): SinkMessage => ({
  database: 'shamwari',
  collection: 'conversations',
  doc: { requestId, secretPrompt: 'PRIVATE TEXT', ...extra },
});

function batch(bodies: SinkMessage[]) {
  const acked: SinkMessage[] = [];
  const retried: SinkMessage[] = [];
  const messages = bodies.map((body) => ({
    body,
    ack: () => void acked.push(body),
    retry: () => void retried.push(body),
  }));
  return { acked, retried, batch: { messages } as unknown as MessageBatch<SinkMessage> };
}

/** A Core that stores every document except those whose requestId is in `bad`. */
function core(opts: { bad?: string[]; badStatus?: number; transient?: number; down?: boolean } = {}) {
  const stored: string[] = [];
  const sizes: number[] = [];
  const fn = vi.fn(async (_url: string, init: RequestInit) => {
    if (opts.down) throw new TypeError('network down');
    if (opts.transient) return new Response('upstream broke', { status: opts.transient });
    const { collections } = JSON.parse(String(init.body)) as { collections: Record<string, Doc[]> };
    const docs = Object.values(collections).flat();
    sizes.push(docs.length);
    if (docs.some((d) => opts.bad?.includes(String(d.requestId)))) {
      const status = opts.badStatus ?? 400;
      return new Response(JSON.stringify({ detail: { error: 'invalid_field_name' } }), { status });
    }
    stored.push(...docs.map((d) => String(d.requestId)));
    return new Response(JSON.stringify({ written: {} }), { status: 200 });
  });
  vi.stubGlobal('fetch', fn);
  return { fn, stored, sizes };
}

let log: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  log = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  log.mockRestore();
  vi.unstubAllGlobals();
});

describe('a batch with one poison document', () => {
  for (const status of [400, 409, 413, 422]) {
    it(`stores the others and parks only the bad one (${status})`, async () => {
      const c = core({ bad: ['r3'], badStatus: status });
      const b = batch(['r1', 'r2', 'r3', 'r4', 'r5'].map((r) => doc(r)));
      await drain(b.batch, env);
      expect(c.stored.sort()).toEqual(['r1', 'r2', 'r4', 'r5']);
      // Every message is settled once and none is left to retry or to reach the DLQ.
      expect(b.acked.map((m) => (m.doc as Doc).requestId).sort()).toEqual(['r1', 'r2', 'r3', 'r4', 'r5']);
      expect(b.retried).toEqual([]);
    });
  }

  it('isolates it by bisecting, not by sending documents one at a time', async () => {
    const bodies = Array.from({ length: 100 }, (_, i) => doc(`r${i}`));
    const c = core({ bad: ['r42'] });
    await drain(batch(bodies).batch, env);
    expect(c.stored).toHaveLength(99);
    expect(c.fn.mock.calls.length).toBeLessThan(25); // ~2 log2(100) + a few, never 100
  });

  it('treats a batch where EVERY document is refused as a fault, not as poison: nothing is dropped', async () => {
    // A Core/API mismatch refuses everything; dropping 100 documents would be data loss.
    const c = core({ bad: ['r1', 'r2', 'r3', 'r4'], badStatus: 422 });
    const b = batch(['r1', 'r2', 'r3', 'r4'].map((r) => doc(r)));
    await expect(drain(b.batch, env)).rejects.toThrow('sink 422');
    expect(b.acked).toEqual([]);
    expect(c.stored).toEqual([]);
    expect(log.mock.calls.filter((call: unknown[]) => String(call[0]).includes('parked'))).toEqual([]);
  });

  it('still drops a lone refused document (a batch of one is the poison document itself)', async () => {
    core({ bad: ['r1'] });
    const b = batch([doc('r1')]);
    await drain(b.batch, env);
    expect(b.acked).toHaveLength(1);
  });

  it('does not retry the permanent failure', async () => {
    const c = core({ bad: ['r1'] });
    await drain(batch([doc('r1')]).batch, env);
    expect(c.fn).toHaveBeenCalledTimes(1);
  });

  it('logs identifiers only: request id, collection, status and the error code; never content', async () => {
    core({ bad: ['r3'] });
    await drain(batch([doc('r1'), doc('r3', { messages: [{ content: 'SECRET WORDS' }] })]).batch, env);
    const text = JSON.stringify(log.mock.calls);
    expect(text).toContain('r3');
    expect(text).toContain('conversations');
    expect(text).toContain('400');
    expect(text).toContain('invalid_field_name');
    for (const leaked of ['PRIVATE TEXT', 'SECRET WORDS', 'secretPrompt', 'tok', 'core.example']) {
      expect(text).not.toContain(leaked);
    }
  });

  it('logs nothing at all that is not a plain identifier, even if the request id is hostile', async () => {
    core({ bad: ['not an id: PRIVATE TEXT'] });
    await drain(batch([doc('not an id: PRIVATE TEXT')]).batch, env);
    expect(JSON.stringify(log.mock.calls)).not.toContain('PRIVATE TEXT');
  });

  it('keeps the good documents of other databases and collections', async () => {
    const c = core({ bad: ['p2'] });
    const platform: SinkMessage = { database: 'platform', collection: 'usageEvents', doc: { requestId: 'p1' } };
    const badPlatform: SinkMessage = { database: 'platform', collection: 'usageEvents', doc: { requestId: 'p2' } };
    await drain(batch([doc('r1'), platform, badPlatform]).batch, env);
    expect(c.stored.sort()).toEqual(['p1', 'r1']);
  });
});

describe('a transient failure retries as before', () => {
  for (const status of [500, 502, 503, 504, 429, 401, 404]) {
    it(`throws on ${status}, so the queue retries the batch, and acknowledges nothing`, async () => {
      core({ transient: status });
      const b = batch([doc('r1'), doc('r2')]);
      await expect(drain(b.batch, env)).rejects.toThrow(`sink ${status}`);
      expect(b.acked).toEqual([]);
    });
  }

  it('throws when Core cannot be reached', async () => {
    core({ down: true });
    await expect(drain(batch([doc('r1')]).batch, env)).rejects.toThrow();
  });

  it('after isolating a poison document, a transient failure still retries only what is unsettled', async () => {
    let n = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u: string, init: RequestInit) => {
        n += 1;
        const { collections } = JSON.parse(String(init.body)) as { collections: Record<string, Doc[]> };
        const ids = Object.values(collections).flat().map((d) => d.requestId);
        if (ids.length === 1 && ids[0] === 'r2') return new Response('x', { status: 503 });
        if (ids.includes('r2') || ids.includes('r1')) return new Response('{}', { status: 400 });
        return new Response('{}', { status: 200 });
      }),
    );
    const b = batch([doc('r1'), doc('r2'), doc('r3')]);
    await expect(drain(b.batch, env)).rejects.toThrow('sink 503');
    expect(n).toBeGreaterThan(1);
    expect(b.retried).toEqual([]); // throwing is what retries; nothing is acked twice
  });
});

describe('a good batch', () => {
  it('is one request and every message acknowledged', async () => {
    const c = core();
    const b = batch([doc('r1'), doc('r2')]);
    await drain(b.batch, env);
    expect(c.fn).toHaveBeenCalledTimes(1);
    expect(b.acked).toHaveLength(2);
  });

  it('sends to CORE_URL/sink/bulk with the Core token and nothing for the Servers API', async () => {
    const c = core();
    await drain(batch([doc('r1')]).batch, env);
    const [url, init] = c.fn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://core.example/sink/bulk');
    const headers = init.headers as Record<string, string>;
    expect(Object.keys(headers).sort()).toEqual(['Authorization', 'Content-Type']);
    expect(headers.Authorization).toBe('Bearer tok');
  });
});
