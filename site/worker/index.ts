import { handle, type Deps, type RefreshResult } from "./session";
import { makePort, type WorkerEnv } from "./workos-port";

export { SessionRefresh } from "./refresh-do";

/**
 * Entry point of the `shamwari-app` Worker. Static assets answer everything
 * except the routes listed in `assets.run_worker_first` (wrangler.app.jsonc);
 * only those reach this file.
 */
interface Ctx {
  waitUntil(p: Promise<unknown>): void;
}

function randomState(): string {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export default {
  async fetch(req: Request, env: WorkerEnv, ctx: Ctx): Promise<Response> {
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
          const res = await ns
            .get(ns.idFromName(sid))
            .fetch(
              new Request("https://session/refresh", {
                method: "POST",
                body: JSON.stringify({ sealed }),
              }),
            );
          if (!res.ok) return { status: "retry" };
          return (await res.json()) as RefreshResult;
        },
      };
      return await handle(req, deps);
    } catch {
      // Misconfiguration or an unexpected fault: say so, and do not touch the cookie.
      return new Response(JSON.stringify({ error: "unavailable" }), {
        status: 503,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
          "Retry-After": "30",
        },
      });
    }
  },
};
