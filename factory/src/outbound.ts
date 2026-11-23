import { WorkerEntrypoint } from "cloudflare:workers";
import { egress } from "./egress";
import { gatewayOrigin, type Env } from "./env";

/** Which workspace a container belongs to: its Durable Object id, set by the workspace itself. */
export interface OutboundProps {
  workspace: string;
}

/**
 * Every HTTP and HTTPS request a factory container makes arrives here
 * (workspace-core.ts registers it for both). The rules are in egress.ts. The
 * person's gateway authorisation is read from THEIR workspace, by the id the
 * workspace bound into these props; the container cannot name another.
 */
export class Outbound extends WorkerEntrypoint<Env, OutboundProps> {
  async fetch(request: Request): Promise<Response> {
    const ns = this.env.FACTORY_WORKSPACE;
    const id = ns.idFromString(this.ctx.props.workspace);
    return egress(request, {
      gatewayOrigin: gatewayOrigin(this.env),
      credential: () => ns.get(id).gatewayCredential(),
      fetch: (r) => fetch(r),
    });
  }
}
