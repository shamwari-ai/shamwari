import { handle, type Deps, type RefreshResult } from './session';
import { rootResponse } from './root';
import { makePort, type WorkerEnv } from './workos-port';

export { SessionRefresh } from './refresh-do';

/**
 * Entry point of the `shamwari-app` Worker. Static assets answer everything
 * except the routes listed in `assets.run_worker_first` (wrangler.app.jsonc);
 * only those reach this file.
 */
interface Ctx {
  waitUntil(p: Promise<unknown>): void;
}

/** The only paths (besides the root) that reach this Worker on purpose: `assets.run_worker_first`.
 *  test/worker/root.test.ts fails if this and wrangler.app.jsonc disagree. */
export const SESSION_PATHS = new Set(['/lite/auth/login', '/lite/auth/token', '/lite/auth/logout', '/lite/callback']);

function randomState(): string {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export default {
  async fetch(req: Request, env: WorkerEnv, ctx: Ctx): Promise<Response> {
    // The root needs no secrets and no WorkOS, so it is answered before either is touched.
    const pathname = new URL(req.url).pathname;
    if (pathname === '/') return rootResponse(req, env.CHAT_LIVE === 'true');
    // Anything else that reached here is a path with no asset and no route (static assets send those
    // to the Worker). It is a plain 404, decided before sign-in is touched: with the sign-in secrets
    // unbound, sending it there would answer a missing page with a 503 "unavailable".
    if (!SESSION_PATHS.has(pathname)) {
      return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
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
      // A browser navigating to sign-in lands back on the app with a reason, not on a JSON blob.
      if (req.method === 'GET' && (pathname === '/lite/auth/login' || pathname === '/lite/callback')) {
        return new Response(null, {
          status: 302,
          headers: { Location: '/lite/?signin=failed', 'Cache-Control': 'no-store' },
        });
      }
      return new Response(JSON.stringify({ error: 'unavailable' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Retry-After': '30' },
      });
    }
  },
};
