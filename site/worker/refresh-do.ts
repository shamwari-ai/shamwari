import { RefreshCoordinator, type CoordinatorSnapshot } from './coordinator';
import { makePort, type Port, type WorkerEnv } from './workos-port';

/**
 * One instance per WorkOS session id: the single place every refresh for that session passes
 * through. Plain class, not `extends DurableObject`: the runtime needs only the
 * constructor(state, env) and fetch() shape, and this keeps the file free of a types dependency.
 *
 * Its last result is also written to the object's storage. A refresh token is single-use, so a
 * second tab that still holds the OLD cookie must be answered with the first tab's result; if the
 * object were evicted or restarted inside the reuse window and kept that only in memory, the
 * second tab would spend a dead token and be signed out. Only a hash of the old cookie is stored
 * as the key. The result holds the new sealed cookie (encrypted) and a 5-minute access token,
 * and is overwritten by the next refresh.
 */
export interface DurableStorageLike {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
}

const LAST = 'last';

async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

export class SessionRefresh {
  private readonly coordinator = new RefreshCoordinator();
  constructor(
    private readonly state: { storage: DurableStorageLike },
    private readonly env: WorkerEnv,
    private readonly makeP: (env: WorkerEnv) => Promise<Port> = makePort,
  ) {}

  async fetch(req: Request): Promise<Response> {
    const { sealed } = (await req.json().catch(() => ({}))) as { sealed?: unknown };
    if (typeof sealed !== 'string' || !sealed) return new Response('bad request', { status: 400 });
    this.coordinator.restore((await this.state.storage.get(LAST)) as CoordinatorSnapshot | undefined);
    const port = await this.makeP(this.env);
    const result = await this.coordinator.run(await sha256Hex(sealed), () => port.refresh(sealed));
    const snap = this.coordinator.snapshot();
    // Only a success is worth keeping (the coordinator reuses nothing else).
    if (snap && snap.result.status === 'ok') await this.state.storage.put(LAST, snap);
    return Response.json(result);
  }
}
