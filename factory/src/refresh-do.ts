import { DurableObject } from "cloudflare:workers";
import { RefreshCoordinator, type CoordinatorSnapshot } from "./coordinator";
import type { RefreshResult } from "./session";
import { makePort } from "./workos-port";
import type { Env } from "./env";

/**
 * One instance per WorkOS session id: every refresh of the factory's session
 * cookie for that session passes through here, one at a time (refresh tokens
 * are single-use). The same design as site/worker/refresh-do.ts. Its last
 * successful result is kept in storage under a hash of the old cookie, so a
 * second tab still holding that cookie gets the same answer after a restart.
 */
const LAST = "last";

async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(d), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

export class FactorySessionRefresh extends DurableObject<Env> {
  private readonly coordinator = new RefreshCoordinator();

  async refresh(sealed: string): Promise<RefreshResult> {
    this.coordinator.restore(
      await this.ctx.storage.get<CoordinatorSnapshot>(LAST),
    );
    const port = await makePort(this.env);
    const result = await this.coordinator.run(await sha256Hex(sealed), () =>
      port.refresh(sealed),
    );
    const snap = this.coordinator.snapshot();
    if (snap && snap.result.status === "ok")
      await this.ctx.storage.put(LAST, snap);
    return result;
  }
}
