import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { challengeFor, base64url } from '../src/auth/pkce';
import { SessionUnavailable, Session, type BrowserResult, type Ports } from '../src/auth/session';
import { buildAuthorizeUrl, buildLogoutUrl, parseCallback, readClaims, type AuthConfig } from '../src/auth/workos';
import { createClient } from '../src/lib/client';

const cfg: AuthConfig = {
  clientId: 'client_test',
  redirectUri: 'ai.shamwari.app://callback',
  logoutReturnTo: 'ai.shamwari.app://signed-out',
  apiBase: 'https://api.workos.test',
};
const sha256 = async (s: string) => new Uint8Array(createHash('sha256').update(s).digest());
const jwt = (claims: Record<string, unknown>) =>
  `h.${base64url(new TextEncoder().encode(JSON.stringify(claims)))}.sig`;

interface Harness {
  s: Session;
  store: Map<string, string>;
  calls: { url: string; body: Record<string, string> }[];
  opened: string[];
  setNow(ms: number): void;
  respond: (r: () => Response | Promise<Response>) => void;
  browser: { next: (url: string) => BrowserResult | Promise<BrowserResult> };
}

function harness(): Harness {
  const store = new Map<string, string>();
  const calls: Harness['calls'] = [];
  const opened: string[] = [];
  let now = 1_000_000_000_000;
  let respond: () => Response | Promise<Response> = () => new Response('{}', { status: 500 });
  const browser = { next: (_u: string): BrowserResult | Promise<BrowserResult> => ({ type: 'cancel' }) };
  const ports: Ports = {
    fetch: (async (url: string, init: { body: string }) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return respond();
    }) as unknown as typeof fetch,
    secure: {
      get: async (k) => store.get(k) ?? null,
      set: async (k, v) => void store.set(k, v),
      delete: async (k) => void store.delete(k),
    },
    openAuthSession: async (url) => browser.next(url),
    openUrl: async (u) => void opened.push(u),
    randomBytes: (n) => new Uint8Array(randomBytes(n)),
    sha256,
    now: () => now,
  };
  return {
    s: new Session(cfg, ports),
    store, calls, opened, browser,
    setNow: (ms) => (now = ms),
    respond: (r) => (respond = r),
  };
}

const ok = (claims: Record<string, unknown>, refresh: string) =>
  new Response(JSON.stringify({ access_token: jwt(claims), refresh_token: refresh, user: { id: 'u' } }));
const stateOf = (url: string) => new URL(url).searchParams.get('state')!;
const NOW_S = 1_000_000_000;

/** A browser that completes sign-in, echoing back the state it was sent. */
const completes = (h: Harness, over: Partial<{ code: string; state: string }> = {}) => {
  h.browser.next = (url) => ({
    type: 'success',
    url: `ai.shamwari.app://callback?code=${over.code ?? 'code1'}&state=${over.state ?? stateOf(url)}`,
  });
};

