import { describe, expect, it } from 'vitest';
import type { CheckResult } from '../../worker/session';
import {
  AUTH_CALLBACK,
  AUTH_LOGIN,
  AUTH_LOGOUT,
  AUTH_ROUTES,
  AUTH_TOKEN,
  COOKIE_PATH,
  LEGACY_COOKIE_PATH,
  LEGACY_ROUTES,
  MAX_COOKIE_VALUE,
  SESSION_COOKIE,
  STATE_COOKIE,
  handle,
  jwtClaims,
  jwtExp,
  legacyRedirect,
} from '../../worker/session';
import { NOW, b64, deps, fakePort, jwt, req, setCookies } from './helpers';

const secs = NOW / 1000;
const live = jwt({ exp: secs + 300, sid: 's1' });
const aboutToLapse = jwt({ exp: secs + 20, sid: 's1' });

describe('login and callback', () => {
  it('starts sign-in with a one-time state cookie, HttpOnly, Secure, SameSite=Lax', async () => {
    const res = await handle(req('/auth/login'), deps(fakePort()));
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('https://auth.example/authorize?state=STATE123');
    const c = setCookies(res)[0]!;
    expect(c).toContain(`${STATE_COOKIE}=STATE123`);
    for (const a of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', 'Max-Age=600']) expect(c).toContain(a);
    expect(c).not.toContain('Domain');
  });

  it('has no return parameter: nothing in the request decides where a person lands', async () => {
    const res = await handle(req('/auth/login?return=https://evil.example'), deps(fakePort()));
    expect(res.headers.get('Location')).not.toContain('evil');
    const cb = fakePort();
    const ok = await handle(
      req('/callback?code=c1&state=STATE123&return=https://evil.example', {
        cookie: `${STATE_COOKIE}=STATE123`,
      }),
      deps(cb),
    );
    expect(ok.headers.get('Location')).toBe('/');
  });

  it('on a good callback: exchanges the code, sets the session cookie, spends the state, lands on / (the root then picks the app)', async () => {
    const port = fakePort();
    const res = await handle(
      req('/callback?code=c1&state=STATE123', {
        cookie: `${STATE_COOKIE}=STATE123`,
      }),
      deps(port),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/');
    const cookies = setCookies(res);
    expect(cookies.find((c) => c.startsWith(`${STATE_COOKIE}=;`))).toContain('Max-Age=0');
    const s = cookies.find((c) => c.startsWith(`${SESSION_COOKIE}=SEALED-NEW`))!;
    for (const a of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/']) expect(s).toContain(a);
    expect(port.calls).toEqual(['exchange:c1']);
  });

  it.each([
    ['a missing state cookie', '/callback?code=c1&state=STATE123', undefined],
    ['a different state', '/callback?code=c1&state=OTHER', `${STATE_COOKIE}=STATE123`],
    ['no state in the URL', '/callback?code=c1', `${STATE_COOKIE}=STATE123`],
    ['an error from AuthKit', '/callback?error=access_denied&state=STATE123', `${STATE_COOKIE}=STATE123`],
    ['no code', '/callback?state=STATE123', `${STATE_COOKIE}=STATE123`],
  ])('refuses %s without calling WorkOS or setting a session', async (_n, path, cookie) => {
    const port = fakePort();
    const res = await handle(req(path, { cookie }), deps(port));
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/lite/?signin=failed');
    expect(port.calls).toEqual([]);
    expect(setCookies(res).some((c) => c.startsWith(`${SESSION_COOKIE}=S`))).toBe(false);
    expect(setCookies(res).some((c) => c.startsWith(`${STATE_COOKIE}=;`))).toBe(true);
  });

  it('a refused code sets no session', async () => {
    const port = fakePort();
    port.codeResult = null;
    const res = await handle(
      req('/callback?code=bad&state=STATE123', {
        cookie: `${STATE_COOKIE}=STATE123`,
      }),
      deps(port),
    );
    expect(res.headers.get('Location')).toBe('/lite/?signin=failed');
    expect(setCookies(res).some((c) => c.startsWith(`${SESSION_COOKIE}=S`))).toBe(false);
  });

  it('login and callback are GET only', async () => {
    for (const p of ['/auth/login', '/callback']) {
      expect((await handle(req(p, { method: 'POST' }), deps(fakePort()))).status).toBe(405);
    }
  });
});

describe('cookie scope', () => {
  it('the session is one cookie for the whole origin (Path=/), so /lite/ and /chat/ share it; the old /lite/ copy is expired alongside', async () => {
    const port = fakePort();
    const callback = await handle(
      req('/callback?code=c1&state=STATE123', { cookie: `${STATE_COOKIE}=STATE123` }),
      deps(port),
    );
    const sessions = setCookies(callback).filter((c) => c.startsWith(`${SESSION_COOKIE}=`));
    expect(sessions).toHaveLength(2);
    expect(sessions[0]).toContain('SEALED-NEW');
    expect(sessions[0]).toContain(`Path=${COOKIE_PATH};`);
    expect(COOKIE_PATH).toBe('/');
    expect(sessions[1]).toContain(`${SESSION_COOKIE}=;`);
    expect(sessions[1]).toContain(`Path=${LEGACY_COOKIE_PATH};`);
    expect(sessions[1]).toContain('Max-Age=0');
  });

  it('every cookie is HttpOnly, Secure, SameSite=Lax, __Secure- prefixed and has no Domain; the state cookie is only sent to the callback', async () => {
    const port = fakePort();
    const login = await handle(req('/auth/login'), deps(port));
    const callback = await handle(
      req('/callback?code=c1&state=STATE123', { cookie: `${STATE_COOKIE}=STATE123` }),
      deps(port),
    );
    const out = await handle(req('/auth/logout', { method: 'POST', cookie: `${SESSION_COOKIE}=S` }), deps(port));
    const all = [...setCookies(login), ...setCookies(callback), ...setCookies(out)];
    expect(all.length).toBeGreaterThanOrEqual(7);
    for (const c of all) {
      for (const a of ['HttpOnly', 'Secure', 'SameSite=Lax']) expect(c).toContain(a);
      expect(c).not.toContain('Domain');
      expect(c.startsWith('__Secure-')).toBe(true);
    }
    expect(setCookies(login)[0]).toContain('Path=/callback;');
  });

  it('sign-out clears the session cookie in both places (root and the old /lite/ one)', async () => {
    const out = await handle(req('/auth/logout', { method: 'POST', cookie: `${SESSION_COOKIE}=S` }), deps(fakePort()));
    const cleared = setCookies(out).filter((c) => c.startsWith(`${SESSION_COOKIE}=;`));
    expect(cleared.some((c) => c.includes('Path=/;'))).toBe(true);
    expect(cleared.some((c) => c.includes('Path=/lite/;'))).toBe(true);
    for (const c of cleared) expect(c).toContain('Max-Age=0');
  });

  it('a renewal also expires the old /lite/ copy, so a device never holds a spent one next to the new one', async () => {
    const port = fakePort();
    port.checkResult = { status: 'expired', sid: 's1' };
    const res = await handle(
      req('/auth/token', { cookie: `${SESSION_COOKIE}=SEALED` }),
      deps(port, async () => ({ status: 'ok', sealed: 'SEALED2', accessToken: jwt({ exp: secs + 300 }) })),
    );
    expect(res.status).toBe(200);
    const cs = setCookies(res);
    expect(cs.find((c) => c.startsWith(`${SESSION_COOKIE}=SEALED2`))).toContain('Path=/;');
    expect(cs.find((c) => c.startsWith(`${SESSION_COOKIE}=;`))).toContain('Path=/lite/;');
  });
});

describe('a device holding both an old /lite/ session cookie and a new one', () => {
  it('the token route uses the first copy that is not invalid, so a spent old copy never signs out a good new one', async () => {
    const port = fakePort();
    const results: Record<string, CheckResult> = {
      OLD: { status: 'invalid' },
      NEW: { status: 'valid', accessToken: live, sid: 's1' },
    };
    port.check = async (sealed: string) => results[sealed]!;
    const res = await handle(req('/auth/token', { cookie: `${SESSION_COOKIE}=OLD; ${SESSION_COOKIE}=NEW` }), deps(port));
    expect(res.status).toBe(200);
    // And when every copy is invalid the session really is over, and both places are cleared.
    results.NEW = { status: 'invalid' };
    const gone = await handle(req('/auth/token', { cookie: `${SESSION_COOKIE}=OLD; ${SESSION_COOKIE}=NEW` }), deps(port));
    expect(gone.status).toBe(401);
    expect(setCookies(gone).some((c) => c.includes('Path=/lite/;'))).toBe(true);
  });
});

describe('the sign-in routes are at the root, never under /lite/', () => {
  it('AUTH_ROUTES are /auth/login, /callback, /auth/token and /auth/logout, and none starts with /lite/', () => {
    expect([...AUTH_ROUTES].sort()).toEqual([AUTH_CALLBACK, AUTH_LOGIN, AUTH_LOGOUT, AUTH_TOKEN].sort());
    expect(AUTH_LOGIN).toBe('/auth/login');
    expect(AUTH_CALLBACK).toBe('/callback');
    for (const r of AUTH_ROUTES) expect(r.startsWith('/lite/'), r).toBe(false);
  });

  it('the handler answers the root routes, and the session cookie it sets is not under /lite/', async () => {
    for (const [path, method] of [[AUTH_LOGIN, 'GET'], [AUTH_TOKEN, 'GET'], [AUTH_LOGOUT, 'POST']] as const) {
      const res = await handle(req(path, { method, cookie: `${SESSION_COOKIE}=S` }), deps(fakePort()));
      expect(res.status, path).not.toBe(404);
    }
  });
});

describe('the old /lite/ addresses live on for one release', () => {
  const at = (path: string, init: RequestInit = {}) => new Request(`https://shamwari.ai${path}`, init);

  it('/lite/auth/login and /lite/callback redirect to the root routes, keeping the query', () => {
    const login = legacyRedirect(at('/lite/auth/login'))!;
    expect(login.status).toBe(302);
    expect(login.headers.get('Location')).toBe('/auth/login');
    const cb = legacyRedirect(at('/lite/callback?code=c1&state=S'))!;
    expect(cb.status).toBe(302);
    expect(cb.headers.get('Location')).toBe('/callback?code=c1&state=S');
  });

  it('a non-GET to the old login or callback is refused (405), not turned into a GET', () => {
    for (const path of ['/lite/auth/login', '/lite/callback?code=c&state=s']) {
      const res = legacyRedirect(at(path, { method: 'POST' }))!;
      expect(res.status, path).toBe(405);
      expect(res.headers.get('Location'), path).toBeNull();
    }
  });

  it('/lite/auth/logout is a 307, so a POST stays a POST', () => {
    const out = legacyRedirect(at('/lite/auth/logout', { method: 'POST' }))!;
    expect(out.status).toBe(307);
    expect(out.headers.get('Location')).toBe('/auth/logout');
  });

  it('the redirects are never cached, and nothing else is redirected', () => {
    expect(legacyRedirect(at('/lite/auth/login'))!.headers.get('Cache-Control')).toBe('no-store');
    for (const p of ['/auth/login', '/callback', '/lite/', '/lite/auth/other']) expect(legacyRedirect(at(p)), p).toBeNull();
    expect(LEGACY_ROUTES).toContain('/lite/auth/token');
  });

  it('/lite/auth/token is answered in place, exactly like /auth/token', async () => {
    const port = fakePort();
    port.checkResult = { status: 'valid', accessToken: live, sid: 's1' };
    const a = await handle(req('/lite/auth/token', { cookie: `${SESSION_COOKIE}=S` }), deps(port));
    const b = await handle(req('/auth/token', { cookie: `${SESSION_COOKIE}=S` }), deps(port));
    expect(a.status).toBe(200);
    expect(await a.json()).toEqual(await b.json());
  });
});

describe('token', () => {
  const withCookie = (extra: { site?: string } = {}) =>
    req('/auth/token', { cookie: `${SESSION_COOKIE}=SEALED`, ...extra });

  it('401 and no WorkOS call when there is no cookie', async () => {
    const port = fakePort();
    const res = await handle(req('/auth/token'), deps(port));
    expect(res.status).toBe(401);
    expect(port.calls).toEqual([]);
  });

  it('returns a still-valid token as is, no-store, with epoch-second expiry', async () => {
    const port = fakePort();
    port.checkResult = { status: 'valid', accessToken: live, sid: 's1' };
    let refreshed = 0;
    const res = await handle(
      withCookie(),
      deps(port, async () => (refreshed++, { status: 'denied' })),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      access_token: live,
      expires_at: secs + 300,
    });
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Vary')).toBe('Cookie');
    expect(refreshed).toBe(0);
  });

  it('refreshes a token that is about to lapse, and sets the new cookie', async () => {
    const port = fakePort();
    port.checkResult = {
      status: 'valid',
      accessToken: aboutToLapse,
      sid: 's1',
    };
    const fresh = jwt({ exp: secs + 300, sid: 's1' });
    const seen: string[] = [];
    const res = await handle(
      withCookie(),
      deps(
        port,
        async (sid, sealed) => (seen.push(`${sid}:${sealed}`), { status: 'ok', sealed: 'SEALED2', accessToken: fresh }),
      ),
    );
    expect(seen).toEqual(['s1:SEALED']);
    expect((await res.json()) as { access_token: string }).toMatchObject({
      access_token: fresh,
    });
    expect(setCookies(res)[0]).toContain(`${SESSION_COOKIE}=SEALED2`);
  });

  it('refreshes a token issued more than half an hour ago even with hours left on it (the gateway refuses tokens over an hour old)', async () => {
    const port = fakePort();
    const old = jwt({ iat: secs - 31 * 60, exp: secs + 4 * 3600, sid: 's1' });
    port.checkResult = { status: 'valid', accessToken: old, sid: 's1' };
    const fresh = jwt({ iat: secs, exp: secs + 5 * 3600, sid: 's1' });
    let refreshed = 0;
    const res = await handle(
      withCookie(),
      deps(port, async () => (refreshed++, { status: 'ok', sealed: 'SEALED2', accessToken: fresh })),
    );
    expect(refreshed).toBe(1);
    expect(await res.json()).toEqual({ access_token: fresh, expires_at: secs + 5 * 3600 });

    // A token issued ten minutes ago with hours left is still handed out as it is.
    const young = jwt({ iat: secs - 600, exp: secs + 4 * 3600, sid: 's1' });
    port.checkResult = { status: 'valid', accessToken: young, sid: 's1' };
    const again = await handle(withCookie(), deps(port, async () => (refreshed++, { status: 'denied' })));
    expect(refreshed).toBe(1);
    expect(((await again.json()) as { access_token: string }).access_token).toBe(young);
  });

  it('refreshes an expired token, keyed by the session id', async () => {
    const port = fakePort();
    port.checkResult = { status: 'expired', sid: 'sess-9' };
    const fresh = jwt({ exp: secs + 300, sid: 'sess-9' });
    const seen: string[] = [];
    const res = await handle(
      withCookie(),
      deps(port, async (sid) => (seen.push(sid), { status: 'ok', sealed: 'S3', accessToken: fresh })),
    );
    expect(res.status).toBe(200);
    expect(seen).toEqual(['sess-9']);
  });

  it('a terminal refusal ends the session: 401 and the cookie is cleared', async () => {
    const port = fakePort();
    port.checkResult = { status: 'expired', sid: 's1' };
    const res = await handle(
      withCookie(),
      deps(port, async () => ({ status: 'denied' })),
    );
    expect(res.status).toBe(401);
    expect(setCookies(res)[0]).toMatch(new RegExp(`^${SESSION_COOKIE}=;.*Max-Age=0`));
  });

  it('an unreadable cookie is not a session: 401 and cleared', async () => {
    const port = fakePort();
    port.checkResult = { status: 'invalid' };
    const res = await handle(withCookie(), deps(port));
    expect(res.status).toBe(401);
    expect(setCookies(res)[0]).toContain('Max-Age=0');
  });

  it('a WorkOS outage is 503 with Retry-After, NOT a 401, and the cookie is left alone', async () => {
    const port = fakePort();
    port.checkResult = { status: 'expired', sid: 's1' };
    const res = await handle(
      withCookie(),
      deps(port, async () => ({ status: 'retry', retryAfter: 7 })),
    );
    expect(res.status).toBe(503);
    expect(res.headers.get('Retry-After')).toBe('7');
    expect(setCookies(res)).toEqual([]);
  });

  it('clamps an absurd Retry-After', async () => {
    const port = fakePort();
    port.checkResult = { status: 'expired', sid: 's1' };
    const res = await handle(
      withCookie(),
      deps(port, async () => ({ status: 'retry', retryAfter: 99999 })),
    );
    expect(res.headers.get('Retry-After')).toBe('120');
  });

  it('a refreshed token with no readable expiry is not handed out, but the NEW cookie is kept (the old token is spent)', async () => {
    const port = fakePort();
    port.checkResult = { status: 'expired', sid: 's1' };
    const res = await handle(
      withCookie(),
      deps(port, async () => ({
        status: 'ok',
        sealed: 'S-NEW',
        accessToken: 'not-a-jwt',
      })),
    );
    expect(res.status).toBe(503);
    expect(res.headers.get('Retry-After')).toBe('1');
    expect(await res.text()).not.toContain('not-a-jwt');
    expect(setCookies(res)[0]).toContain(`${SESSION_COOKIE}=S-NEW`);
  });

  it('an unexpected fault while checking the cookie is a 503 and never a sign-out', async () => {
    const port = fakePort();
    port.checkResult = { status: 'unavailable' };
    const res = await handle(withCookie(), deps(port));
    expect(res.status).toBe(503);
    expect(res.headers.get('Retry-After')).toBe('5');
    expect(setCookies(res)).toEqual([]);
  });

  it('a sealed session too big for a cookie fails visibly instead of being dropped by the browser', async () => {
    const big = 'x'.repeat(MAX_COOKIE_VALUE + 1);
    // Sign-in: back to the app with a reason, and no session cookie.
    const port = fakePort();
    port.codeResult = { sealed: big };
    const cb = await handle(
      req('/callback?code=c1&state=STATE123', { cookie: `${STATE_COOKIE}=STATE123` }),
      deps(port),
    );
    expect(cb.headers.get('Location')).toBe('/lite/?signin=failed');
    expect(setCookies(cb).some((c) => c.startsWith(`${SESSION_COOKIE}=x`))).toBe(false);
    // Renewal: the session ends honestly (401 + cleared) rather than looping on a cookie that never lands.
    const p2 = fakePort();
    p2.checkResult = { status: 'expired', sid: 's1' };
    const r = await handle(
      withCookie(),
      deps(p2, async () => ({ status: 'ok', sealed: big, accessToken: jwt({ exp: secs + 300 }) })),
    );
    expect(r.status).toBe(401);
    expect(setCookies(r)[0]).toContain('Max-Age=0');
    // A cookie right at the limit is still fine.
    const p3 = fakePort();
    p3.codeResult = { sealed: 'y'.repeat(MAX_COOKIE_VALUE) };
    const ok = await handle(
      req('/callback?code=c1&state=STATE123', { cookie: `${STATE_COOKIE}=STATE123` }),
      deps(p3),
    );
    expect(ok.headers.get('Location')).toBe('/');
  });

  it('refuses a request the browser says is cross-site, before reading the cookie', async () => {
    const port = fakePort();
    const res = await handle(withCookie({ site: 'cross-site' }), deps(port));
    expect(res.status).toBe(403);
    expect(port.calls).toEqual([]);
  });

  it('accepts same-origin and a direct navigation', async () => {
    for (const site of ['same-origin', 'none']) {
      const port = fakePort();
      port.checkResult = { status: 'valid', accessToken: live, sid: 's1' };
      expect((await handle(withCookie({ site }), deps(port))).status).toBe(200);
    }
  });

  it('is GET only', async () => {
    const res = await handle(
      req('/auth/token', {
        method: 'POST',
        cookie: `${SESSION_COOKIE}=S`,
      }),
      deps(fakePort()),
    );
    expect(res.status).toBe(405);
  });

  it('never puts the token in a URL, a cookie we set on a plain read, or a cacheable response', async () => {
    const port = fakePort();
    port.checkResult = { status: 'valid', accessToken: live, sid: 's1' };
    const res = await handle(withCookie(), deps(port));
    expect(setCookies(res)).toEqual([]);
    expect(res.headers.get('Location')).toBeNull();
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });
});

describe('logout', () => {
  it('clears both cookies, answers 204, and revokes in the background', async () => {
    const port = fakePort();
    const d = deps(port);
    const res = await handle(
      req('/auth/logout', {
        method: 'POST',
        cookie: `${SESSION_COOKIE}=SEALED`,
      }),
      d,
    );
    expect(res.status).toBe(204);
    expect(setCookies(res).every((c) => c.includes('Max-Age=0'))).toBe(true);
    // The session and the state cookie, each at the root and at the old /lite/ path.
    expect(setCookies(res)).toHaveLength(4);
    await Promise.all(d.waited);
    expect(port.calls).toEqual(['revoke:SEALED']);
  });

  it('still signs out when revocation fails, and when there was no session', async () => {
    const port = fakePort();
    port.revokeFails = true;
    const d = deps(port);
    expect(
      (
        await handle(
          req('/auth/logout', {
            method: 'POST',
            cookie: `${SESSION_COOKIE}=S`,
          }),
          d,
        )
      ).status,
    ).toBe(204);
    await Promise.all(d.waited); // must not reject
    expect((await handle(req('/auth/logout', { method: 'POST' }), deps(fakePort()))).status).toBe(204);
  });

  it('refuses a cross-site POST and a GET', async () => {
    const port = fakePort();
    expect(
      (
        await handle(
          req('/auth/logout', {
            method: 'POST',
            site: 'cross-site',
            cookie: `${SESSION_COOKIE}=S`,
          }),
          deps(port),
        )
      ).status,
    ).toBe(403);
    expect((await handle(req('/auth/logout'), deps(port))).status).toBe(405);
    expect(port.calls).toEqual([]);
  });
});

describe('other', () => {
  it('answers 404 to anything else', async () => {
    expect((await handle(req('/auth/other'), deps(fakePort()))).status).toBe(404);
  });
  it('jwtClaims reads the payload and nothing else', () => {
    expect(jwtClaims(jwt({ sid: 's', exp: 5 }))).toEqual({ sid: 's', exp: 5 });
    expect(jwtClaims('garbage')).toBeNull();
    // A JSON array is not a set of claims.
    expect(jwtClaims(`${b64({})}.${Buffer.from('[1]').toString('base64url')}.x`)).toBeNull();
  });
  it('jwtExp reads exp and nothing else', () => {
    expect(jwtExp(jwt({ exp: 5 }))).toBe(5);
    expect(jwtExp('garbage')).toBeNull();
    expect(jwtExp(jwt({ exp: 'x' }))).toBeNull();
  });
});
