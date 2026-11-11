import { WorkOS } from '@workos-inc/node';
import { jwtClaims, type AuthKitPort, type CheckResult, type RefreshResult } from './session';

/**
 * The only file that talks to the WorkOS SDK. Every WorkOS-specific decision is
 * here, so session.ts can be tested against a fake and this can be checked
 * against the SDK's types.
 *
 * Bindings, all by NAME. None of them is a secret except the two named below,
 * and those arrive as Secrets Store bindings (an object with get()) or, for
 * local development only, as plain strings from .dev.vars:
 *   WORKOS_CLIENT_ID      public: the AuthKit application's client id
 *   WORKOS_REDIRECT_URI   public: exactly https://shamwari.ai/lite/callback
 *   WORKOS_API_KEY        OPTIONAL secret: an API key issued to THIS application. Sign-in is a PKCE public
 *                         client and needs none; if one is bound it is used (confidential PKCE) and lets
 *                         sign-out revoke the WorkOS session server-side. Never another app's key.
 *   COOKIE_PASSWORD       SECRET: seals the session cookie; at least 32 characters
 */
export type SecretBinding = string | { get(): Promise<string> } | undefined;

export interface WorkerEnv {
  WORKOS_CLIENT_ID?: string;
  WORKOS_REDIRECT_URI?: string;
  WORKOS_API_KEY?: SecretBinding;
  COOKIE_PASSWORD?: SecretBinding;
  SESSION_REFRESH?: DurableObjectNamespaceLike;
  /** "true" once the main chat answers at /chat/. Until then the root sends everyone to /lite/. */
  CHAT_LIVE?: string;
}

export interface DurableObjectNamespaceLike {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(req: Request): Promise<Response> };
}

export async function secret(b: SecretBinding): Promise<string | undefined> {
  if (typeof b === 'string') return b || undefined;
  if (b && typeof b.get === 'function') return (await b.get()) || undefined;
  return undefined;
}

/**
 * Why a WorkOS call failed, for the logs: the error's name, HTTP status and WorkOS error code or description
 * only. Never the authorization code, the verifier, state, cookies, tokens or any key. Long text is cut.
 */
export function reason(err: unknown): string {
  if (!(err instanceof Error)) return 'unknown error';
  const e = err as Error & { status?: unknown; code?: unknown; error?: unknown; errorDescription?: unknown };
  const parts = [
    e.name,
    typeof e.status === 'number' ? `status ${e.status}` : '',
    typeof e.code === 'string' ? `code ${e.code}` : '',
    typeof e.error === 'string' ? `error ${e.error}` : '',
    typeof e.errorDescription === 'string' ? e.errorDescription : e.message,
  ];
  return parts.filter(Boolean).join(' | ').slice(0, 300);
}

export type Port = AuthKitPort & {
  refresh(sealed: string): Promise<RefreshResult>;
};

