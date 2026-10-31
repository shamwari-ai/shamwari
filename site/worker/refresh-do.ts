import { RefreshCoordinator } from "./coordinator";
import { makePort, type WorkerEnv } from "./workos-port";

/**
 * One instance per WorkOS session id. It holds no data worth keeping (the
 * coordinator is in memory; losing it only costs one repeated refresh attempt).
 * It exists to be a single place every refresh for that session passes through.
 *
 * Plain class, not `extends DurableObject`: the runtime needs only the
 * constructor(state, env) and fetch() shape, and this keeps the file free of
 * a types dependency.
 */
export class SessionRefresh {
  private readonly coordinator = new RefreshCoordinator();
  constructor(
    _state: unknown,
    private readonly env: WorkerEnv,
  ) {}

  async fetch(req: Request): Promise<Response> {
    const { sealed } = (await req.json().catch(() => ({}))) as {
      sealed?: unknown;
    };
    if (typeof sealed !== "string" || !sealed)
      return new Response("bad request", { status: 400 });
    const port = await makePort(this.env);
    const result = await this.coordinator.run(sealed, () =>
      port.refresh(sealed),
    );
    return Response.json(result);
  }
}
