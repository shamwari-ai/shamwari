import { base64urlDecode, utf8Decode } from './pkce';

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

/** Query string by hand: RN's URLSearchParams has not always implemented set(), and the Node tests cannot tell. */
const qs = (params: Record<string, string>): string =>
  Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
const base = (cfg: AuthConfig) => cfg.apiBase.replace(/\/+$/, '');

export function buildAuthorizeUrl(cfg: AuthConfig, p: { challenge: string; state: string }): string {
  return `${base(cfg)}/user_management/authorize?${qs({
    response_type: 'code',
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    provider: 'authkit',
    state: p.state,
    code_challenge: p.challenge,
    code_challenge_method: 'S256',
  })}`;
}

export type Callback =
  | { kind: 'ok'; code: string; state: string }
  | { kind: 'error'; error: string }
  | { kind: 'invalid' };

const decode = (s: string): string => {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch {
    return s; // a stray % in a field we do not depend on (error_description) must not break the redirect
  }
};

/** Parse the redirect by hand: a value may contain '=', and one bad field must not discard the rest. */
export function parseCallback(url: string): Callback {
  const q = url.split('#')[0].split('?').slice(1).join('?');
  if (!q) return { kind: 'invalid' };
  const params: Record<string, string> = {};
  for (const pair of q.split('&')) {
    const i = pair.indexOf('=');
    const k = decode(i < 0 ? pair : pair.slice(0, i));
    if (k) params[k] = i < 0 ? '' : decode(pair.slice(i + 1));
  }
  if (params.error) return { kind: 'error', error: params.error };
  if (params.code && params.state) return { kind: 'ok', code: params.code, state: params.state };
  return { kind: 'invalid' };
}

export type Tokens = { accessToken: string; refreshToken: string };
/**
 * terminal: WorkOS said the grant is spent, revoked or expired (`invalid_grant`). The person must sign in again.
 * rejected: WorkOS refused the request for another reason (a wrong client id, a client that may not be
 *   public, an unexpected 4xx). The person cannot use the session now, but the stored credential is
 *   KEPT: a configuration mistake must never wipe everyone's session.
 * transient: not now (offline, rate limit, WorkOS down). The session is NOT over.
 */
export type TokenFailure = 'terminal' | 'rejected' | 'transient';
export type TokenResult = { ok: true; tokens: Tokens } | { ok: false; failure: TokenFailure };

async function authenticate(f: typeof fetch, cfg: AuthConfig, body: Record<string, string>): Promise<TokenResult> {
  let res: Response;
  try {
    res = await f(`${base(cfg)}/user_management/authenticate`, {
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
  // Only a clear "this grant is no good" ends a session. A 429 or 5xx is an outage (keep it); any
  // other 4xx, a 401 included, means a request or configuration problem (keep the credential, but the
  // person is asked to sign in). Never delete a credential on an answer we cannot read.
  if (o.error === 'invalid_grant') return { ok: false, failure: 'terminal' };
  if (res.status === 429 || res.status >= 500) return { ok: false, failure: 'transient' };
  if (res.status >= 400) return { ok: false, failure: 'rejected' };
  return { ok: false, failure: 'transient' };
}

export const exchangeCode = (f: typeof fetch, cfg: AuthConfig, code: string, verifier: string) =>
  authenticate(f, cfg, { grant_type: 'authorization_code', code, code_verifier: verifier });

export const refreshTokens = (f: typeof fetch, cfg: AuthConfig, refreshToken: string) =>
  authenticate(f, cfg, { grant_type: 'refresh_token', refresh_token: refreshToken });

export function buildLogoutUrl(cfg: AuthConfig, sessionId: string): string {
  return `${base(cfg)}/user_management/sessions/logout?${qs({ session_id: sessionId, return_to: cfg.logoutReturnTo })}`;
}

/**
 * Read `exp` and `sid` from an access token WITHOUT verifying it. That is fine
 * here (it came from WorkOS over TLS and is only used to time a refresh and to
 * build a logout URL) and must never be used for an authorization decision:
 * the gateway verifies the signature.
 */
export function readClaims(jwt: string): { exp: number | null; sid: string | null } {
  try {
    const payload = JSON.parse(utf8Decode(base64urlDecode(jwt.split('.')[1] ?? '')));
    return {
      exp: typeof payload.exp === 'number' ? payload.exp : null,
      sid: typeof payload.sid === 'string' && payload.sid ? payload.sid : null,
    };
  } catch {
    return { exp: null, sid: null };
  }
}
