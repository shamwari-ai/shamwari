import { base64urlDecode } from './pkce';

/**
 * The WorkOS AuthKit calls the app makes, as plain functions. Read from the
 * WorkOS docs on 2026-11-02 (not exercised against a real tenant):
 *  - authorize: GET /user_management/authorize with provider=authkit, state and
 *    a PKCE code_challenge (method S256)
 *  - exchange / refresh: POST /user_management/authenticate (JSON). With no
 *    client_secret, code_verifier is required. Refresh tokens ROTATE: the old
 *    one stops working, so the new one must be saved.
 *  - sign-out: /user_management/sessions/logout?session_id=...&return_to=...
 * There is no API key or client secret in this app, by design: anything shipped
 * in the bundle is extractable.
 */
export interface AuthConfig {
  /** Public. The Shamwari Chat AuthKit app: the gateway accepts only this client's tokens. */
  clientId: string;
  /** Must be registered in the WorkOS app, and be the app's own scheme (not a generic one). */
  redirectUri: string;
  logoutReturnTo: string;
  apiBase: string;
}

export function buildAuthorizeUrl(cfg: AuthConfig, p: { challenge: string; state: string }): string {
  const u = new URL('/user_management/authorize', cfg.apiBase);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', cfg.clientId);
  u.searchParams.set('redirect_uri', cfg.redirectUri);
  u.searchParams.set('provider', 'authkit');
  u.searchParams.set('state', p.state);
  u.searchParams.set('code_challenge', p.challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  return u.toString();
}

export type Callback =
  | { kind: 'ok'; code: string; state: string }
  | { kind: 'error'; error: string }
  | { kind: 'invalid' };

/** Parse the redirect by hand: Hermes' URL has no searchParams on custom schemes in every version. */
export function parseCallback(url: string): Callback {
  const q = url.split('#')[0].split('?')[1];
  if (!q) return { kind: 'invalid' };
  const params: Record<string, string> = {};
  for (const pair of q.split('&')) {
    const [k, v = ''] = pair.split('=');
    try {
      params[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' '));
    } catch {
      return { kind: 'invalid' };
    }
  }
  if (params.error) return { kind: 'error', error: params.error };
  if (params.code && params.state) return { kind: 'ok', code: params.code, state: params.state };
  return { kind: 'invalid' };
}

export type Tokens = { accessToken: string; refreshToken: string };
/**
 * terminal: the credential is spent, revoked or expired (the person must sign in again).
 * transient: not now (offline, rate limit, WorkOS down). The session is NOT over.
 */
export type TokenFailure = 'terminal' | 'transient';
export type TokenResult = { ok: true; tokens: Tokens } | { ok: false; failure: TokenFailure };

async function authenticate(f: typeof fetch, cfg: AuthConfig, body: Record<string, string>): Promise<TokenResult> {
  let res: Response;
  try {
    res = await f(new URL('/user_management/authenticate', cfg.apiBase).toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: cfg.clientId, ...body }),
    });
  } catch {
    return { ok: false, failure: 'transient' };
  }
  const json: unknown = await res.json().catch(() => null);
  const o = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>;
  if (res.ok) {
    return typeof o.access_token === 'string' && typeof o.refresh_token === 'string'
      ? { ok: true, tokens: { accessToken: o.access_token, refreshToken: o.refresh_token } }
      : { ok: false, failure: 'transient' }; // a 200 we cannot read is not proof the session is over
  }
  // Only a clear "this credential is no good" ends a session. Everything else (429, 5xx, an
  // unexpected 4xx) keeps it, so our or WorkOS's outage is never somebody's sign-out.
  if (res.status === 401 || o.error === 'invalid_grant') return { ok: false, failure: 'terminal' };
  return { ok: false, failure: 'transient' };
}

export const exchangeCode = (f: typeof fetch, cfg: AuthConfig, code: string, verifier: string) =>
  authenticate(f, cfg, { grant_type: 'authorization_code', code, code_verifier: verifier });

export const refreshTokens = (f: typeof fetch, cfg: AuthConfig, refreshToken: string) =>
  authenticate(f, cfg, { grant_type: 'refresh_token', refresh_token: refreshToken });

export function buildLogoutUrl(cfg: AuthConfig, sessionId: string): string {
  const u = new URL('/user_management/sessions/logout', cfg.apiBase);
  u.searchParams.set('session_id', sessionId);
  u.searchParams.set('return_to', cfg.logoutReturnTo);
  return u.toString();
}

/**
 * Read `exp` and `sid` from an access token WITHOUT verifying it. That is fine
 * here (it came from WorkOS over TLS and is only used to time a refresh and to
 * build a logout URL) and must never be used for an authorization decision:
 * the gateway verifies the signature.
 */
export function readClaims(jwt: string): { exp: number | null; sid: string | null } {
  try {
    const payload = JSON.parse(new TextDecoder().decode(base64urlDecode(jwt.split('.')[1] ?? '')));
    return {
      exp: typeof payload.exp === 'number' ? payload.exp : null,
      sid: typeof payload.sid === 'string' && payload.sid ? payload.sid : null,
    };
  } catch {
    return { exp: null, sid: null };
  }
}
