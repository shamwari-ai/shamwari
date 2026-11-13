// The Worker holds the Nyuchi API key pair (Secrets Store) and hands Core a short-lived token
// per request. Core holds no standing key. These fail if that arrangement breaks.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  API_TOKEN_HEADER,
  EXCHANGE_TIMEOUT_MS,
  FAILURE_BACKOFF_MS,
  apiToken,
  resetApiTokenCache,
} from "../src/api-token";
import { core } from "../src/core";
import { drain } from "../src/sink";
import type { Env } from "../src/types";

const CLIENT_ID = "nyk_testid";
const CLIENT_SECRET = "nys_TESTSECRETVALUE";

function envWith(over: Record<string, unknown> = {}): Env {
  return {
    CORE_URL: "https://core.invalid",
    SHAMWARI_CORE_TOKEN: "core-token",
    NYUCHI_API_URL: "https://api.invalid",
    SHAMWARI_API_CLIENT_ID: { get: async () => CLIENT_ID },
    SHAMWARI_API_CLIENT_SECRET: { get: async () => CLIENT_SECRET },
    ...over,
  } as unknown as Env;
}

const tokenResponse = (token: string, expiresIn = 3600) =>
  new Response(JSON.stringify({ access_token: token, token_type: "Bearer", expires_in: expiresIn, scope: "shamwari" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

let clock = 1_000_000;
const now = () => clock;

/** Routes the exchange and Core separately; records both. */
function stubNetwork(opts: { exchange?: (n: number) => Response | Promise<Response> } = {}) {
  const exchanges: { url: string; body: URLSearchParams; headers: Record<string, string> }[] = [];
  const coreCalls: { url: string; headers: Record<string, string> }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const headers = (init.headers ?? {}) as Record<string, string>;
      if (String(url).endsWith("/v1/auth/token")) {
        exchanges.push({ url: String(url), body: new URLSearchParams(String(init.body)), headers });
        return (opts.exchange ?? (() => tokenResponse(`tok-${exchanges.length}`)))(exchanges.length);
      }
      coreCalls.push({ url: String(url), headers });
      return new Response('{"ok":true}', { status: 200 });
    }),
  );
  return { exchanges, coreCalls };
}

beforeEach(() => {
  clock = 1_000_000;
  resetApiTokenCache();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the token exchange", () => {
  it("is a standard client_credentials form POST to the API, with the pair in the body", async () => {
    const net = stubNetwork();
    expect(await apiToken(envWith(), now)).toBe("tok-1");
    const x = net.exchanges[0]!;
    expect(x.url).toBe("https://api.invalid/v1/auth/token");
    expect(Object.fromEntries(x.body)).toEqual({
      grant_type: "client_credentials",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    });
    expect(x.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    // Credentials in headers would be read by the API as a call, not as an exchange.
    expect(Object.keys(x.headers).map((h) => h.toLowerCase())).not.toContain("x-client-secret");
  });

  it("uses a timeout so a hung API cannot hold a chat request", async () => {
    stubNetwork();
    await apiToken(envWith(), now);
    const init = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(EXCHANGE_TIMEOUT_MS).toBeLessThanOrEqual(3000);
  });

  it("is cached, and a second call within the lifetime makes no exchange", async () => {
    const net = stubNetwork();
    const env = envWith();
    expect(await apiToken(env, now)).toBe("tok-1");
    clock += 60_000;
    expect(await apiToken(env, now)).toBe("tok-1");
    expect(net.exchanges).toHaveLength(1);
  });

  it("refreshes before the token expires, not after", async () => {
    const net = stubNetwork();
    const env = envWith();
    await apiToken(env, now); // expires_in 3600 s
    clock += 3600 * 1000 - 30_000 - 1; // 1 ms inside the margin's edge
    expect(await apiToken(env, now)).toBe("tok-1");
    clock += 2; // now inside the refresh margin: the old token still has 30 s to live, but is not used
    expect(await apiToken(env, now)).toBe("tok-2");
    expect(net.exchanges).toHaveLength(2);
  });

  it("makes one exchange for any number of concurrent requests", async () => {
    let release!: (r: Response) => void;
    const net = stubNetwork({ exchange: () => new Promise<Response>((r) => (release = r)) });
    const env = envWith();
    const all = Promise.all([apiToken(env, now), apiToken(env, now), apiToken(env, now), apiToken(env, now)]);
    await vi.waitFor(() => expect(net.exchanges).toHaveLength(1));
    release(tokenResponse("shared"));
    expect(await all).toEqual(["shared", "shared", "shared", "shared"]);
    expect(net.exchanges).toHaveLength(1);
  });

  it("does not reuse a token issued for a key pair that has since been rotated", async () => {
    const net = stubNetwork();
    await apiToken(envWith(), now);
    const rotated = envWith({ SHAMWARI_API_CLIENT_ID: { get: async () => "nyk_rotated" } });
    expect(await apiToken(rotated, now)).toBe("tok-2");
    expect(net.exchanges[1]!.body.get("client_id")).toBe("nyk_rotated");
  });
});

describe("when the token cannot be had", () => {
  it("returns null, never throws, without a key pair", async () => {
    const net = stubNetwork();
    expect(await apiToken(envWith({ SHAMWARI_API_CLIENT_ID: undefined }), now)).toBeNull();
    expect(await apiToken(envWith({ SHAMWARI_API_CLIENT_SECRET: undefined }), now)).toBeNull();
    expect(await apiToken(envWith({ SHAMWARI_API_CLIENT_ID: { get: async () => null } }), now)).toBeNull();
    expect(net.exchanges).toHaveLength(0);
  });

  it("returns null when the Secrets Store throws", async () => {
    stubNetwork();
    const env = envWith({
      SHAMWARI_API_CLIENT_SECRET: {
        get: async () => {
          throw new Error(`store down ${CLIENT_SECRET}`);
        },
      },
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await apiToken(env, now)).toBeNull();
    expect(JSON.stringify(warn.mock.calls)).not.toContain(CLIENT_SECRET);
  });

  it.each([
    ["a refusal", () => new Response('{"error":"invalid_client"}', { status: 401 })],
    ["a server error", () => new Response("boom", { status: 502 })],
    ["a body without a token", () => new Response("{}", { status: 200 })],
    ["a body that is not JSON", () => new Response("<html>", { status: 200 })],
    ["a token that is already expired", () => tokenResponse("t", 0)],
  ])("returns null on %s, and caches nothing", async (_n, exchange) => {
    stubNetwork({ exchange });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await apiToken(envWith(), now)).toBeNull();
  });

  it("returns null when the network fails, and does not hammer the API afterwards", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("down"))));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const env = envWith();
    expect(await apiToken(env, now)).toBeNull();
    expect(await apiToken(env, now)).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
    clock += FAILURE_BACKOFF_MS + 1;
    await apiToken(env, now);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("never serves an old token after a failed refresh", async () => {
    let fail = false;
    stubNetwork({ exchange: () => (fail ? new Response("x", { status: 500 }) : tokenResponse("old", 60)) });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const env = envWith();
    expect(await apiToken(env, now)).toBe("old");
    fail = true;
    clock += 31_000; // inside the refresh margin of a 60 s token
    expect(await apiToken(env, now)).toBeNull();
  });
});

