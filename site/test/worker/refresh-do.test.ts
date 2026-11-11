import { describe, expect, it } from 'vitest';
import { SessionRefresh, type DurableStorageLike } from '../../worker/refresh-do';
import type { Port } from '../../worker/workos-port';
import type { RefreshResult } from '../../worker/session';

const memoryStorage = () => {
  const m = new Map<string, unknown>();
  const s: DurableStorageLike & { m: Map<string, unknown> } = {
    m,
    get: async (k) => structuredClone(m.get(k)),
    put: async (k, v) => void m.set(k, structuredClone(v)),
  };
  return s;
};
const ok: RefreshResult = { status: 'ok', sealed: 'NEW', accessToken: 'AT' };
const portFor =
  (calls: string[], result: RefreshResult = ok) =>
  async () =>
    ({ refresh: async (s: string) => (calls.push(s), result) }) as unknown as Port;
const post = (sealed: unknown) =>
  new Request('https://session/refresh', { method: 'POST', body: JSON.stringify({ sealed }) });

describe('SessionRefresh (the Durable Object)', () => {
  it('survives an eviction: a second tab with the OLD cookie gets the first result, not a spent token', async () => {
    const storage = memoryStorage();
    const calls: string[] = [];
    const first = new SessionRefresh({ storage }, {}, portFor(calls));
    expect(await (await first.fetch(post('OLD'))).json()).toEqual(ok);

    // The object is evicted and a new one starts on the same storage.
    const second = new SessionRefresh({ storage }, {}, portFor(calls));
    expect(await (await second.fetch(post('OLD'))).json()).toEqual(ok);
    expect(calls).toEqual(['OLD']); // WorkOS was asked once
  });

  it('stores a hash of the old cookie, never the cookie itself', async () => {
    const storage = memoryStorage();
    await new SessionRefresh({ storage }, {}, portFor([])).fetch(post('OLD-COOKIE-VALUE'));
    const stored = JSON.stringify([...storage.m.values()]);
    expect(stored).not.toContain('OLD-COOKIE-VALUE');
    expect(stored).toMatch(/[0-9a-f]{64}/);
  });

  it('a different cookie refreshes again, and only successes are persisted', async () => {
    const storage = memoryStorage();
    const calls: string[] = [];
    const retry: RefreshResult = { status: 'retry' };
    const d = new SessionRefresh({ storage }, {}, portFor(calls, retry));
    expect(await (await d.fetch(post('A'))).json()).toEqual(retry);
    expect(storage.m.size).toBe(0);
    await new SessionRefresh({ storage }, {}, portFor(calls)).fetch(post('B'));
    await new SessionRefresh({ storage }, {}, portFor(calls)).fetch(post('C'));
    expect(calls).toEqual(['A', 'B', 'C']);
  });

  it('rejects a request without a cookie value', async () => {
    const d = new SessionRefresh({ storage: memoryStorage() }, {}, portFor([]));
    expect((await d.fetch(post(''))).status).toBe(400);
    expect((await d.fetch(new Request('https://session/refresh', { method: 'POST', body: 'nope' }))).status).toBe(400);
  });
});
