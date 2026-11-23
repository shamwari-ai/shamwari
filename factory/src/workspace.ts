import { Files } from "@cloudflare/sandbox";
import { DurableObject } from "cloudflare:workers";
import { gatewayOrigin, type Env } from "./env";
import type { OutboundProps } from "./outbound";
import { INACTIVITY_TIMEOUT_MS, WorkspaceCore } from "./workspace-core";

/**
 * One per signed-in person, reached ONLY as
 * `env.FACTORY_WORKSPACE.getByName(workspaceName(<verified WorkOS user id>))`
 * (router.ts). It owns that person's container. All logic is in
 * workspace-core.ts; this class wires it to the runtime.
 */
export class FactoryWorkspace extends DurableObject<Env> {
  private readonly core: WorkspaceCore;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const container = ctx.container;
    if (!container) throw new Error("No container is configured");
    // A restarted Durable Object sets the inactivity timeout again.
    if (container.running) {
      void ctx.blockConcurrencyWhile(() =>
        container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS),
      );
    }
    const props: OutboundProps = { workspace: ctx.id.toString() };
    const exportsWithOutbound = ctx.exports as unknown as {
      Outbound(options: { props: OutboundProps }): Fetcher;
    };
    this.core = new WorkspaceCore({
      container,
      storage: ctx.storage,
      outbound: exportsWithOutbound.Outbound({ props }),
      files: new Files(container),
      gatewayOrigin: gatewayOrigin(env),
      now: Date.now,
      wait: (ms) => scheduler.wait(ms),
    });
  }

  async fetch(request: Request): Promise<Response> {
    return this.core.fetch(request);
  }

  async setGatewayCredential(token: string, expiresAt: number): Promise<void> {
    return this.core.setGatewayCredential(token, expiresAt);
  }

  async gatewayCredential(): Promise<string | null> {
    return this.core.gatewayCredential();
  }
}
