import { newPkce, safeEqual, type RandomBytes, type Sha256 } from './pkce';
import {
  buildAuthorizeUrl,
  buildLogoutUrl,
  exchangeCode,
  parseCallback,
  readClaims,
  refreshTokens,
  type AuthConfig,
} from './workos';

export interface SecureStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export type BrowserResult = { type: 'success'; url: string } | { type: 'cancel' };

export interface Ports {
  fetch: typeof fetch;
  /** OS keystore. The refresh token and the in-flight PKCE record are the ONLY things written. */
  secure: SecureStorage;
  /** A system browser session (Custom Tab / ASWebAuthenticationSession), never a WebView. */
  openAuthSession(url: string, redirectUri: string): Promise<BrowserResult>;
  openUrl(url: string): Promise<void>;
  randomBytes: RandomBytes;
  sha256: Sha256;
  now(): number;
}

const REFRESH_KEY = 'shamwari.rt';
const PENDING_KEY = 'shamwari.pkce';
/** Refresh this long before expiry so a request never carries a token about to die. */
const SKEW_MS = 60_000;

/** Thrown by getAccessToken when the session may be fine but we could not reach WorkOS. Not a sign-out. */
export class SessionUnavailable extends Error {
  constructor() {
    super('session_unavailable');
  }
}

export type SignInResult = 'signed_in' | 'cancelled' | 'failed';

/**
 * The person's WorkOS session on this phone.
 *
 * - The access token lives in memory only. It is short-lived (about five
 *   minutes at the Shamwari Chat app) and can always be minted again.
 * - The refresh token lives in the OS keystore only, and ROTATES: it is saved
 *   before the new access token is used, so a crash cannot leave a spent token
 *   on disk.
 * - Refresh is serialised: two callers renewing at once would present a
 *   rotated-away token to WorkOS and sign the person out at random.
 * - Only a terminal answer from WorkOS ends the session. An outage keeps it.
 * - Nothing here logs a token, a code or a verifier.
 */
export class Session {
  private access: { token: string; expMs: number } | null = null;
  private inflight: Promise<'ok' | 'terminal' | 'transient'> | null = null;

  constructor(
    private readonly cfg: AuthConfig,
    private readonly p: Ports,
  ) {}

  async isSignedIn(): Promise<boolean> {
    return (await this.p.secure.get(REFRESH_KEY)) !== null;
  }

  async signIn(): Promise<SignInResult> {
    const pkce = await newPkce(this.p.randomBytes, this.p.sha256);
    // Persist BEFORE the browser opens: the OS can kill the app while the browser is up, and the
    // verifier cannot be re-derived. It is also what proves the redirect is the one we started.
    await this.p.secure.set(PENDING_KEY, JSON.stringify({ verifier: pkce.verifier, state: pkce.state }));
    try {
      const result = await this.p.openAuthSession(
        buildAuthorizeUrl(this.cfg, { challenge: pkce.challenge, state: pkce.state }),
        this.cfg.redirectUri,
      );
      if (result.type !== 'success') return 'cancelled';
      const cb = parseCallback(result.url);
      if (cb.kind === 'error') return cb.error === 'access_denied' ? 'cancelled' : 'failed';
      if (cb.kind !== 'ok') return 'failed';
      const pending = await this.loadPending();
      // Reject a missing or mismatched state: this redirect is not the one we started.
      if (!pending || !safeEqual(pending.state, cb.state)) return 'failed';
      const r = await exchangeCode(this.p.fetch, this.cfg, cb.code, pending.verifier);
      if (!r.ok) return 'failed';
      await this.p.secure.set(REFRESH_KEY, r.tokens.refreshToken);
      this.setAccess(r.tokens.accessToken);
      return 'signed_in';
    } finally {
      // A verifier is single-use. Clear it whether or not the exchange worked.
      await this.p.secure.delete(PENDING_KEY).catch(() => undefined);
    }
  }

  /** A usable access token, refreshed when it is near expiry. null: signed out. Throws SessionUnavailable on an outage. */
  async getAccessToken(): Promise<string | null> {
    if (this.access && this.access.expMs - this.p.now() > SKEW_MS) return this.access.token;
    if (!(await this.isSignedIn())) return null;
    const outcome = await this.refresh();
    if (outcome === 'terminal') return null;
    if (outcome === 'transient') {
      // Still inside its real lifetime? Use it rather than fail a request the person is watching.
      if (this.access && this.access.expMs > this.p.now()) return this.access.token;
      throw new SessionUnavailable();
    }
    return this.access?.token ?? null;
  }

  /** After a 401 with a token we believed was fine: force one renewal. true when a new token is ready. */
  async renewAfterRejection(): Promise<boolean> {
    if (!(await this.isSignedIn())) return false;
    this.access = null;
    return (await this.refresh()) === 'ok';
  }

  async signOut(): Promise<void> {
    let sid = this.access ? readClaims(this.access.token).sid : null;
    if (!sid && (await this.isSignedIn())) {
      // After a restart only the refresh token remains, and the logout URL needs the session id.
      if ((await this.refresh()) === 'ok') sid = this.access ? readClaims(this.access.token).sid : null;
    }
    // Local state goes first, so dismissing the browser still leaves the person signed out here.
    this.access = null;
    await this.p.secure.delete(REFRESH_KEY).catch(() => undefined);
    await this.p.secure.delete(PENDING_KEY).catch(() => undefined);
    if (sid) await this.p.openUrl(buildLogoutUrl(this.cfg, sid)).catch(() => undefined);
  }

  private refresh(): Promise<'ok' | 'terminal' | 'transient'> {
    this.inflight ??= this.doRefresh().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async doRefresh(): Promise<'ok' | 'terminal' | 'transient'> {
    const stored = await this.p.secure.get(REFRESH_KEY);
    if (!stored) return 'terminal';
    const r = await refreshTokens(this.p.fetch, this.cfg, stored);
    if (!r.ok) {
      if (r.failure === 'terminal') {
        this.access = null;
        await this.p.secure.delete(REFRESH_KEY).catch(() => undefined);
        return 'terminal';
      }
      return 'transient';
    }
    // Save the rotated refresh token first: the old one is already spent.
    await this.p.secure.set(REFRESH_KEY, r.tokens.refreshToken);
    this.setAccess(r.tokens.accessToken);
    return 'ok';
  }

  private setAccess(token: string): void {
    const { exp } = readClaims(token);
    // No readable exp: treat it as already due, so the next call renews it. Never assume it lasts.
    this.access = { token, expMs: exp ? exp * 1000 : this.p.now() };
  }

  private async loadPending(): Promise<{ verifier: string; state: string } | null> {
    const raw = await this.p.secure.get(PENDING_KEY);
    if (!raw) return null;
    try {
      const v = JSON.parse(raw);
      return typeof v?.verifier === 'string' && typeof v?.state === 'string' ? v : null;
    } catch {
      return null;
    }
  }
}
