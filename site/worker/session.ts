/**
 * The session Worker's request handler: sign-in for Shamwari Chat.
 *
 * It holds what the page must never hold. The WorkOS refresh token lives only
 * inside a sealed, HttpOnly cookie (encrypted by the WorkOS SDK with a key only
 * this Worker has); the page receives the short-lived ACCESS token and nothing
 * else. There is no custom PKCE, token-refresh or sealing code here: that is the
 * WorkOS SDK, behind the `AuthKitPort` below (workos-port.ts). This file is the
 * HTTP shape and the rules, and is tested against a fake port.
 *
 * Routes. They are at the ROOT of the origin, not under /lite/, so the light chat (/lite/) and the main chat (/chat/)
 * share one sign-in and one session cookie (Path=/). test/worker/session.test.ts and root.test.ts fail if one moves
 * back under /lite/.
 *   GET  /auth/login    start sign-in; sets a one-time state cookie, 302 to AuthKit
 *   GET  /callback      AuthKit returns here; checks state, sets the session cookie, 302 /
 *   GET  /auth/token    {access_token, expires_at}, no-store; 401 = the session is over
 *   POST /auth/logout   revokes the session, clears the cookies, 204
 * The old /lite/ addresses live on for a release so open tabs and installed PWAs keep working: /lite/auth/login,
 * /lite/callback and /lite/auth/logout redirect to the root routes (legacyRedirect), and /lite/auth/token is answered
 * as /auth/token.
 *
 * Rules, each with a test:
 *  - Nothing the request carries decides where a person lands: the redirect after
 *    sign-in is always / (no `return` parameter, so no open redirect); the root then picks the app.
 *  - The login state is a random one-time value, compared in constant time.
 *  - Only a terminal answer ends a session (401 + cookie cleared). A WorkOS outage
 *    is 503 + Retry-After and the cookie stays, so our outage is not their sign-out.
 *  - The token response is `no-store`, `Vary: Cookie`, and refused to cross-site callers.
 *  - Refreshes for one session are serialised (the refresh token is single-use).
 */

export type CheckResult =
  | { status: 'valid'; accessToken: string; sid: string }
  | { status: 'expired'; sid: string }
  | { status: 'invalid' }
  /** We could not tell (an unexpected fault). Never a sign-out: the cookie is left alone. */
  | { status: 'unavailable' };

export type RefreshResult =
  | { status: 'ok'; sealed: string; accessToken: string }
  | { status: 'denied' }
  | { status: 'retry'; retryAfter?: number };

export interface AuthKitPort {
  authorizationUrl(state: string): string;
  /** null: WorkOS refused the code, or could not be reached. */
  exchangeCode(code: string): Promise<{ sealed: string } | null>;
  /** Unseal the cookie and verify the access token inside it. */
  check(sealed: string): Promise<CheckResult>;
  /** Revoke the WorkOS session. Best effort. */
  revoke(sealed: string): Promise<void>;
}

export interface Deps {
  port: AuthKitPort;
  /** The serialised refresh: one at a time per session id. */
  refresh(sid: string, sealed: string): Promise<RefreshResult>;
  now(): number;
  randomState(): string;
  waitUntil?(p: Promise<unknown>): void;
}

/**
 * One session for the whole origin: the light chat at /lite/ and the main chat at /chat/ share it, so the cookie is
 * Path=/. (`__Secure-` still requires HTTPS; a `__Host-` name would also be possible now that the Path is /, but it would
 * sign everyone out once and the two names would have to be told apart, so the name is kept.) It used to be Path=/lite/:
 * LEGACY_COOKIE_PATH is expired whenever the session cookie is set or cleared, so a device never holds two copies, one
 * of them spent.
 */
export const SESSION_COOKIE = '__Secure-shamwari_session';
export const STATE_COOKIE = '__Secure-shamwari_oauth';
export const COOKIE_PATH = '/';
export const LEGACY_COOKIE_PATH = '/lite/';
/** The one-time state cookie is only ever needed by the callback, so it is only sent there. */
export const STATE_COOKIE_PATH = '/callback';

