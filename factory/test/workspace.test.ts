import { describe, expect, it } from "vitest";
import { opencodeEnv } from "../src/opencode";
import {
  INACTIVITY_TIMEOUT_MS,
  INSTANCE,
  WorkspaceCore,
} from "../src/workspace-core";

const GATEWAY = "https://api.shamwari.ai";
const ORIGIN = "https://factory.example.test";

type Event = { kind: string; detail?: unknown };

function fake(opts: { caFails?: boolean } = {}) {
  const events: Event[] = [];
  const store = new Map<string, unknown>();
  const portRequests: Request[] = [];
  let running = false;
  let now = 1_800_000_000_000;
  const outbound = { name: "outbound" } as unknown as Fetcher;
  const port = {
    async fetch(input: RequestInfo, init?: RequestInit) {
      const r = input instanceof Request ? input : new Request(input, init);
      portRequests.push(r);
      return new Response("from opencode", { status: 200 });
    },
  } as unknown as Fetcher;
  const container = {
    get running() {
      return running;
    },
    images: { factory: "registry.example/factory@sha256:abc" },
    start(o: unknown) {
      running = true;
      events.push({ kind: "start", detail: o });
    },
    async destroy() {
      running = false;
      events.push({ kind: "destroy" });
    },
    async interceptAllOutboundHttp(b: Fetcher) {
      events.push({ kind: "intercept-http", detail: b });
    },
    async interceptOutboundHttps(addr: string, b: Fetcher) {
      events.push({ kind: "intercept-https", detail: { addr, b } });
    },
    async setInactivityTimeout(ms: number) {
      events.push({ kind: "timeout", detail: ms });
    },
    getTcpPort(n: number) {
      events.push({ kind: "port", detail: n });
      return port;
    },
    async exec(argv: string[], o?: { env?: Record<string, string> }) {
      events.push({ kind: "exec", detail: { argv, env: o?.env } });
      const isCa = argv[0] === "timeout";
      const code = isCa && opts.caFails ? 124 : isCa ? 0 : 1;
      return {
        exitCode: Promise.resolve(code),
        output: async () => ({
          exitCode: code,
          stdout: new Uint8Array(),
          stderr: new Uint8Array(),
        }),
      };
    },
  } as unknown as Container;
  const core = new WorkspaceCore({
    container,
    outbound,
    storage: {
      async get<T>(k: string) {
        return store.get(k) as T | undefined;
      },
      async put<T>(k: string, v: T) {
        store.set(k, v);
      },
    },
    files: { mkdir: async () => undefined },
    gatewayOrigin: GATEWAY,
    now: () => now,
    wait: async () => undefined,
  });
  return {
    core,
    events,
    outbound,
    portRequests,
    advance: (ms: number) => (now += ms),
    store,
  };
}

describe("the container: no Internet, every request through the Worker", () => {
  it("starts with enableInternet false, on standard-1, and no environment", async () => {
    const f = fake();
    await f.core.fetch(new Request(`${ORIGIN}/session`));
    const start = f.events.find((e) => e.kind === "start")!.detail as Record<
      string,
      unknown
    >;
    expect(start.enableInternet).toBe(false);
    expect(start.instance).toBe(INSTANCE);
    expect(start.env).toBeUndefined();
  });

  it("routes HTTP and every HTTPS host to the Outbound entrypoint before OpenCode starts", async () => {
    const f = fake();
    await f.core.fetch(new Request(`${ORIGIN}/session`));
    const kinds = f.events.map((e) => e.kind);
    const http = kinds.indexOf("intercept-http");
    const https = kinds.indexOf("intercept-https");
    const serve = f.events.findIndex(
      (e) => e.kind === "exec" && JSON.stringify(e.detail).includes("opencode"),
    );
    expect(http).toBeGreaterThan(-1);
    expect(https).toBeGreaterThan(-1);
    expect(serve).toBeGreaterThan(Math.max(http, https));
    expect(f.events[http]!.detail).toBe(f.outbound);
    expect(f.events[https]!.detail).toEqual({ addr: "*", b: f.outbound });
    expect(f.events.find((e) => e.kind === "timeout")!.detail).toBe(
      INACTIVITY_TIMEOUT_MS,
    );
  });

  it("a container whose intercept is not ready is destroyed, never used", async () => {
    const f = fake({ caFails: true });
    await expect(
      f.core.fetch(new Request(`${ORIGIN}/session`)),
    ).rejects.toThrow();
    expect(f.events.some((e) => e.kind === "destroy")).toBe(true);
    expect(
      f.events.some(
        (e) => e.kind === "exec" && JSON.stringify(e.detail).includes("serve"),
      ),
    ).toBe(false);
  });

  it("OpenCode runs with exactly the tested environment, and the person's token is never in it", async () => {
    const f = fake();
    await f.core.setGatewayCredential("person-token-abc", 1_800_000_900);
    await f.core.fetch(new Request(`${ORIGIN}/session`));
    const execs = f.events.filter((e) => e.kind === "exec");
    const serve = execs.find((e) =>
      JSON.stringify(e.detail).includes("serve"),
    )!;
    expect((serve.detail as { env: unknown }).env).toEqual(
      opencodeEnv(GATEWAY),
    );
    for (const e of f.events) {
      expect(JSON.stringify(e.detail ?? null)).not.toContain(
        "person-token-abc",
      );
    }
  });
});

describe("the OpenCode UI at the root of the hostname", () => {
  it("a page load without ?url= is sent back with this origin", async () => {
    const f = fake();
    const r = await f.core.fetch(
      new Request(`${ORIGIN}/`, { headers: { Accept: "text/html" } }),
    );
    expect(r.status).toBe(302);
    expect(new URL(r.headers.get("Location")!).searchParams.get("url")).toBe(
      ORIGIN,
    );
    expect(f.events.some((e) => e.kind === "start")).toBe(false);
  });

  it("a page load pointing the UI at another server is corrected", async () => {
    const f = fake();
    const r = await f.core.fetch(
      new Request(`${ORIGIN}/?url=https://evil.test`, {
        headers: { Accept: "text/html" },
      }),
    );
    expect(r.status).toBe(302);
    expect(new URL(r.headers.get("Location")!).searchParams.get("url")).toBe(
      ORIGIN,
    );
  });

  it("everything else is proxied to the container's OpenCode port over http", async () => {
    const f = fake();
    const r = await f.core.fetch(
      new Request(`${ORIGIN}/?url=${encodeURIComponent(ORIGIN)}`, {
        headers: { Accept: "text/html" },
      }),
    );
    expect(await r.text()).toBe("from opencode");
    await f.core.fetch(new Request(`${ORIGIN}/session/abc/message`));
    const urls = f.portRequests
      .map((p) => p.url)
      .filter((u) => !u.startsWith("http://opencode/"));
    expect(urls).toContain("http://factory.example.test/session/abc/message");
    expect(f.events.filter((e) => e.kind === "start")).toHaveLength(1);
  });
});

describe("the gateway credential held for the Outbound entrypoint", () => {
  it("is handed out while valid and withheld once it lapses", async () => {
    const f = fake();
    expect(await f.core.gatewayCredential()).toBeNull();
    await f.core.setGatewayCredential("t1", 1_800_000_000 + 300);
    expect(await f.core.gatewayCredential()).toBe("t1");
    f.advance(280_000);
    expect(await f.core.gatewayCredential()).toBeNull();
  });
});
