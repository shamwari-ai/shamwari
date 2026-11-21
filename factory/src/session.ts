/**
 * Shamwari sign-in for the factory's own hostname.
 *
 * The same approach as the chat app's session Worker (site/worker/session.ts
 * and gate.ts): WorkOS AuthKit through the WorkOS SDK, the WorkOS session
 * sealed into an HttpOnly cookie that only this Worker can open, and every
 * request checked before anything is served. Copied rather than imported,
 * because each package here builds and deploys on its own; the rules are the
 * same and each has a test in test/session.test.ts.
 *
 * Why a separate sign-in and not the chat's cookie: the chat's session cookie
 * is host-only on shamwari.ai (no Domain attribute), so a browser never sends
 * it to factory.shamwari.ai, and widening it to `.shamwari.ai` would hand the
 * chat session to every subdomain. The factory has its own cookie, scoped to
 * its own host (`__Host-` prefix: Secure, Path=/, no Domain), and its own
 * AuthKit redirect URI. AuthKit keeps one session per browser for the whole
 * WorkOS environment, so someone already signed in to Shamwari is sent
 * straight back without typing anything.
 *
 * Routes (at the root of the factory hostname):
 *   GET  /auth/login    start sign-in; one-time state cookie; 302 to AuthKit
 *   GET  /callback      AuthKit returns here; checks state; sets the session; 302 /
 *   POST /auth/logout   revokes the WorkOS session, clears the cookie, 204
 */

export type CheckResult =
  | { status: "valid"; accessToken: string; sid: string }
  | { status: "expired"; sid: string }
  | { status: "invalid" }
  /** We could not tell (an unexpected fault). Never a sign-out. */
  | { status: "unavailable" };

export type RefreshResult =
  | { status: "ok"; sealed: string; accessToken: string }
  | { status: "denied" }
  | { status: "retry"; retryAfter?: number };

export interface AuthKitPort {
  authorizationUrl(state: string): string;
  exchangeCode(code: string): Promise<{ sealed: string } | null>;
  check(sealed: string): Promise<CheckResult>;
  revoke(sealed: string): Promise<void>;
}

export const SESSION_COOKIE = "__Host-shamwari_factory";
export const STATE_COOKIE = "__Host-shamwari_factory_oauth";

export const AUTH_LOGIN = "/auth/login";
export const AUTH_CALLBACK = "/callback";
export const AUTH_LOGOUT = "/auth/logout";
export const AUTH_ROUTES: readonly string[] = [
  AUTH_LOGIN,
  AUTH_CALLBACK,
  AUTH_LOGOUT,
];

/** Browsers drop a cookie over about 4096 bytes; refuse where it can be seen. */
export const MAX_COOKIE_VALUE = 3800;
export const SESSION_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;
const STATE_MAX_AGE = 600;
/** Renew when the token has less than this left. */
export const RENEW_BELOW_SECONDS = 60;
/**
 * Renew when the token is older than this. The gateway refuses a WorkOS token
 * issued more than an hour ago (WORKOS_MAX_TOKEN_AGE_SECONDS, default 3600),
 * and the token is what the factory hands the gateway for the person.
 */
export const RENEW_AFTER_AGE_SECONDS = 30 * 60;

export const BASE_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

