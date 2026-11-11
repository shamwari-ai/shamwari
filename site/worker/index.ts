import { handle, type Deps, type RefreshResult } from './session';
import { rootResponse } from './root';
import { gate, isGated, unavailable } from './gate';
import { makePort, type Port, type WorkerEnv } from './workos-port';

export { SessionRefresh } from './refresh-do';

/**
 * Entry point of the `shamwari-app` Worker. It runs first for the root, for everything under /lite/ and for the
 * build output in /lite/_astro/ (`assets.run_worker_first`, app/wrangler.jsonc): the sign-in routes are answered here,
 * and every other path is passed through the gate (gate.ts), which serves the static asset only to someone with
 * a session (or, for the short public list, to anyone).
 */
interface Ctx {
  waitUntil(p: Promise<unknown>): void;
}

/** The static assets binding (`assets.binding` in app/wrangler.jsonc). */
export interface AssetsBinding {
  fetch(req: Request): Promise<Response>;
}
export type Env = WorkerEnv & { ASSETS?: AssetsBinding };

/** The only paths (besides the root) that reach this Worker on purpose: `assets.run_worker_first`.
 *  test/worker/root.test.ts fails if this and app/wrangler.jsonc disagree. */
export const SESSION_PATHS = new Set(['/lite/auth/login', '/lite/auth/token', '/lite/auth/logout', '/lite/callback']);

function randomState(): string {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

/** One session check per Worker environment, not one per file: a page load asks the gate for the page and every script. */
const ports = new WeakMap<object, Promise<Port>>();
function portFor(env: Env): Promise<Port> {
  let p = ports.get(env);
  if (!p) {
    p = makePort(env);
    ports.set(env, p);
    // A port that could not be built (a secret not bound yet) is not kept: the next request tries again.
    p.catch(() => ports.delete(env));
  }
  return p;
}

export default {
  async fetch(req: Request, env: Env, ctx: Ctx): Promise<Response> {
    // The root needs no secrets and no WorkOS, so it is answered before either is touched.
    const pathname = new URL(req.url).pathname;
    if (pathname === '/') return rootResponse(req, env.CHAT_LIVE === 'true');
    // Under /lite/ and not a sign-in route: the gate decides. Anything else that reached here is a
    // path with no asset and no route: a plain 404, decided before sign-in is touched, so a missing page is
    // never answered with a 503 "unavailable" when the sign-in secrets are unbound.
    // `/lite` (no slash) was a redirect to `/lite/` when static assets answered it; it still is.
    if (pathname === '/lite') return Response.redirect(new URL('/lite/', req.url).toString(), 301);
    const session = SESSION_PATHS.has(pathname);
    const gated = isGated(pathname) && !session;
    if (!gated && !session) {
      return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
    }
    if (gated) {
      const assets = env.ASSETS;
      if (!assets) return unavailable(); // no way to serve the page: fail closed, never open
      // The session check is built only when a path needs it: the public pages (privacy, manifest, icons, the
      // service worker, the stylesheets) must not go down with the sign-in secrets. If building it fails the gate
      // answers 503 for the gated page (fail closed); it never serves one.
      return gate(req, {
        check: async (sealed) => (await portFor(env)).check(sealed),
        asset: (r) => assets.fetch(r),
      });
    }
    try {
      const port = await makePort(env);
      const deps: Deps = {
        port,
        now: Date.now,
        randomState,
        waitUntil: (p) => ctx.waitUntil(p),
        async refresh(sid, sealed): Promise<RefreshResult> {
          const ns = env.SESSION_REFRESH;
          if (!ns) return port.refresh(sealed); // local development without the Durable Object
          const res = await ns.get(ns.idFromName(sid)).fetch(
            new Request('https://session/refresh', {
              method: 'POST',
              body: JSON.stringify({ sealed }),
            }),
          );
          if (!res.ok) return { status: 'retry' };
          return (await res.json()) as RefreshResult;
        },
      };
      return await handle(req, deps);
    } catch (err) {
      // Misconfiguration (a secret not bound yet) or an unexpected fault. Say so in the logs, with
      // the message only (never the request, cookies or tokens), and do not touch the cookie.
      console.error('session worker failed:', err instanceof Error ? err.message : 'unknown error');
      // Sign-in itself does NOT redirect back to the app on failure from here: the gate would send it straight
      // back to sign-in, a loop. It answers 503 with a Retry-After, like the two JSON routes.
      if (req.method === 'GET' && (pathname === '/lite/auth/login' || pathname === '/lite/callback')) {
        return unavailable();
      }
      return new Response(JSON.stringify({ error: 'unavailable' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Retry-After': '30' },
      });
    }
  },
};
