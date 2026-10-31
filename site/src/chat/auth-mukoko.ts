import type { AuthProvider } from './auth';

/**
 * The Mukoko Account provider (WorkOS AuthKit). The WORKING PART of sign-in
 * lives on a small session Worker that holds an HttpOnly cookie and the
 * WorkOS refresh token; this page only ever sees the short-lived access token.
 *
 * Rules, each with a test:
 *  - The token lives in a closure variable. It is never written to localStorage,
 *    sessionStorage, IndexedDB, a cookie or the Cache API, so injected script
 *    can at worst use it until it expires.
 *  - The only thing kept on the device is a boolean "signed in before" hint, so
 *    that an offline reload does not throw a signed-in person at the sign-in
 *    screen. It is not a credential.
 *  - Renewals are serialised: concurrent callers share one request, because the
 *    session behind it rotates single-use refresh tokens.
 *  - A 401 from the renewal endpoint means the session is over: forget everything.
 *    Anything else (a network failure, a 403 from a firewall, a 5xx) does not:
 *    the person may simply be offline or the Worker briefly unwell.
 *  - Sign-out is not finished until the Worker has acknowledged it. If that call
 *    cannot be made, a "logout pending" marker (a boolean) is kept and retried
 *    before anything else on the next visit, so a surviving cookie can never
 *    quietly sign the previous person back in.
 *  - A renewal that was in flight when the person signed out cannot bring the
 *    token back: its result is ignored.
 */
export interface MukokoOptions {
  fetch?: typeof fetch;
  tokenUrl?: string;
  logoutUrl?: string;
  loginUrl?: string;
  now?: () => number;
  /** Renew this long before expiry, so a request is never sent with a token about to lapse. */
  skewMs?: number;
  hintStorage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
}

const HINT = 'shamwari.mukoko.hint';
const PENDING_LOGOUT = 'shamwari.mukoko.logout';

/** Epoch seconds, epoch milliseconds, or an ISO date: whatever the Worker sends. */
export function parseExpiry(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v < 1e12 ? v * 1000 : v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return parseExpiry(n);
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

export function mukokoAuth(opts: MukokoOptions = {}): AuthProvider & { readonly loginUrl: string } {
  const doFetch = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const tokenUrl = opts.tokenUrl ?? '/chat/auth/token';
  const logoutUrl = opts.logoutUrl ?? '/chat/auth/logout';
  const loginUrl = opts.loginUrl ?? '/chat/auth/login';
  const now = opts.now ?? Date.now;
  const skew = opts.skewMs ?? 30_000;

  let token: string | null = null;
  let expiresAt = 0;
  let inflight: Promise<boolean> | null = null;
  let denied = false; // the session said no: signed out until a new sign-in

  const flag = (key: string) => ({
    get(): boolean {
      try {
        return (opts.hintStorage ?? localStorage).getItem(key) === '1';
      } catch {
        return false;
      }
    },
    set(on: boolean) {
      try {
        const st = opts.hintStorage ?? localStorage;
        if (on) st.setItem(key, '1');
        else st.removeItem(key);
      } catch {
        /* a convenience, never a credential */
      }
    },
  });
  const hint = flag(HINT);
  const pendingLogout = flag(PENDING_LOGOUT);
  /** Bumped by sign-out and invalidate, so a renewal already in flight cannot undo them. */
  let generation = 0;

  const valid = () => token !== null && now() < expiresAt - skew;

  /** Ask the Worker to end the session. True once it has acknowledged. */
  async function logoutRemote(): Promise<boolean> {
    try {
      const res = await doFetch(logoutUrl, { method: 'POST', credentials: 'same-origin', cache: 'no-store' });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** True only if THIS call obtained a fresh token. Every other outcome is false, so a caller never resends a rejected one. */
  async function renew(): Promise<boolean> {
    const started = generation;
    // A sign-out that never reached the Worker is finished first, before anything can renew.
    if (pendingLogout.get()) {
      if (!(await logoutRemote())) {
        denied = true;
        return false;
      }
      pendingLogout.set(false);
    }
    try {
      const res = await doFetch(tokenUrl, {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });
      if (started !== generation) return false; // signed out while this was in flight
      if (res.status === 401) {
        token = null;
        denied = true;
        hint.set(false);
        return false;
      }
      // Only a 401 ends a session. A 403 can be a firewall or a challenge, and a
      // 5xx is the Worker having a bad moment: keep what we have, change nothing.
      if (!res.ok) return false;
      const body = (await res.json().catch(() => null)) as { access_token?: unknown; expires_at?: unknown } | null;
      if (started !== generation) return false;
      const t = typeof body?.access_token === 'string' && body.access_token ? body.access_token : null;
      const exp = parseExpiry(body?.expires_at);
      if (!t || exp === null) return false;
      token = t;
      expiresAt = exp;
      denied = false;
      hint.set(true);
      return true;
    } catch {
      return false; // offline or timed out: not the same as signed out
    }
  }

  const refresh = (): Promise<boolean> => {
    inflight ??= renew().finally(() => {
      inflight = null;
    });
    return inflight;
  };

  return {
    kind: 'mukoko',
    loginUrl,
    getKey: () => token,
    signedIn: () => !denied && !pendingLogout.get() && (token !== null || hint.get()),
    async ensureKey() {
      if (denied) return null; // signed out (or refused): never quietly sign back in from the cookie
      if (valid()) return token;
      await refresh();
      return token !== null && now() < expiresAt ? token : null;
    },
    refresh,
    invalidate() {
      generation += 1;
      token = null;
      denied = true;
      hint.set(false);
    },
    async signOut() {
      generation += 1;
      token = null;
      expiresAt = 0;
      denied = true;
      hint.set(false);
      pendingLogout.set(true); // until the Worker says it has ended the session
      if (await logoutRemote()) pendingLogout.set(false);
    },
  };
}
