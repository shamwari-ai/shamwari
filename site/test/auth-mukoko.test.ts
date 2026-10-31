import { describe, expect, it, vi } from 'vitest';
import { mukokoAuth, parseExpiry } from '../src/chat/auth-mukoko';

const TOKEN = 'eyJhbGciOiJSUzI1NiJ9.payload-secret-part.signature';

/** A storage that records every touch, so "never persisted" is a measurement, not a hope. */
const spyStorage = () => {
  const writes: string[] = [];
  const data = new Map<string, string>();
  return {
    writes,
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      writes.push(`${k}=${v}`);
      data.set(k, v);
    },
    removeItem: (k: string) => void data.delete(k),
  };
};

const tokenResponse = (token = TOKEN, expiresInSec = 300) =>
  new Response(JSON.stringify({ access_token: token, expires_at: Math.floor(Date.now() / 1000) + expiresInSec }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

describe('mukoko auth', () => {
  it('holds the token in memory and writes it nowhere', async () => {
    const hint = spyStorage();
    const auth = mukokoAuth({ fetch: (async () => tokenResponse()) as typeof fetch, hintStorage: hint });
    expect(await auth.refresh()).toBe(true);
    expect(await auth.ensureKey()).toBe(TOKEN);
    // The only thing ever stored is a boolean hint, never any part of the token.
    expect(hint.writes).toEqual(['shamwari.mukoko.hint=1']);
    expect(JSON.stringify([...hint.data])).not.toContain('eyJ');
    expect(JSON.stringify([...hint.data])).not.toContain('payload-secret-part');
  });

  it('never touches localStorage, sessionStorage or cookies itself', async () => {
    const touched: string[] = [];
    const trap = (name: string) => new Proxy({}, { get: () => () => void touched.push(name) });
    vi.stubGlobal('localStorage', trap('localStorage'));
    vi.stubGlobal('sessionStorage', trap('sessionStorage'));
    const auth = mukokoAuth({ fetch: (async () => tokenResponse()) as typeof fetch, hintStorage: spyStorage() });
    await auth.refresh();
    await auth.ensureKey();
    await auth.signOut();
    vi.unstubAllGlobals();
    expect(touched).toEqual([]);
  });

  it('asks the session endpoint with the cookie and no caching, and sends nothing else', async () => {
    const fetchMock = vi.fn(async () => tokenResponse());
    const auth = mukokoAuth({ fetch: fetchMock as unknown as typeof fetch, hintStorage: spyStorage() });
    await auth.refresh();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/chat/auth/token');
    expect(init).toMatchObject({ method: 'GET', credentials: 'same-origin', cache: 'no-store' });
    expect(init.body).toBeUndefined();
  });

  it('sign-out clears the token at once and tells the session to end', async () => {
    const calls: string[] = [];
    const auth = mukokoAuth({
      fetch: (async (u: string, init?: RequestInit) => {
        calls.push(`${init?.method} ${u}`);
        return u.includes('logout') ? new Response(null, { status: 204 }) : tokenResponse();
      }) as typeof fetch,
      hintStorage: spyStorage(),
    });
    await auth.refresh();
    expect(auth.signedIn()).toBe(true);
    await auth.signOut();
    expect(auth.getKey()).toBeNull();
    expect(auth.signedIn()).toBe(false);
    expect(await auth.ensureKey()).toBeNull(); // and it does not quietly sign itself back in
    expect(calls).toContain('POST /chat/auth/logout');
  });

  it('sign-out still clears the page if the logout call fails', async () => {
    const auth = mukokoAuth({
      fetch: (async (u: string) => {
        if (u.includes('logout')) throw new Error('offline');
        return tokenResponse();
      }) as typeof fetch,
      hintStorage: spyStorage(),
    });
    await auth.refresh();
    await auth.signOut();
    expect(auth.getKey()).toBeNull();
  });

  it('renews an expired token silently, and shares one request between callers', async () => {
    let now = 1_000_000;
    let calls = 0;
    const auth = mukokoAuth({
      now: () => now,
      fetch: (async () => {
        calls += 1;
        return new Response(JSON.stringify({ access_token: `tok${calls}`, expires_at: (now + 300_000) / 1000 }), { status: 200 });
      }) as typeof fetch,
      hintStorage: spyStorage(),
    });
    expect(await auth.ensureKey()).toBe('tok1');
    expect(await auth.ensureKey()).toBe('tok1'); // still good: no second call
    expect(calls).toBe(1);
    now += 400_000; // expired
    const [a, b, c] = await Promise.all([auth.ensureKey(), auth.ensureKey(), auth.refresh()]);
    expect(a).toBe('tok2');
    expect(b).toBe('tok2');
    expect(c).toBe(true);
    expect(calls).toBe(2); // three callers, one renewal: refresh tokens are single use
  });

  it('a 401 from the session means signed out, and stays so', async () => {
    const auth = mukokoAuth({ fetch: (async () => new Response('{}', { status: 401 })) as typeof fetch, hintStorage: spyStorage() });
    expect(await auth.refresh()).toBe(false);
    expect(auth.signedIn()).toBe(false);
  });

  it('being offline is not being signed out', async () => {
    const hint = spyStorage();
    hint.data.set('shamwari.mukoko.hint', '1'); // signed in on an earlier visit
    const auth = mukokoAuth({
      fetch: (async () => {
        throw new Error('network');
      }) as typeof fetch,
      hintStorage: hint,
    });
    expect(await auth.refresh()).toBe(false);
    expect(auth.signedIn()).toBe(true); // the person can still write questions, which queue
    expect(auth.getKey()).toBeNull();
  });

  it('refuses a malformed answer rather than holding a half token', async () => {
    const auth = mukokoAuth({ fetch: (async () => new Response('{"access_token":"x"}', { status: 200 })) as typeof fetch, hintStorage: spyStorage() });
    expect(await auth.refresh()).toBe(false);
    expect(auth.getKey()).toBeNull();
  });

  it('reads the expiry however the Worker writes it', () => {
    expect(parseExpiry(1_900_000_000)).toBe(1_900_000_000_000);
    expect(parseExpiry(1_900_000_000_000)).toBe(1_900_000_000_000);
    expect(parseExpiry('2030-01-01T00:00:00Z')).toBe(Date.parse('2030-01-01T00:00:00Z'));
    expect(parseExpiry('nonsense')).toBeNull();
  });
});
