import { gate, type GateDeps } from "./gate";
import {
  AUTH_ROUTES,
  BASE_HEADERS,
  crossSite,
  handleAuth,
  unavailable,
  type AuthDeps,
} from "./session";

/**
 * The Worker's request path, with every binding behind an interface so the
 * tests can run it in Node:
 *
 *   browser ── https://<factory host>/... ──▶ this Worker
 *     /auth/login, /callback, /auth/logout  → sign-in (session.ts)
 *     anything else                         → gate (gate.ts): verified session or nothing
 *        └─▶ the person's own Durable Object, getByName(workspaceName(sub))
 *              └─▶ their container's OpenCode server (workspace-core.ts)
 */

/** What the router needs from a workspace Durable Object stub. */
export interface WorkspaceStub {
  setGatewayCredential(token: string, expiresAt: number): Promise<void>;
  fetch(req: Request): Promise<Response>;
}

export interface RouterDeps {
  /** Built only when a sign-in route or the gate needs it. Throws when the secrets are not bound. */
  auth(): Promise<AuthDeps & GateDeps>;
  workspace(name: string): WorkspaceStub;
}

/**
 * The one place a workspace name is made, from the verified user id only.
 * Prefixed so a workspace name can never collide with any other object name.
 */
export function workspaceName(userId: string): string {
  return `user:${userId}`;
}

/** Never forwarded to the workspace: the session cookie and any credential the browser sent. */
const NOT_FORWARDED = ["cookie", "authorization", "proxy-authorization"];

export function forwardable(req: Request): Request {
  const headers = new Headers(req.headers);
  for (const h of NOT_FORWARDED) headers.delete(h);
  return new Request(req, { headers });
}

/** Headers set on everything the workspace answers (not on a WebSocket upgrade). */
const RESPONSE_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Opener-Policy": "same-origin",
};

export async function route(req: Request, deps: RouterDeps): Promise<Response> {
  const url = new URL(req.url);

  if (AUTH_ROUTES.includes(url.pathname)) {
    let auth: AuthDeps & GateDeps;
    try {
      auth = await deps.auth();
    } catch (err) {
      console.error(
        "factory sign-in unavailable:",
        err instanceof Error ? err.message : "unknown error",
      );
      return unavailable();
    }
    return handleAuth(req, auth);
  }

  // The workspace runs commands. Another site may not drive it: only a
  // top-level page load may arrive from elsewhere (and it still needs the
  // session cookie, which SameSite=Lax sends on a page load only).
  const navigation =
    req.method === "GET" && req.headers.get("Sec-Fetch-Mode") === "navigate";
  if (crossSite(req) && !navigation) {
    return new Response("Cross-site request refused.\n", {
      status: 403,
      headers: BASE_HEADERS,
    });
  }

  let auth: AuthDeps & GateDeps;
  try {
    auth = await deps.auth();
  } catch (err) {
    console.error(
      "factory gate unavailable:",
      err instanceof Error ? err.message : "unknown error",
    );
    return unavailable();
  }
  const g = await gate(req, auth);
  if (!g.ok) return g.response;
  const { identity } = g;

  const stub = deps.workspace(workspaceName(identity.userId));
  let res: Response;
  try {
    await stub.setGatewayCredential(identity.accessToken, identity.expiresAt);
    res = await stub.fetch(forwardable(req));
  } catch (err) {
    console.error(
      "workspace failed:",
      err instanceof Error ? err.message : "unknown error",
    );
    const r = unavailable(10);
    if (identity.setCookie) r.headers.append("Set-Cookie", identity.setCookie);
    return r;
  }

  // A WebSocket upgrade is passed through untouched.
  if (res.status === 101) return res;
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(RESPONSE_HEADERS)) out.headers.set(k, v);
  out.headers.append("Vary", "Cookie");
  if (identity.setCookie) out.headers.append("Set-Cookie", identity.setCookie);
  return out;
}