/** The sign-in routes. None may live under /lite/ (a test walks them). */
export const AUTH_LOGIN = '/auth/login';
export const AUTH_CALLBACK = '/callback';
export const AUTH_TOKEN = '/auth/token';
export const AUTH_LOGOUT = '/auth/logout';
export const AUTH_ROUTES: readonly string[] = [AUTH_LOGIN, AUTH_CALLBACK, AUTH_TOKEN, AUTH_LOGOUT];
/** The old addresses, kept for one release (see the header). */
export const LEGACY_LOGIN = '/lite/auth/login';
export const LEGACY_CALLBACK = '/lite/callback';
export const LEGACY_TOKEN = '/lite/auth/token';
export const LEGACY_LOGOUT = '/lite/auth/logout';
export const LEGACY_ROUTES: readonly string[] = [LEGACY_LOGIN, LEGACY_CALLBACK, LEGACY_TOKEN, LEGACY_LOGOUT];
/**
 * Browsers silently drop a cookie over about 4096 bytes (name and attributes included). A sealed
 * session that large is refused where we can SEE it (sign-in fails visibly; a renewal ends the
 * session honestly) instead of being dropped by the browser with no sign-in and no error.
 */
export const MAX_COOKIE_VALUE = 3800;
/** Renew when the token has less than this left, so the page never holds one about to lapse. */
export const RENEW_BELOW_SECONDS = 60;
/**
 * Renew when the token is older than this, whatever `exp` says. The gateway refuses any token issued more than
 * an hour ago (WORKOS_MAX_TOKEN_AGE_SECONDS, 3600), and the Mukoko Account application's access tokens live for
 * hours, so a token handed out at minute 59 of a five-hour lifetime would be refused at once.
 */
export const RENEW_AFTER_AGE_SECONDS = 30 * 60;
/**
 * How long the browser keeps the cookie. The refresh token's own lifetime is
 * WorkOS's to enforce (a terminal refusal clears the cookie), so this is only
 * an upper bound for an installed app that is opened rarely.
 */
export const SESSION_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;
const STATE_MAX_AGE = 600;

const base = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

