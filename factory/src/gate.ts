import {
  AUTH_LOGIN,
  BASE_HEADERS,
  RENEW_AFTER_AGE_SECONDS,
  RENEW_BELOW_SECONDS,
  MAX_COOKIE_VALUE,
  SESSION_COOKIE,
  clearSessionCookie,
  jwtClaims,
  readCookie,
  sessionCookie,
  unavailable,
  type CheckResult,
  type RefreshResult,
} from "./session";

/**
 * The gate in front of every factory path that is not a sign-in route.
 *
 * Nothing reaches a workspace (and so nothing reaches a container) without a
 * verified Shamwari session. A page load with no session goes to sign-in; any
 * other request is refused with 401. When the session cannot be checked (the
 * secrets are not bound, WorkOS is unreachable) the answer is 503: it fails
 * closed, never open.
 *
 * Who the person is comes ONLY from the verified access token's `sub` (the
 * WorkOS user id). No path, query parameter or header can choose a workspace,
 * which is what keeps one person out of another's (test/router.test.ts).
 */

export interface Identity {
  /** The WorkOS user id from the verified token. */
  userId: string;
  /** The person's current access token: what the factory hands the gateway for them. */
  accessToken: string;
  /** `exp` of that token, epoch seconds. */
  expiresAt: number;
  /** A renewed session cookie to set on the response, when one was issued. */
  setCookie?: string;
}

export interface GateDeps {
  check(sealed: string): Promise<CheckResult>;
  /** Serialised per session (refresh tokens are single-use). */
  refresh(sid: string, sealed: string): Promise<RefreshResult>;
  now(): number;
}

export type GateResult =
  | { ok: true; identity: Identity }
  | { ok: false; response: Response };

/** A top-level page load, as opposed to a script, an API call or a stream. */
export function isNavigation(req: Request): boolean {
  if (req.method !== "GET") return false;
  const mode = req.headers.get("Sec-Fetch-Mode");
  if (mode) return mode === "navigate";
  return (req.headers.get("Accept") ?? "").includes("text/html");
}

function denied(req: Request, clear: boolean): Response {
  const headers = new Headers(BASE_HEADERS);
  headers.set("Vary", "Cookie");
  if (clear) headers.append("Set-Cookie", clearSessionCookie());
  if (isNavigation(req)) {
    headers.set("Location", AUTH_LOGIN);
    return new Response(null, { status: 302, headers });
  }
  headers.set("Content-Type", "text/plain; charset=utf-8");
  return new Response("Sign in to continue.\n", { status: 401, headers });
}

/** A fresh-enough token, its owner and its expiry; null when it must be renewed first. */
function usable(
  token: string,
  nowMs: number,
): { userId: string; exp: number } | null {
  const claims = jwtClaims(token);
  const sub = claims?.sub;
  const exp = claims?.exp;
  const iat = claims?.iat;
  if (typeof sub !== "string" || !sub) return null;
  if (typeof exp !== "number" || !Number.isFinite(exp)) return null;
  const now = nowMs / 1000;
  if (exp - now <= RENEW_BELOW_SECONDS) return null;
  if (typeof iat === "number" && now - iat >= RENEW_AFTER_AGE_SECONDS)
    return null;
  return { userId: sub, exp };
}

export async function gate(req: Request, deps: GateDeps): Promise<GateResult> {
  const sealed = readCookie(req, SESSION_COOKIE);
  if (!sealed) return { ok: false, response: denied(req, false) };

  let checked: CheckResult;
  try {
    checked = await deps.check(sealed);
  } catch {
    return { ok: false, response: unavailable() };
  }
  if (checked.status === "invalid")
    return { ok: false, response: denied(req, true) };
  if (checked.status === "unavailable")
    return { ok: false, response: unavailable(5) };

  if (checked.status === "valid") {
    const u = usable(checked.accessToken, deps.now());
    if (u)
      return {
        ok: true,
        identity: {
          userId: u.userId,
          accessToken: checked.accessToken,
          expiresAt: u.exp,
        },
      };
  }

  // Expired, or too old for the gateway: renew, and set the new cookie.
  let r: RefreshResult;
  try {
    r = await deps.refresh(checked.sid, sealed);
  } catch {
    return { ok: false, response: unavailable(5) };
  }
  if (r.status === "denied") return { ok: false, response: denied(req, true) };
  if (r.status === "retry")
    return {
      ok: false,
      response: unavailable(
        Math.max(1, Math.min(120, Math.ceil(r.retryAfter ?? 5))),
      ),
    };
  if (r.sealed.length > MAX_COOKIE_VALUE)
    return { ok: false, response: denied(req, true) };
  const u = usable(r.accessToken, deps.now());
  if (!u) {
    // The old refresh token is spent: keep the new cookie even so.
    const res = unavailable(1);
    res.headers.append("Set-Cookie", sessionCookie(r.sealed));
    return { ok: false, response: res };
  }
  return {
    ok: true,
    identity: {
      userId: u.userId,
      accessToken: r.accessToken,
      expiresAt: u.exp,
      setCookie: sessionCookie(r.sealed),
    },
  };
}