export function cookieHeader(
  name: string,
  value: string,
  maxAge: number,
): string {
  return `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}
export const sessionCookie = (sealed: string) =>
  cookieHeader(SESSION_COOKIE, sealed, SESSION_COOKIE_MAX_AGE);
export const clearSessionCookie = () => cookieHeader(SESSION_COOKIE, "", 0);
const clearStateCookie = () => cookieHeader(STATE_COOKIE, "", 0);

export function readCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.get("Cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name)
      return part.slice(i + 1).trim() || null;
  }
  return null;
}

function eq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** The payload of a JWT that something else has already verified. */
export function jwtClaims(token: string): Record<string, unknown> | null {
  try {
    const seg = token.split(".")[1] ?? "";
    const o = JSON.parse(
      atob(
        seg
          .replace(/-/g, "+")
          .replace(/_/g, "/")
          .padEnd(Math.ceil(seg.length / 4) * 4, "="),
      ),
    ) as unknown;
    return o && typeof o === "object" && !Array.isArray(o)
      ? (o as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

const FAILED_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sign-in failed</title></head><body><main><h1>We could not sign you in</h1><p>Please try again.</p><p><a href="${AUTH_LOGIN}">Try again</a></p></main></body></html>`;

/** What a failed sign-in shows. It does not redirect back into sign-in (that would loop). */
export function failedPage(status = 401): Response {
  return new Response(FAILED_PAGE, {
    status,
    headers: {
      ...BASE_HEADERS,
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy":
        "default-src 'none'; base-uri 'none'; form-action 'none'",
    },
  });
}

/** Fails closed: nothing is served when the gate cannot decide. */
export function unavailable(retryAfter = 30): Response {
  return new Response("Sign-in is unavailable. Please try again shortly.\n", {
    status: 503,
    headers: {
      ...BASE_HEADERS,
      "Content-Type": "text/plain; charset=utf-8",
      "Retry-After": String(retryAfter),
    },
  });
}

const json = (status: number, body: unknown, extra: HeadersInit = {}) => {
  const h = new Headers({
    ...BASE_HEADERS,
    "Content-Type": "application/json",
  });
  new Headers(extra).forEach((v, k) => h.append(k, v));
  return new Response(JSON.stringify(body), { status, headers: h });
};

const redirect = (to: string, cookies: string[]) => {
  const h = new Headers({ ...BASE_HEADERS, Location: to });
  for (const c of cookies) h.append("Set-Cookie", c);
  return new Response(null, { status: 302, headers: h });
};

/** A request that browsers say came from another site. */
export const crossSite = (req: Request) =>
  req.headers.get("Sec-Fetch-Site") === "cross-site";

export interface AuthDeps {
  port: AuthKitPort;
  randomState(): string;
  waitUntil?(p: Promise<unknown>): void;
}

/** The three sign-in routes. */
export async function handleAuth(
  req: Request,
  deps: AuthDeps,
): Promise<Response> {
  const url = new URL(req.url);

  if (url.pathname === AUTH_LOGIN) {
    if (req.method !== "GET")
      return json(405, { error: "method_not_allowed" }, { Allow: "GET" });
    const state = deps.randomState();
    return redirect(deps.port.authorizationUrl(state), [
      cookieHeader(STATE_COOKIE, state, STATE_MAX_AGE),
    ]);
  }

  if (url.pathname === AUTH_CALLBACK) {
    if (req.method !== "GET")
      return json(405, { error: "method_not_allowed" }, { Allow: "GET" });
    const expected = readCookie(req, STATE_COOKIE);
    const got = url.searchParams.get("state");
    const code = url.searchParams.get("code");
    const failed = () => {
      const r = failedPage();
      r.headers.append("Set-Cookie", clearStateCookie());
      return r;
    };
    if (!expected || !got || !eq(expected, got)) return failed();
    if (url.searchParams.has("error") || !code) return failed();
    const session = await deps.port.exchangeCode(code);
    if (!session || session.sealed.length > MAX_COOKIE_VALUE) return failed();
    // Nothing the request carries decides where the person lands: always /.
    return redirect("/", [clearStateCookie(), sessionCookie(session.sealed)]);
  }

  if (url.pathname === AUTH_LOGOUT) {
    if (req.method !== "POST")
      return json(405, { error: "method_not_allowed" }, { Allow: "POST" });
    if (crossSite(req)) return json(403, { error: "cross_site" });
    const sealed = readCookie(req, SESSION_COOKIE);
    if (sealed) {
      const p = deps.port.revoke(sealed).catch(() => undefined);
      if (deps.waitUntil) deps.waitUntil(p);
      else void p;
    }
    const h = new Headers(BASE_HEADERS);
    h.append("Set-Cookie", clearSessionCookie());
    h.append("Set-Cookie", clearStateCookie());
    return new Response(null, { status: 204, headers: h });
  }

  return json(404, { error: "not_found" });
}