describe("core() hands Core the token and nothing else about the API", () => {
  it("sends the fresh token in the header, beside the Core bearer", async () => {
    const net = stubNetwork();
    await core(envWith(), "/ground/search", { method: "POST", body: { q: "x" } });
    const h = net.coreCalls[0]!.headers;
    expect(h[API_TOKEN_HEADER]).toBe("tok-1");
    expect(h.Authorization).toBe("Bearer core-token");
  });

  it("never sends the key pair to Core", async () => {
    const net = stubNetwork();
    await core(envWith(), "/guardrails");
    const sent = JSON.stringify(net.coreCalls);
    expect(sent).not.toContain(CLIENT_SECRET);
    expect(sent).not.toContain(CLIENT_ID);
  });

  it("calls Core with no token header when none can be had, so Core answers 503 itself", async () => {
    const net = stubNetwork({ exchange: () => new Response("x", { status: 500 }) });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await core(envWith(), "/guardrails");
    expect(net.coreCalls).toHaveLength(1);
    expect(Object.keys(net.coreCalls[0]!.headers)).not.toContain(API_TOKEN_HEADER);
  });

  it("calls Core with no token header when the secrets are not bound", async () => {
    const net = stubNetwork();
    await core(envWith({ SHAMWARI_API_CLIENT_ID: undefined, SHAMWARI_API_CLIENT_SECRET: undefined }), "/guardrails");
    expect(Object.keys(net.coreCalls[0]!.headers)).not.toContain(API_TOKEN_HEADER);
    expect(net.exchanges).toHaveLength(0);
  });

  it("never logs the token or the secret, on success or on a Core failure", async () => {
    const logs: unknown[] = [];
    for (const m of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void logs.push(a));
    }
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        String(url).endsWith("/v1/auth/token")
          ? tokenResponse("TOKEN-VALUE-XYZ")
          : new Response("core said no", { status: 503 }),
      ),
    );
    await expect(core(envWith(), "/guardrails")).rejects.toThrow();
    const text = JSON.stringify(logs);
    expect(text).not.toContain("TOKEN-VALUE-XYZ");
    expect(text).not.toContain(CLIENT_SECRET);
  });
});

describe("the sink queue consumer hands Core the token too", () => {
  const batch = {
    messages: [{ body: { database: "shamwari", collection: "usage", doc: { a: 1 } } }],
  } as unknown as MessageBatch<import("../src/types").SinkMessage>;

  it("sends the token with the batch", async () => {
    const net = stubNetwork();
    await drain(batch, envWith());
    expect(net.coreCalls[0]!.url).toBe("https://core.invalid/sink/bulk");
    expect(net.coreCalls[0]!.headers[API_TOKEN_HEADER]).toBe("tok-1");
  });

  it("sends none when it cannot get one, so Core answers 503 and the batch is retried", async () => {
    const net = stubNetwork({ exchange: () => new Response("x", { status: 500 }) });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await drain(batch, envWith());
    expect(Object.keys(net.coreCalls[0]!.headers)).not.toContain(API_TOKEN_HEADER);
  });
});