/** Misconfiguration is an error to the caller (a 500), never a silent "signed out". */
export async function makePort(env: WorkerEnv, workosOverride?: WorkOS): Promise<Port> {
  const clientId = env.WORKOS_CLIENT_ID;
  const redirectUri = env.WORKOS_REDIRECT_URI;
  const apiKey = await secret(env.WORKOS_API_KEY);
  const cookiePassword = await secret(env.COOKIE_PASSWORD);
  if (!clientId || !redirectUri || !cookiePassword) throw new Error('session worker is not configured');
  if (cookiePassword.length < 32) throw new Error('COOKIE_PASSWORD must be at least 32 characters');

  const workos = workosOverride ?? new WorkOS({ ...(apiKey ? { apiKey } : {}), clientId });
  const um = workos.userManagement;
  /**
   * The session cookie, in the SDK's own format (so loadSealedSession reads it). The SDK only seals for a
   * caller with an API key, and this Worker is a public client, so it uses the SDK's sealing function
   * directly. It is a private method in the types; the tests run it against the real SDK so an upgrade that
   * moves it fails there, not in production.
   */
  const seal = (authenticationResponse: unknown): Promise<string> =>
    (
      um as unknown as {
        sealSessionDataFromAuthenticationResponse(o: { authenticationResponse: unknown; cookiePassword: string }): Promise<string>;
      }
    ).sealSessionDataFromAuthenticationResponse({ authenticationResponse, cookiePassword });
  const load = (sealed: string) => um.loadSealedSession({ sessionData: sealed, cookiePassword });

  /** `sid` from a token the SDK has already read out of our own sealed cookie. */
  const sidOf = (accessToken: string): string | null => {
    const sid = jwtClaims(accessToken)?.sid;
    return typeof sid === 'string' && sid ? sid : null;
  };
  /** The session id from the sealed cookie, whether or not its access token has expired. */
  const sidFromSealed = async (sealed: string): Promise<string | null> => {
    const data = await um.getSessionFromCookie({ sessionData: sealed, cookiePassword });
    return data ? sidOf(data.accessToken) : null;
  };

  return {
    async authorizationUrl(state) {
      // PKCE S256, with OUR state (the SDK's own helper would invent one). The verifier goes back to the
      // caller to be kept in a short-lived HttpOnly cookie and returned with the code.
      const { codeVerifier, codeChallenge, codeChallengeMethod } = await workos.pkce.generate();
      const url = um.getAuthorizationUrl({
        provider: 'authkit',
        clientId,
        redirectUri,
        state,
        codeChallenge,
        codeChallengeMethod,
      });
      return { url, verifier: codeVerifier };
    },

    async exchangeCode(code, verifier) {
      try {
        // Not `session: { sealSession }`: the SDK refuses to seal without an API key. We seal the result
        // ourselves, in exactly the SDK's cookie format (see `seal`), so `check` can read it back.
        const r = await um.authenticateWithCode({ clientId, code, codeVerifier: verifier });
        if (!r.accessToken || !r.refreshToken) {
          console.error('workos code exchange: the response had no tokens');
          return null;
        }
        return { sealed: await seal(r) };
      } catch (err) {
        console.error('workos code exchange failed:', reason(err));
        return null;
      }
    },

    async check(sealed): Promise<CheckResult> {
      try {
        const a = await load(sealed).authenticate();
        if (a.authenticated) return { status: 'valid', accessToken: a.accessToken, sid: a.sessionId };
        // An expired access token fails verification as invalid_jwt. That is the ordinary
        // "time to refresh" case; anything else (no cookie, unreadable cookie) is not a session.
        if (a.reason === 'invalid_jwt') {
          const sid = await sidFromSealed(sealed);
          return sid ? { status: 'expired', sid } : { status: 'invalid' };
        }
        return { status: 'invalid' };
      } catch {
        // The SDK reports a cookie it cannot read (wrong password, tampering) as a result, not a
        // throw. A throw is something unexpected, and an unexpected fault must never be a sign-out.
        return { status: 'unavailable' };
      }
    },

    async refresh(sealed): Promise<RefreshResult> {
      // Not CookieSession.refresh(): like sealing, it needs an API key in the SDK. This is the same grant
      // (a refresh token for a new token pair) without that requirement, sealed the same way.
      try {
        const data = await um.getSessionFromCookie({ sessionData: sealed, cookiePassword });
        if (!data?.refreshToken || !data.accessToken) return { status: 'denied' };
        const org = jwtClaims(data.accessToken)?.org_id;
        const r = await um.authenticateWithRefreshToken({
          clientId,
          refreshToken: data.refreshToken,
          ...(typeof org === 'string' ? { organizationId: org } : {}),
        });
        if (!r.accessToken || !r.refreshToken) return { status: 'retry' };
        return { status: 'ok', sealed: await seal(r), accessToken: r.accessToken };
      } catch (err) {
        console.error('workos refresh failed:', reason(err));
        const e = err as { name?: string; error?: unknown; code?: unknown; retryAfter?: unknown };
        // Terminal: WorkOS says this refresh token can never work again. Everything else is "try again".
        if (e.error === 'invalid_grant' || e.code === 'mfa_enrollment' || e.code === 'sso_required') {
          return { status: 'denied' };
        }
        return { status: 'retry', retryAfter: typeof e.retryAfter === 'number' ? e.retryAfter : undefined };
      }
    },

    async revoke(sealed) {
      // Not authenticate(): that fails for an expired access token, which is the usual state of a
      // cookie when someone comes back and signs out, and the WorkOS session would stay alive.
      // Revoking needs an API key; a public client has none, so there the cookie is cleared and the WorkOS
      // session simply expires on its own.
      if (!apiKey) return;
      const sid = await sidFromSealed(sealed);
      if (sid) await um.revokeSession({ sessionId: sid });
    },
  };
}
