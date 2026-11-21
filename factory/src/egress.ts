/**
 * Everything the container sends over HTTP (port 80) or HTTPS (port 443)
 * arrives here, through the `Outbound` entrypoint (outbound.ts); the
 * container starts with `enableInternet: false`, so no other port has a route
 * at all. Pure, so test/egress.test.ts can hold every rule.
 *
 * Two destinations, HTTPS only:
 *
 *  - The Shamwari gateway, on the two inference paths only. The Worker sets
 *    the person's own gateway authorisation here; the container never holds
 *    it. The request is marked as Factory traffic so the gateway records it
 *    as such, and every Shamwari header the container sent is dropped first,
 *    so the container cannot claim to be another channel or another person.
 *    The scope is not set here: the gateway decides it (gateway/src/scope.ts
 *    `resolveScope`), and its Rule 1 gate runs on this request exactly as on
 *    any other.
 *  - github.com, so Git can clone and push. Nothing is added to the request.
 *
 * Everything else, including every inference provider and OpenCode's own
 * hosted service, the npm registry and other GitHub hostnames, is refused
 * with 403 and never fetched.
 */

/** The inference paths the factory may call on the gateway. */
export const GATEWAY_PATHS: readonly string[] = [
  "/v1/chat/completions",
  // The Open Responses endpoint (proposed in shamwari#326). Allowed so the
  // factory needs no change when it lands; until then the gateway answers 404.
  "/v1/responses",
];

export const GIT_HOST = "github.com";

/** Marks factory traffic. The gateway treats any X-Shamwari-Channel as a channel: never trainable (conversationTrainable). */
export const CHANNEL_HEADER = "X-Shamwari-Channel";
export const CHANNEL_VALUE = "factory";

/** Headers the container may not choose for a gateway request. */
const STRIPPED = [
  "authorization",
  "proxy-authorization",
  "cookie",
  "x-api-key",
  "idempotency-key",
];
const STRIPPED_PREFIXES = ["x-shamwari-", "cf-aig-", "cf-"];

export interface EgressDeps {
  /** e.g. https://api.shamwari.ai */
  gatewayOrigin: string;
  /** The person's current gateway authorisation, or null when there is none to give. */
  credential(): Promise<string | null>;
  /** The real network. */
  fetch(req: Request): Promise<Response>;
}

const refuse = (status: number, message: string): Response =>
  new Response(`${message}\n`, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });

/** Lower-case, without the trailing dot a resolver would also accept. */
export function hostOf(url: URL): string {
  return url.hostname.toLowerCase().replace(/\.+$/, "");
}

export async function egress(
  request: Request,
  deps: EgressDeps,
): Promise<Response> {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return refuse(400, "bad request");
  }
  // The Worker fetches with the scheme the container used, so a credential
  // set on plain HTTP would cross the Internet unencrypted.
  if (url.protocol !== "https:") {
    return refuse(403, `${url.hostname} is reachable only over HTTPS`);
  }
  // Only the default port. A URL with userinfo is refused outright.
  if (url.port !== "" || url.username !== "" || url.password !== "") {
    return refuse(403, `${url.host} is not reachable from this workspace`);
  }
  const host = hostOf(url);
  const gateway = new URL(deps.gatewayOrigin);

  if (host === hostOf(gateway)) {
    if (request.method !== "POST" || !GATEWAY_PATHS.includes(url.pathname)) {
      return refuse(403, `${url.pathname} is not an inference path`);
    }
    const credential = await deps.credential();
    if (!credential) {
      // Nothing reaches the gateway without the person's own authorisation.
      return new Response(
        JSON.stringify({
          error: {
            message:
              "Your Shamwari sign-in has lapsed. Open the factory in your browser to continue.",
            type: "factory_signed_out",
          },
        }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
    }
    const headers = new Headers();
    for (const [k, v] of request.headers) {
      const name = k.toLowerCase();
      if (STRIPPED.includes(name)) continue;
      if (STRIPPED_PREFIXES.some((p) => name.startsWith(p))) continue;
      headers.set(k, v);
    }
    headers.set("Authorization", `Bearer ${credential}`);
    headers.set(CHANNEL_HEADER, CHANNEL_VALUE);
    // Always the configured origin, never a host the container spelled.
    const target = new URL(url.pathname + url.search, gateway.origin);
    return deps.fetch(
      new Request(target.toString(), {
        method: "POST",
        headers,
        // Buffered: a chat request is small, and a stream body would need
        // runtime-specific options to forward.
        body: await request.arrayBuffer(),
        redirect: "manual",
      }),
    );
  }

  if (host === GIT_HOST) {
    return deps.fetch(request);
  }

  return refuse(403, `${url.hostname} is not reachable from this workspace`);
}
