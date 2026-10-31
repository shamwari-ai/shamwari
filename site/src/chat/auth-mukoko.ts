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
 *    A network failure does not: the person may simply be offline.
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

  const hint = {
    get(): boolean {
      try {
        return (opts.hintStorage ?? localStorage).getItem(HINT) === '1';
      } catch {
        return false;
      }
    },
    set(on: boolean) {
      try {
        const st = opts.hintStorage ?? localStorage;
        if (on) st.setItem(HINT, '1');
        else st.removeItem(HINT);
      } catch {
        /* the hint is a convenience */
      }
    },
  };

  const valid = () => token !== null && now() < expiresAt - skew;

  async function renew(): Promise<boolean> {
    try {
      const res = await doFetch(tokenUrl, {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status === 401 || res.status === 403) {
        token = null;
        denied = true;
        hint.set(false);
        return false;
      }
      if (!res.ok) return valid(); // the Worker is having trouble: keep what we have, change nothing
      const body = (await res.json().catch(() => null)) as { access_token?: unknown; expires_at?: unknown } | null;
      const t = typeof body?.access_token === 'string' && body.access_token ? body.access_token : null;
      const exp = parseExpiry(body?.expires_at);
      if (!t || exp === null) return valid();
      token = t;
      expiresAt = exp;
      denied = false;
      hint.set(true);
      return true;
    } catch {
      return valid(); // offline or timed out: not the same as signed out
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
    signedIn: () => !denied && (token !== null || hint.get()),
    async ensureKey() {
      if (denied) return null; // signed out (or refused): never quietly sign back in from the cookie
      if (valid()) return token;
      await refresh();
      return token !== null && now() < expiresAt ? token : null;
    },
    refresh,
    invalidate() {
      token = null;
      denied = true;
      hint.set(false);
    },
    async signOut() {
      token = null;
      expiresAt = 0;
      denied = true;
      hint.set(false);
      try {
        await doFetch(logoutUrl, { method: 'POST', credentials: 'same-origin', cache: 'no-store' });
      } catch {
        /* the token is already gone from this page; the cookie expires on its own */
      }
    },
  };
}
