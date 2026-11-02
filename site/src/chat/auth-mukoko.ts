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
  /** Give up on a request to the session Worker after this long. */
  timeoutMs?: number;
}

const HINT = 'shamwari.mukoko.hint';
const PENDING_LOGOUT = 'shamwari.mukoko.logout';

/**
 * Epoch seconds, epoch milliseconds, or an ISO date: whatever the Worker sends.
 * Anything that is not a real point in time (empty, zero, negative) is null, never "already expired".
 */
export function parseExpiry(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v < 1e12 ? v * 1000 : v;
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return null;
    const n = Number(s);
    if (Number.isFinite(n)) return parseExpiry(n);
    const t = Date.parse(s);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

/**
 * A request deadline that works on every browser this is built for. `AbortSignal.timeout` does not
 * exist before Chrome 103 / Safari 16 / many low-end WebViews, where using it throws and the
 * request is never made; AbortController plus a timer works everywhere (client.ts does the same).
 */
function deadline(ms: number): { signal: AbortSignal; done: () => void } {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return { signal: c.signal, done: () => clearTimeout(t) };
}

export function mukokoAuth(opts: MukokoOptions = {}): AuthProvider & { readonly loginUrl: string } {
  const doFetch = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const tokenUrl = opts.tokenUrl ?? '/lite/auth/token';
  const logoutUrl = opts.logoutUrl ?? '/lite/auth/logout';
  const loginUrl = opts.loginUrl ?? '/lite/auth/login';
  const now = opts.now ?? Date.now;
  const skew = opts.skewMs ?? 30_000;
  const timeoutMs = opts.timeoutMs ?? 10_000;

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
    const d = deadline(timeoutMs);
    try {
      const res = await doFetch(logoutUrl, { method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: d.signal });
      return res.ok;
    } catch {
      return false; // offline, or no answer in time: the pending marker keeps it from being forgotten
    } finally {
      d.done();
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
    const d = deadline(timeoutMs);
    try {
      const res = await doFetch(tokenUrl, {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        signal: d.signal,
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
    } finally {
      d.done();
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
    async prepareSignIn() {
      // Signing in while the previous person's session may still be alive on the Worker would let
      // that session be picked straight back up. Finish the sign-out first, or say it did not finish.
      if (!pendingLogout.get()) return true;
      if (!(await logoutRemote())) return false;
      pendingLogout.set(false);
      return true;
    },
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
