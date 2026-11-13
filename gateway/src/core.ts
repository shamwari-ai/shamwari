import { API_TOKEN_HEADER, apiToken } from "./api-token";
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

export async function core<T>(
  env: Env,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  // A short-lived Nyuchi API token for Core to forward on this request. Core holds no standing key
  // for the API; with no token (secrets or exchange unavailable) Core answers 503 and the caller
  // degrades exactly as when Core is down. Never logged, never returned.
  const apiTok = await apiToken(env);
  const res = await fetch(`${env.CORE_URL}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${env.SHAMWARI_CORE_TOKEN}`,
      ...(apiTok ? { [API_TOKEN_HEADER]: apiTok } : {}),
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
    signal: AbortSignal.timeout(CORE_TIMEOUT_MS),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new CoreError(res.status, detail);
  }
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