function cookieHeader(name: string, value: string, maxAge: number, path: string = COOKIE_PATH): string {
  return `${name}=${value}; Path=${path}; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}
/** The session cookie to set: the root one, and the old /lite/ one expired so only one copy ever exists. */
const sessionCookies = (sealed: string): string[] => [
  cookieHeader(SESSION_COOKIE, sealed, SESSION_COOKIE_MAX_AGE),
  cookieHeader(SESSION_COOKIE, '', 0, LEGACY_COOKIE_PATH),
];
/** Both places the session cookie may be (see LEGACY_COOKIE_PATH). */
export const clearSessionCookies = (): string[] => [
  cookieHeader(SESSION_COOKIE, '', 0),
  cookieHeader(SESSION_COOKIE, '', 0, LEGACY_COOKIE_PATH),
];
const clearStateCookies = (): string[] => [
  cookieHeader(STATE_COOKIE, '', 0, STATE_COOKIE_PATH),
  cookieHeader(STATE_COOKIE, '', 0, LEGACY_COOKIE_PATH),
];

export function readCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.get('Cookie') ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim() || null;
  }
  return null;
}

/** Every value of the named cookie, in the order the browser sent them (a longer Path first). */
export function readCookies(req: Request, name: string): string[] {
  const out: string[] = [];
  for (const part of (req.headers.get('Cookie') ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      const v = part.slice(i + 1).trim();
      if (v) out.push(v);
    }
  }
  return out;
}

/**
 * The session the request really carries. While an old Path=/lite/ copy and a new Path=/ copy could both be on a device
 * (they are expired together, but a lost Set-Cookie would leave both), the browser sends the old one first on /lite/ paths;
 * the first copy that is not plainly invalid wins, so a spent old copy never signs out a good new one.
 * null: no cookie at all. `invalid` comes back only when every copy is invalid.
 */
export async function findSession(port: Pick<AuthKitPort, 'check'>, req: Request): Promise<{ sealed: string; checked: CheckResult } | null> {
  const copies = readCookies(req, SESSION_COOKIE);
  let last: { sealed: string; checked: CheckResult } | null = null;
  for (const sealed of copies) {
    const checked = await port.check(sealed);
    last = { sealed, checked };
    if (checked.status !== 'invalid') return last;
  }
  return last;
}

function eq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** The payload of a JWT that something else has already verified, or null if it is not one. */
export function jwtClaims(token: string): Record<string, unknown> | null {
  try {
    const seg = token.split('.')[1] ?? '';
    const o = JSON.parse(
      atob(
        seg
          .replace(/-/g, '+')
          .replace(/_/g, '/')
          .padEnd(Math.ceil(seg.length / 4) * 4, '='),
      ),
    ) as unknown;
    return o && typeof o === 'object' && !Array.isArray(o) ? (o as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** `exp` (epoch seconds) from a JWT that something else has already verified. */
export function jwtExp(token: string): number | null {
  const exp = jwtClaims(token)?.exp;
  return typeof exp === 'number' && Number.isFinite(exp) ? exp : null;
}

const json = (status: number, body: unknown, extra: Record<string, string | string[]> = {}) => {
  const h = new Headers({ ...base, 'Content-Type': 'application/json' });
  for (const [k, v] of Object.entries(extra)) for (const x of Array.isArray(v) ? v : [v]) h.append(k, x);
  return new Response(JSON.stringify(body), { status, headers: h });
};
const redirect = (to: string, cookies: string[]) => {
  const h = new Headers({ ...base, Location: to });
  for (const c of cookies) h.append('Set-Cookie', c);
  return new Response(null, { status: 302, headers: h });
};

/**
 * The old /lite/ sign-in addresses, answered without touching WorkOS. Login and the callback are redirected with their
 * query (a callback that was started before the move fails once: its state cookie was set for /lite/; signing in again
 * works). Logout is a 307, so a POST stays a POST. /lite/auth/token is not here: it is answered in place as /auth/token.
 */
export function legacyRedirect(req: Request): Response | null {
  const url = new URL(req.url);
  const to = (path: string, status: number) => {
    const h = new Headers({ ...base, Location: `${path}${url.search}` });
    return new Response(null, { status, headers: h });
  };
  // Login and callback are GET routes: any other method is refused here exactly as the new routes refuse it, not turned into a GET.
  const getOnly = (path: string): Response =>
    req.method === 'GET' || req.method === 'HEAD'
      ? to(path, 302)
      : json(405, { error: 'method_not_allowed' }, { Allow: 'GET' });
  if (url.pathname === LEGACY_LOGIN) return getOnly(AUTH_LOGIN);
  if (url.pathname === LEGACY_CALLBACK) return getOnly(AUTH_CALLBACK);
  if (url.pathname === LEGACY_LOGOUT) return to(AUTH_LOGOUT, 307);
  return null;
}

/** A request that browsers say came from another site must not read a token or end a session. */
const crossSite = (req: Request) => req.headers.get('Sec-Fetch-Site') === 'cross-site';

export async function handle(req: Request, deps: Deps): Promise<Response> {
  const url = new URL(req.url);
  // /lite/auth/token is the old address of /auth/token, answered in place (a redirect would cost every old tab a round trip).
  const path = url.pathname === LEGACY_TOKEN ? AUTH_TOKEN : url.pathname;

  if (path === AUTH_LOGIN) {
    if (req.method !== 'GET') return json(405, { error: 'method_not_allowed' }, { Allow: 'GET' });
    const state = deps.randomState();
    return redirect(deps.port.authorizationUrl(state), [cookieHeader(STATE_COOKIE, state, STATE_MAX_AGE, STATE_COOKIE_PATH)]);
  }

  if (path === AUTH_CALLBACK) {
    if (req.method !== 'GET') return json(405, { error: 'method_not_allowed' }, { Allow: 'GET' });
    const expected = readCookie(req, STATE_COOKIE);
    const got = url.searchParams.get('state');
    const code = url.searchParams.get('code');
    // The state cookie is single-use whatever happens next.
    const spent = clearStateCookies();
    if (!expected || !got || !eq(expected, got)) return redirect('/lite/?signin=failed', spent);
    if (url.searchParams.has('error') || !code) return redirect('/lite/?signin=failed', spent);
    const session = await deps.port.exchangeCode(code);
    if (!session || session.sealed.length > MAX_COOKIE_VALUE) return redirect('/lite/?signin=failed', spent);
    return redirect('/', [...spent, ...sessionCookies(session.sealed)]);
  }

  if (path === AUTH_TOKEN) {
    if (req.method !== 'GET') return json(405, { error: 'method_not_allowed' }, { Allow: 'GET' });
    if (crossSite(req)) return json(403, { error: 'cross_site' }, { Vary: 'Cookie' });
    if (!readCookie(req, SESSION_COOKIE)) return json(401, { error: 'signed_out' }, { Vary: 'Cookie' });

    const end = () => json(401, { error: 'signed_out' }, { Vary: 'Cookie', 'Set-Cookie': clearSessionCookies() });
    const found = (await findSession(deps.port, req))!;
    const { sealed, checked } = found;
    if (checked.status === 'invalid') return end();
    const later = (seconds: number) =>
      json(503, { error: 'unavailable' }, { Vary: 'Cookie', 'Retry-After': String(seconds) });
    if (checked.status === 'unavailable') return later(5);

    if (checked.status === 'valid') {
      const exp = jwtExp(checked.accessToken);
      const iat = jwtClaims(checked.accessToken)?.iat;
      const young = typeof iat !== 'number' || deps.now() / 1000 - iat < RENEW_AFTER_AGE_SECONDS;
      if (exp !== null && young && exp - deps.now() / 1000 > RENEW_BELOW_SECONDS) {
        return json(200, { access_token: checked.accessToken, expires_at: exp }, { Vary: 'Cookie' });
      }
    }
    const r = await deps.refresh(checked.sid, sealed);
    if (r.status === 'denied') return end();
    if (r.status === 'retry') {
      return json(
        503,
        { error: 'unavailable' },
        {
          Vary: 'Cookie',
          'Retry-After': String(Math.max(1, Math.min(120, Math.ceil(r.retryAfter ?? 5)))),
        },
      );
    }
    // The refresh token inside the OLD cookie is spent now: from here the NEW sealed session is the
    // only copy that works, so it is set on every outcome below that is not "we cannot keep it".
    if (r.sealed.length > MAX_COOKIE_VALUE) return end();
    const exp = jwtExp(r.accessToken);
    const fresh = sessionCookies(r.sealed);
    if (exp === null) {
      // A token with no readable expiry is not handed out, but the new cookie is kept.
      return json(503, { error: 'unavailable' }, { Vary: 'Cookie', 'Retry-After': '1', 'Set-Cookie': fresh });
    }
    return json(200, { access_token: r.accessToken, expires_at: exp }, { Vary: 'Cookie', 'Set-Cookie': fresh });
  }

  if (path === AUTH_LOGOUT) {
    if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' }, { Allow: 'POST' });
    if (crossSite(req)) return json(403, { error: 'cross_site' });
    const sealed = readCookie(req, SESSION_COOKIE);
    if (sealed) {
      // Revocation is best effort and must not hold up (or fail) the sign-out the person asked for.
      const p = deps.port.revoke(sealed).catch(() => undefined);
      deps.waitUntil ? deps.waitUntil(p) : void p;
    }
    const h = new Headers(base);
    for (const c of [...clearSessionCookies(), ...clearStateCookies()]) h.append('Set-Cookie', c);
    return new Response(null, { status: 204, headers: h });
  }

  return json(404, { error: 'not_found' });
}
