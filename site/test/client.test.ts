import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createMock } from '../chat-mock/server.mjs';
import { createClient, parseAnswer, parseCitations, safeUrl } from '../src/chat/client';

let server: Server;
let base = '';
beforeAll(async () => {
  server = createMock();
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

const withKey = (key: string | null) => createClient({ baseUrl: base, getKey: () => key });
const q = (content: string, scope?: 'personal') => ({
  messages: [{ role: 'user' as const, content }],
  ...(scope ? { scope } : {}),
});

describe('ask()', () => {
  it('returns the answer with its citations', async () => {
    const r = await withKey('sk_shamwari_mock_ok').ask(q('Is everyone equal under the law?'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.citations[0].heading).toMatch(/Section 56/);
    expect(r.value.citations[0].effective_from).toBe('2013-05-22');
    expect(r.value.grounded).toBe(true);
  });

  it('maps the personal-scope 409 to its own kind, not a generic error', async () => {
    const r = await withKey('sk_shamwari_mock_ok').ask(q('what is my salary', 'personal'));
    expect(r).toMatchObject({ ok: false, error: { kind: 'scope_requires_local_inference', status: 409 } });
  });

  it.each([
    ['sk_shamwari_mock_402', 'payment_required', 402],
    ['sk_shamwari_mock_403', 'forbidden_scope', 403],
    ['sk_shamwari_mock_429', 'rate_limited', 429],
    ['sk_shamwari_mock_503', 'unavailable', 503],
    ['not-a-shamwari-key', 'unauthorized', 401],
  ])('maps key %s to %s', async (key, kind, status) => {
    const r = await withKey(key).ask(q('hello'));
    expect(r).toMatchObject({ ok: false, error: { kind, status } });
  });

  it('carries Retry-After and the upgrade link on 429', async () => {
    const r = await withKey('sk_shamwari_mock_429').ask(q('hello'));
    expect(r.ok === false && r.error.retryAfterSec).toBe(30);
    expect(r.ok === false && r.error.upgradeUrl).toBe('https://platform.shamwari.ai/billing');
  });

  it('is unauthorized without a key, without touching the network', async () => {
    let called = false;
    const c = createClient({ baseUrl: base, getKey: () => null, fetch: (async () => { called = true; return new Response(); }) as typeof fetch });
    expect(await c.ask(q('hi'))).toMatchObject({ ok: false, error: { kind: 'unauthorized' } });
    expect(called).toBe(false);
  });

  it('treats a network failure as offline', async () => {
    const c = createClient({ baseUrl: 'http://127.0.0.1:1', getKey: () => 'sk_shamwari_x' });
    expect(await c.ask(q('hi'))).toMatchObject({ ok: false, error: { kind: 'offline' } });
  });

  it('sends one idempotency key so a retry is replayed, not re-answered', async () => {
    const c = withKey('sk_shamwari_mock_ok');
    const a = await c.ask(q('hello'), { idempotencyKey: 'k1' });
    const b = await c.ask(q('hello'), { idempotencyKey: 'k1' });
    expect(a.ok && b.ok && a.value.id === b.value.id).toBe(true);
  });

  it('separates the in-progress 409 from the scope 409', async () => {
    const c = createClient({
      baseUrl: base,
      getKey: () => 'sk_shamwari_x',
      fetch: (async () => new Response(JSON.stringify({ error: 'request_in_progress', retry: true }), { status: 409, headers: { 'Retry-After': '2' } })) as typeof fetch,
    });
    expect(await c.ask(q('hi'))).toMatchObject({ ok: false, error: { kind: 'busy', retryAfterSec: 2 } });
  });

  it('times out as offline', async () => {
    const c = createClient({
      baseUrl: base,
      getKey: () => 'sk_shamwari_x',
      timeoutMs: 20,
      fetch: ((_u: string, init: RequestInit) => new Promise((_, rej) => init.signal!.addEventListener('abort', () => rej(new Error('abort'))))) as typeof fetch,
    });
    expect(await c.ask(q('hi'))).toMatchObject({ ok: false, error: { kind: 'offline' } });
  });
});

describe('parsing', () => {
  it('only lets http(s) links through', () => {
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl('data:text/html,x')).toBeNull();
    expect(safeUrl('https://example.org/a')).toBe('https://example.org/a');
  });

  it('drops citations with no title and keeps the rest', () => {
    const cs = parseCitations([{ heading: 'x' }, { title: 'T', authority: 'A', url: 'javascript:1' }, 'junk']);
    expect(cs).toEqual([{ title: 'T', heading: null, authority: 'A', effective_from: null, url: null }]);
  });

  it('rejects a body that is not an answer', () => {
    expect(parseAnswer({})).toBeNull();
    expect(parseAnswer({ id: 'x', choices: [{ message: { content: '' } }] })).toBeNull();
  });

  it('never invents the personal scope', () => {
    const a = parseAnswer({ id: 'x', choices: [{ message: { content: 'hi' } }], shamwari: { scope: 'weird' } });
    expect(a?.scope).toBe('platform');
  });
});
