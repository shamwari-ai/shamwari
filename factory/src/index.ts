import { route, type WorkspaceStub } from "./router";
import type { Env } from "./env";
import type { RefreshResult } from "./session";
import { makePort, type Port } from "./workos-port";

export { FactoryWorkspace } from "./workspace";
export { FactorySessionRefresh } from "./refresh-do";
export { Outbound } from "./outbound";

/**
 * Entry point of the `shamwari-factory` Worker. See router.ts for the request
 * path and README.md for what is (not) switched on.
 */
function randomState(): string {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

const ports = new WeakMap<object, Promise<Port>>();
function portFor(env: Env): Promise<Port> {
  let p = ports.get(env);
  if (!p) {
    p = makePort(env);
    ports.set(env, p);
    p.catch(() => ports.delete(env));
  }
  return p;
}

export default {
  async fetch(
    req: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    return route(req, {
      async auth() {
        const port = await portFor(env);
        return {
          port,
          randomState,
          waitUntil: (p) => ctx.waitUntil(p),
          check: (sealed) => port.check(sealed),
          now: Date.now,
          refresh: (sid, sealed): Promise<RefreshResult> =>
            env.FACTORY_SESSION_REFRESH.getByName(sid).refresh(sealed),
        };
      },
      workspace: (name): WorkspaceStub => env.FACTORY_WORKSPACE.getByName(name),
    });
  },
} satisfies ExportedHandler<Env>;
