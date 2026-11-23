import type { Env } from "./types";

/**
 * Client for Shamwari Core, the service that owns MongoDB.
 *
 * The Worker holds no database credentials. Core runs on Nyuchi
 * infrastructure, which is also why scope enforcement lives there —
 * it needs to be somewhere Cloudflare cannot see.
 */
/**
 * How long a Core call may take before it counts as down. Core answers a Ground search in well
 * under this; without a limit a Fly app that accepts the connection and then hangs would hold every
 * chat request until the page's own 45 s limit and show "offline" instead of answering ungrounded.
 */
export const CORE_TIMEOUT_MS = 4000;

/**
 * THE BREAKER. Once Core has failed to answer (no connection, the timeout above, or a 5xx), the
 * calls after it in this isolate skip Core for this long and fail at once, instead of each waiting
 * out the timeout. A chat request makes two Core calls (the quota rollup and the Ground search), so
 * with Core down every question used to pay up to 8 s before it was answered ungrounded.
 *
 * Skipping is NOT "Core said nothing": a skipped call throws a CoreError with status 503, exactly
 * what a down Core gives, so every caller keeps its own meaning for it. Ground is "unavailable"
 * (never "no passage"), a question that needs the person's own information still gets no model
 * (rule 1, index.ts), the quota check still fails open, and a key is still not verified. A 4xx is
 * Core answering (a scope refusal, a bad key), so it never opens the breaker; any answer closes it.
 */
export const CORE_COOLDOWN_MS = 30_000;
let downUntil = 0;

/** True while the breaker is open. */
export const coreDown = (now = Date.now()): boolean => now < downUntil;

/** For tests: close the breaker. */
export function resetCoreBreaker(): void {
  downUntil = 0;
}

export async function core<T>(
  env: Env,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  if (coreDown()) throw new CoreError(503, "core_unavailable: skipped while the breaker is open");
  let res: Response;
  try {
    res = await fetch(`${env.CORE_URL}${path}`, {
      method: init.method ?? "GET",
      headers: {
        Authorization: `Bearer ${env.SHAMWARI_CORE_TOKEN}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
      ...(init.body ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(CORE_TIMEOUT_MS),
    });
  } catch (e) {
    downUntil = Date.now() + CORE_COOLDOWN_MS;
    throw e;
  }

  if (!res.ok) {
    if (res.status >= 500) downUntil = Date.now() + CORE_COOLDOWN_MS;
    else downUntil = 0;
    const detail = await res.text();
    throw new CoreError(res.status, detail);
  }
  downUntil = 0;
  return (await res.json()) as T;
}

export class CoreError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(`core ${status}: ${detail}`);
  }
}