describe('PKCE', () => {
  it('matches the RFC 7636 appendix B test vector', async () => {
    expect(await challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk', sha256)).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });
  it('builds an AuthKit authorize URL with S256 and no secret', () => {
    const u = new URL(buildAuthorizeUrl(cfg, { challenge: 'c', state: 's' }));
    expect(u.pathname).toBe('/user_management/authorize');
    for (const [k, v] of Object.entries({ response_type: 'code', client_id: 'client_test', provider: 'authkit', state: 's', code_challenge: 'c', code_challenge_method: 'S256', redirect_uri: cfg.redirectUri }))
      expect(u.searchParams.get(k), k).toBe(v);
    expect(u.search).not.toContain('secret');
  });
});

describe('sign-in', () => {
  it('exchanges with the verifier and NO client secret, keeps only the refresh token on disk, and clears the PKCE record', async () => {
    const h = harness();
    completes(h);
    h.respond(() => ok({ exp: NOW_S + 300, sid: 'sess_1' }, 'rt1'));
    expect(await h.s.signIn()).toBe('signed_in');
    const body = h.calls[0].body;
    expect(body).toMatchObject({ grant_type: 'authorization_code', code: 'code1', client_id: 'client_test' });
    expect(body.code_verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(Object.keys(body)).not.toContain('client_secret');
    expect([...h.store.keys()]).toEqual(['shamwari.rt']); // the PKCE record is gone
    expect(h.store.get('shamwari.rt')).toBe('rt1');
    expect([...h.store.values()].join()).not.toContain('sess_1'); // no access token on disk
    expect(await h.s.getAccessToken()).toContain('.');
  });

  it('persists the verifier and state BEFORE the browser opens (the app can be killed while it is up)', async () => {
    const h = harness();
    let sawPending = false;
    h.browser.next = () => {
      sawPending = h.store.has('shamwari.pkce');
      return { type: 'cancel' };
    };
    await h.s.signIn();
    expect(sawPending).toBe(true);
    expect(h.store.has('shamwari.pkce')).toBe(false); // and cleared after
  });

  it('refuses a redirect whose state does not match: no code exchange, record cleared', async () => {
    const h = harness();
    completes(h, { state: 'attacker' });
    expect(await h.s.signIn()).toBe('failed');
    expect(h.calls).toHaveLength(0);
    expect(h.store.size).toBe(0);
  });

  it('refuses a redirect when the pending record is gone', async () => {
    const h = harness();
    h.browser.next = (url) => {
      h.store.delete('shamwari.pkce');
      return { type: 'success', url: `ai.shamwari.app://callback?code=c&state=${stateOf(url)}` };
    };
    expect(await h.s.signIn()).toBe('failed');
    expect(h.calls).toHaveLength(0);
  });

  it('treats cancel and access_denied as cancelled, other errors and incomplete redirects as failed, never exchanging', async () => {
    const h = harness();
    h.browser.next = () => ({ type: 'cancel' });
    expect(await h.s.signIn()).toBe('cancelled');
    h.browser.next = () => ({ type: 'success', url: 'ai.shamwari.app://callback?error=access_denied' });
    expect(await h.s.signIn()).toBe('cancelled');
    h.browser.next = () => ({ type: 'success', url: 'ai.shamwari.app://callback?error=server_error' });
    expect(await h.s.signIn()).toBe('failed');
    h.browser.next = () => ({ type: 'success', url: 'ai.shamwari.app://callback?code=only' });
    expect(await h.s.signIn()).toBe('failed');
    expect(h.calls).toHaveLength(0);
    expect(h.store.size).toBe(0);
  });

  it('a failed exchange leaves nothing behind', async () => {
    const h = harness();
    completes(h);
    h.respond(() => new Response('{"error":"invalid_grant"}', { status: 401 }));
    expect(await h.s.signIn()).toBe('failed');
    expect(h.store.size).toBe(0);
  });

  it('parses callbacks robustly: values may contain "=", a stray % elsewhere never hides the outcome', () => {
    expect(parseCallback('x://cb?code=a%20b&state=s')).toEqual({ kind: 'ok', code: 'a b', state: 's' });
    expect(parseCallback('x://cb?code=ab==&state=s')).toEqual({ kind: 'ok', code: 'ab==', state: 's' });
    expect(parseCallback('x://cb?error=access_denied&error_description=bad%')).toEqual({ kind: 'error', error: 'access_denied' });
    expect(parseCallback('x://cb')).toEqual({ kind: 'invalid' });
    expect(parseCallback('x://cb?state=only')).toEqual({ kind: 'invalid' });
  });

  it('a double tap is ONE sign-in: one browser, and the first one still completes', async () => {
    const h = harness();
    let opens = 0;
    h.browser.next = (url) => {
      opens++;
      return { type: 'success', url: `ai.shamwari.app://callback?code=c&state=${stateOf(url)}` };
    };
    h.respond(() => ok({ exp: NOW_S + 300, sid: 's' }, 'rt1'));
    const [a, b] = await Promise.all([h.s.signIn(), h.s.signIn()]);
    expect([a, b, opens]).toEqual(['signed_in', 'signed_in', 1]);
  });

  it('a locked keystore or a browser fault is a failed sign-in, never a thrown error', async () => {
    const h = harness();
    h.browser.next = () => { throw new Error('browser fault'); };
    await expect(h.s.signIn()).resolves.toBe('failed');
    const store = new Map<string, string>();
    const s = new Session(cfg, {
      fetch: (async () => new Response('{}')) as unknown as typeof fetch,
      secure: { get: async () => null, set: async () => { throw new Error('locked'); }, delete: async () => undefined },
      openAuthSession: async () => ({ type: 'cancel' }), openUrl: async () => undefined,
      randomBytes: (n) => new Uint8Array(randomBytes(n)), sha256, now: () => 0,
    });
    await expect(s.signIn()).resolves.toBe('failed');
    expect(store.size).toBe(0);
  });

  it('with no client id configured, sign-in fails closed without opening anything', async () => {
    let opened = 0;
    const s = new Session({ ...cfg, clientId: '' }, {
      fetch: (async () => new Response('{}')) as unknown as typeof fetch,
      secure: { get: async () => null, set: async () => undefined, delete: async () => undefined },
      openAuthSession: async () => { opened++; return { type: 'cancel' }; }, openUrl: async () => undefined,
      randomBytes: (n) => new Uint8Array(randomBytes(n)), sha256, now: () => 0,
    });
    expect(await s.signIn()).toBe('failed');
    expect(opened).toBe(0);
  });
});

describe('refresh', () => {
  async function signedIn(exp = NOW_S + 300) {
    const h = harness();
    completes(h);
    h.respond(() => ok({ exp, sid: 'sess_1' }, 'rt1'));
    await h.s.signIn();
    h.calls.length = 0;
    return h;
  }

  it('uses the in-memory token while it has time left, and does not call WorkOS', async () => {
    const h = await signedIn();
    h.setNow((NOW_S + 100) * 1000);
    await h.s.getAccessToken();
    expect(h.calls).toHaveLength(0);
  });

  it('renews near expiry with the refresh token and no secret, and saves the ROTATED refresh token', async () => {
    const h = await signedIn();
    h.setNow((NOW_S + 280) * 1000); // inside the 60 s window
    h.respond(() => ok({ exp: NOW_S + 580, sid: 'sess_1' }, 'rt2'));
    const t = await h.s.getAccessToken();
    expect(readClaims(t!).exp).toBe(NOW_S + 580);
    expect(h.calls[0].body).toEqual({ client_id: 'client_test', grant_type: 'refresh_token', refresh_token: 'rt1' });
    expect(h.store.get('shamwari.rt')).toBe('rt2'); // the old one is spent
  });

  it('renews ONCE for any number of concurrent callers (a refresh token is single-use)', async () => {
    const h = await signedIn();
    h.setNow((NOW_S + 290) * 1000);
    h.respond(() => ok({ exp: NOW_S + 590, sid: 'sess_1' }, 'rt2'));
    const got = await Promise.all([h.s.getAccessToken(), h.s.getAccessToken(), h.s.getAccessToken(), h.s.renewAfterRejection()]);
    expect(h.calls).toHaveLength(1);
    expect(new Set(got.slice(0, 3)).size).toBe(1);
  });

  it('a terminal refusal signs the person out and wipes the keystore', async () => {
    const h = await signedIn();
    h.setNow((NOW_S + 290) * 1000);
    h.respond(() => new Response('{"error":"invalid_grant"}', { status: 401 }));
    expect(await h.s.getAccessToken()).toBeNull();
    expect(await h.s.isSignedIn()).toBe(false);
    expect(h.store.size).toBe(0);
  });

  it('an outage is NOT a sign-out: the session survives 503s and network failures', async () => {
    const h = await signedIn();
    h.setNow((NOW_S + 400) * 1000); // truly expired
    h.respond(() => new Response('', { status: 503 }));
    await expect(h.s.getAccessToken()).rejects.toBeInstanceOf(SessionUnavailable);
    h.respond(() => { throw new Error('network'); });
    await expect(h.s.getAccessToken()).rejects.toBeInstanceOf(SessionUnavailable);
    h.respond(() => new Response('{}', { status: 429 }));
    await expect(h.s.getAccessToken()).rejects.toBeInstanceOf(SessionUnavailable);
    expect(h.store.get('shamwari.rt')).toBe('rt1');
    // and it recovers
    h.respond(() => ok({ exp: NOW_S + 700, sid: 'sess_1' }, 'rt2'));
    expect(await h.s.getAccessToken()).not.toBeNull();
  });

  it('during an outage a token still inside its real lifetime is used rather than failing the request', async () => {
    const h = await signedIn();
    h.setNow((NOW_S + 290) * 1000); // due for renewal but not yet expired
    h.respond(() => new Response('', { status: 503 }));
    expect(await h.s.getAccessToken()).not.toBeNull();
  });

  it('never assumes a token without a readable exp lasts', async () => {
    const h = harness();
    completes(h);
    h.respond(() => new Response(JSON.stringify({ access_token: 'opaque', refresh_token: 'rt1' })));
    await h.s.signIn();
    h.calls.length = 0;
    h.respond(() => new Response(JSON.stringify({ access_token: 'opaque2', refresh_token: 'rt2' })));
    await h.s.getAccessToken();
    expect(h.calls).toHaveLength(1);
  });
});

describe('sign-out during sign-in', () => {
  it('a sign-in that completes after the person signed out is superseded: no tokens are written', async () => {
    const h = harness();
    let release!: () => void;
    const open = new Promise<void>((r) => (release = r));
    h.browser.next = async (url) => {
      await open;
      return { type: 'success', url: `ai.shamwari.app://callback?code=c&state=${stateOf(url)}` };
    };
    h.respond(() => ok({ exp: NOW_S + 300, sid: 'sess_x' }, 'rt_x'));
    const signing = h.s.signIn();
    await new Promise((r) => setTimeout(r, 0));
    await h.s.signOut();
    release();
    expect(await signing).toBe('cancelled');
    expect(h.store.has('shamwari.rt')).toBe(false);
    expect(await h.s.isSignedIn()).toBe(false);
    expect(await h.s.getAccessToken()).toBeNull();
  });
});

describe('refresh races and classification', () => {
  async function signedIn() {
    const h = harness();
    completes(h);
    h.respond(() => ok({ exp: NOW_S + 300, sid: 'sess_1' }, 'rt1'));
    await h.s.signIn();
    h.calls.length = 0;
    return h;
  }
  /** Wait until WorkOS has actually been called, so the request is genuinely in flight. */
  const inFlight = async (h: Harness) => {
    for (let i = 0; i < 50 && h.calls.length === 0; i++) await new Promise((r) => setTimeout(r, 0));
    expect(h.calls.length).toBeGreaterThan(0);
  };
  const gate = () => {
    let release!: () => void;
    const p = new Promise<void>((r) => (release = r));
    return { p, release };
  };

  it('a refresh that finishes AFTER sign-out cannot sign the person back in', async () => {
    const h = await signedIn();
    h.setNow((NOW_S + 290) * 1000);
    const g = gate();
    h.respond(async () => { await g.p; return ok({ exp: NOW_S + 600, sid: 'sess_1' }, 'rt2'); });
    const pending = h.s.getAccessToken(); // refresh now in flight
    await inFlight(h);
    await h.s.signOut();
    g.release();
    expect(await pending).toBeNull();
    expect(h.store.size).toBe(0); // nothing resurrected in the keystore
    expect(await h.s.isSignedIn()).toBe(false);
    expect(await h.s.getAccessToken()).toBeNull();
  });

  it('a stale refresh cannot overwrite or delete a newer sign-in', async () => {
    const h = await signedIn();
    h.setNow((NOW_S + 290) * 1000);
    const g = gate();
    h.respond(async () => { await g.p; return new Response('{"error":"invalid_grant"}', { status: 400 }); });
    const pending = h.s.getAccessToken();
    await inFlight(h);
    completes(h);
    h.respond(() => ok({ exp: NOW_S + 900, sid: 'sess_2' }, 'rt_new'));
    expect(await h.s.signIn()).toBe('signed_in');
    g.release();
    await pending;
    expect(h.store.get('shamwari.rt')).toBe('rt_new'); // the late invalid_grant did not delete the new session
    expect(await h.s.isSignedIn()).toBe(true);
  });

  it('only invalid_grant deletes the credential; a 401 for any other reason keeps it and asks for a new sign-in', async () => {
    const h = await signedIn();
    h.setNow((NOW_S + 400) * 1000);
    h.respond(() => new Response('{"error":"invalid_client"}', { status: 401 }));
    expect(await h.s.getAccessToken()).toBeNull();
    expect(h.store.get('shamwari.rt')).toBe('rt1'); // a wrong client id must not wipe everyone's session
    expect(await h.s.isSignedIn()).toBe(false); // but the screen asks them to sign in
    completes(h);
    h.respond(() => ok({ exp: NOW_S + 1200, sid: 'sess_3' }, 'rt3'));
    expect(await h.s.signIn()).toBe('signed_in');
    expect(await h.s.isSignedIn()).toBe(true);
  });

  it('a 400 invalid_grant is terminal', async () => {
    const h = await signedIn();
    h.setNow((NOW_S + 400) * 1000);
    h.respond(() => new Response('{"error":"invalid_grant"}', { status: 400 }));
    expect(await h.s.getAccessToken()).toBeNull();
    expect(h.store.size).toBe(0);
  });
});

describe('sign-out', () => {
  it('clears local state first and opens the WorkOS logout URL for the session', async () => {
    const h = harness();
    completes(h);
    h.respond(() => ok({ exp: NOW_S + 300, sid: 'sess_9' }, 'rt1'));
    await h.s.signIn();
    await h.s.signOut();
    expect(h.store.size).toBe(0);
    expect(await h.s.getAccessToken()).toBeNull();
    expect(h.opened).toEqual([buildLogoutUrl(cfg, 'sess_9')]);
    const u = new URL(h.opened[0]);
    expect(u.pathname).toBe('/user_management/sessions/logout');
    expect([u.searchParams.get('session_id'), u.searchParams.get('return_to')]).toEqual(['sess_9', cfg.logoutReturnTo]);
  });

  it('still signs out locally when the logout page cannot be opened', async () => {
    const store = new Map<string, string>([['shamwari.rt', 'rt1']]);
    const s = new Session(cfg, {
      fetch: (async () => ok({ exp: NOW_S + 300, sid: 'sess_1' }, 'rt2')) as unknown as typeof fetch,
      secure: { get: async (k) => store.get(k) ?? null, set: async (k, v) => void store.set(k, v), delete: async (k) => void store.delete(k) },
      openAuthSession: async () => ({ type: 'cancel' }),
      openUrl: async () => { throw new Error('no browser'); },
      randomBytes: (n) => new Uint8Array(randomBytes(n)),
      sha256,
      now: () => NOW_S * 1000,
    });
    await expect(s.signOut()).resolves.toBeUndefined();
    expect(store.size).toBe(0);
  });
  it('after an app restart (only the refresh token remains) it renews once to learn the session id', async () => {
    const h = harness();
    h.store.set('shamwari.rt', 'rt_old');
    h.respond(() => ok({ exp: NOW_S + 300, sid: 'sess_7' }, 'rt_new'));
    await h.s.signOut();
    expect(h.opened).toEqual([buildLogoutUrl(cfg, 'sess_7')]);
    expect(h.store.size).toBe(0);
  });
});

describe('the gateway client with a renewable credential', () => {
  const answer = { id: 'r', choices: [{ message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }], shamwari: { scope: 'platform', citations: [] } };
  const mk = (statuses: number[], tokens: string[], renew: () => Promise<boolean>) => {
    const sent: string[] = [];
    let i = 0;
    const c = createClient({
      baseUrl: 'https://x.test',
      getKey: async () => tokens[Math.min(i, tokens.length - 1)],
      onUnauthorized: async () => { const r = await renew(); if (r) i++; return r; },
      fetch: (async (_u: unknown, init: { headers: Record<string, string> }) => {
        sent.push(init.headers.Authorization);
        const st = statuses.shift() ?? 200;
        return new Response(JSON.stringify(st === 200 ? answer : { error: 'x' }), { status: st });
      }) as unknown as typeof fetch,
    });
    return { c, sent };
  };
  const q = { messages: [{ role: 'user' as const, content: 'q' }] };

  it('retries once with the renewed token after a 401', async () => {
    const { c, sent } = mk([401, 200], ['old', 'new'], async () => true);
    expect((await c.ask(q)).ok).toBe(true);
    expect(sent).toEqual(['Bearer old', 'Bearer new']);
  });
  it('never loops: a second 401 is returned, not retried again', async () => {
    const { c, sent } = mk([401, 401, 200], ['old', 'new'], async () => true);
    const r = await c.ask(q);
    expect(!r.ok && r.error.kind).toBe('unauthorized');
    expect(sent).toHaveLength(2);
  });
  it('does not retry when renewal fails or yields the same token', async () => {
    const a = mk([401, 200], ['old'], async () => false);
    expect((await a.c.ask(q)).ok).toBe(false);
    expect(a.sent).toHaveLength(1);
    const b = mk([401, 200], ['same', 'same'], async () => true);
    expect((await b.c.ask(q)).ok).toBe(false);
    expect(b.sent).toHaveLength(1);
  });
  it('a credential lookup that throws is "offline" (retryable), never "unauthorized", and sends nothing', async () => {
    let sent = 0;
    const c = createClient({ baseUrl: 'https://x.test', getKey: async () => { throw new Error('x'); }, fetch: (async () => { sent++; return new Response('{}'); }) as unknown as typeof fetch });
    const r = await c.ask(q);
    expect(!r.ok && r.error.kind).toBe('offline');
    expect(sent).toBe(0);
  });
});

describe('what the app must never contain', () => {
  const files = ['src/auth', 'src/lib'].flatMap((d) => readdirSync(d).map((f: string) => `${d}/${f}`));
  it('no client secret and no logging in the auth path', () => {
    for (const f of files.filter((f: string) => f.endsWith('.ts'))) {
      const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(src, f).not.toMatch(/client_secret|sk_[a-z]+_|API_KEY/i);
      expect(src, f).not.toMatch(/console\.(log|info|warn|error|debug)/);
    }
  });
});
