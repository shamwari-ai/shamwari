import type { Env } from "./types";

/**
 * The Nyuchi API token the Worker hands Core on each request.
 *
 * Core holds no standing credential for the API (owner decision, 2026-11-13). The Worker holds
 * the API key pair in the Cloudflare Secrets Store (SHAMWARI_API_CLIENT_ID and
 * SHAMWARI_API_CLIENT_SECRET), trades it for a short-lived machine token at POST /v1/auth/token
 * (OAuth 2.0 client_credentials, RFC 6749 4.4; the API issues it for an hour), and sends that token
 * to Core in `X-Shamwari-Api-Token`. Core forwards it to the API for that request and keeps nothing.
 *
 * Rules this module keeps:
 *   - The token is cached until ~30 s before it expires, with one exchange in flight at a time.
 *   - A failure never throws and never returns a stale or partial token: the caller gets null,
 *     calls Core without a token, and Core answers 503 data_api_unavailable (chat degrades
 *     ungrounded). A failed exchange is remembered briefly so an outage is not hammered.
 *   - Neither the secrets nor the token are ever logged or put in an error message. Failures log
 *     a stage and a status code or exception class, nothing else.
 */

/** Header Core reads the token from. Lower-cased by HTTP; Core matches `x-shamwari-api-token`. */
export const API_TOKEN_HEADER = "X-Shamwari-Api-Token";

/** Refresh this long before the token's own expiry, so a token never expires in flight. */
export const REFRESH_MARGIN_MS = 30_000;
/** How long a failed exchange is remembered before the next try. */
export const FAILURE_BACKOFF_MS = 5_000;
/** The exchange must not hold a request longer than this; Core's own call has its own 4 s limit. */
export const EXCHANGE_TIMEOUT_MS = 2_500;

const DEFAULT_API_URL = "https://api.nyuchi.com";

interface Cached {
  /** Which key pair this was issued for, so a rotated pair never reuses the old token. */
  clientId: string;
  token: string;
  /** Epoch ms after which the token must not be used (already net of the refresh margin). */
  usableUntil: number;
}

let cached: Cached | null = null;
let failedUntil = 0;
let inflight: Promise<string | null> | null = null;

/** For tests: forget everything this module remembers. */
export function resetApiTokenCache(): void {
  cached = null;
  failedUntil = 0;
  inflight = null;
}

/**
 * A current token, or null if there is no key pair configured or the exchange cannot be made.
 * Never throws.
 */
export async function apiToken(env: Env, now: () => number = Date.now): Promise<string | null> {
  let clientId: string | null;
  let clientSecret: string | null;
  try {
    clientId = (await env.SHAMWARI_API_CLIENT_ID?.get()) ?? null;
    clientSecret = (await env.SHAMWARI_API_CLIENT_SECRET?.get()) ?? null;
  } catch {
    // Secrets Store unavailable. Nothing to say about why: the message could carry a binding detail.
    console.warn("api token: secrets store unavailable");
    return null;
  }
  if (!clientId || !clientSecret) return null;

  if (cached && cached.clientId === clientId && now() < cached.usableUntil) return cached.token;
  if (now() < failedUntil) return null;

  // One exchange at a time: concurrent requests share the promise instead of each trading the key.
  inflight ??= exchange(env, clientId, clientSecret, now).finally(() => {
    inflight = null;
  });
  return inflight;
}

async function exchange(
  env: Env,
  clientId: string,
  clientSecret: string,
  now: () => number,
): Promise<string | null> {
  const base = (env.NYUCHI_API_URL || DEFAULT_API_URL).replace(/\/+$/, "");
  try {
    const res = await fetch(`${base}/v1/auth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      // Form body, never headers: X-Client-Id/X-Client-Secret on this route would be read as an API call.
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
      signal: AbortSignal.timeout(EXCHANGE_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`api token: exchange refused (${res.status})`);
      return fail(now);
    }
    const body = (await res.json()) as { access_token?: unknown; expires_in?: unknown };
    const token = body.access_token;
    const lifetime = Number(body.expires_in);
    if (typeof token !== "string" || !token || !Number.isFinite(lifetime) || lifetime <= 0) {
      console.warn("api token: exchange answered an unusable body");
      return fail(now);
    }
    const usableUntil = now() + lifetime * 1000 - REFRESH_MARGIN_MS;
    if (usableUntil <= now()) {
      // So short-lived that the margin eats it: use it for this call only, cache nothing.
      cached = null;
      return token;
    }
    cached = { clientId, token, usableUntil };
    failedUntil = 0;
    return token;
  } catch (e) {
    console.warn(`api token: exchange failed (${e instanceof Error ? e.name : "error"})`);
    return fail(now);
  }
}

function fail(now: () => number): null {
  cached = null;
  failedUntil = now() + FAILURE_BACKOFF_MS;
  return null;
}
