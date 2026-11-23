import { describe, expect, it } from "vitest";
import { CHANNEL_HEADER, egress, type EgressDeps } from "../src/egress";

const GATEWAY = "https://api.shamwari.ai";
const TOKEN = "person-token-abc";

function harness(credential: string | null = TOKEN) {
  const sent: Request[] = [];
  const d: EgressDeps = {
    gatewayOrigin: GATEWAY,
    credential: async () => credential,
    fetch: async (r) => {
      sent.push(r);
      return new Response("upstream", { status: 200 });
    },
  };
  return { d, sent };
}

const chat = (
  url = `${GATEWAY}/v1/chat/completions`,
  headers: HeadersInit = {},
) =>
  new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({
      model: "shamwari-standard",
      messages: [],
      stream: true,
    }),
  });

describe("the gateway: the person's authorisation is set in the Worker", () => {
  it("replaces the placeholder key with the person's token and marks the channel", async () => {
    const { d, sent } = harness();
    const r = await egress(
      chat(undefined, { Authorization: "Bearer provided-by-worker" }),
      d,
    );
    expect(r.status).toBe(200);
    const s = sent[0]!;
    expect(s.url).toBe(`${GATEWAY}/v1/chat/completions`);
    expect(s.headers.get("Authorization")).toBe(`Bearer ${TOKEN}`);
    expect(s.headers.get(CHANNEL_HEADER)).toBe("factory");
    expect(JSON.parse(await s.text()).model).toBe("shamwari-standard");
  });

  it("drops every Shamwari, AI Gateway and credential header the container sent", async () => {
    const { d, sent } = harness();
    await egress(
      chat(undefined, {
        "X-Shamwari-Channel": "pwa",
        "X-Shamwari-Scope": "platform",
        "cf-aig-authorization": "Bearer stolen",
        "x-api-key": "k",
        Cookie: "a=b",
        "Idempotency-Key": "replay-someone",
      }),
      d,
    );
    const h = sent[0]!.headers;
    expect(h.get(CHANNEL_HEADER)).toBe("factory");
    expect(h.get("X-Shamwari-Scope")).toBeNull();
    expect(h.get("cf-aig-authorization")).toBeNull();
    expect(h.get("x-api-key")).toBeNull();
    expect(h.get("Cookie")).toBeNull();
    expect(h.get("Idempotency-Key")).toBeNull();
  });

  it("allows the Open Responses path too", async () => {
    const { d, sent } = harness();
    const r = await egress(chat(`${GATEWAY}/v1/responses`), d);
    expect(r.status).toBe(200);
    expect(sent).toHaveLength(1);
  });

  it("refuses other gateway paths and methods", async () => {
    const { d, sent } = harness();
    for (const req of [
      new Request(`${GATEWAY}/v1/chat/completions`),
      chat(`${GATEWAY}/v1/ground/context`),
      chat(`${GATEWAY}/v1/channels/sms`),
      chat(`${GATEWAY}/health`),
    ]) {
      expect((await egress(req, d)).status).toBe(403);
    }
    expect(sent).toHaveLength(0);
  });

  it("with no current sign-in, nothing reaches the gateway", async () => {
    const { d, sent } = harness(null);
    const r = await egress(chat(), d);
    expect(r.status).toBe(401);
    expect(sent).toHaveLength(0);
  });
});

describe("the allow-list: anything but the gateway and github.com is refused", () => {
  it("passes github.com through untouched", async () => {
    const { d, sent } = harness();
    const req = new Request(
      "https://github.com/octocat/Hello-World.git/info/refs?service=git-upload-pack",
    );
    expect((await egress(req, d)).status).toBe(200);
    expect(sent[0]).toBe(req);
    expect(sent[0]!.headers.get("Authorization")).toBeNull();
  });

  const denied = [
    // inference providers and OpenCode's own hosted models
    "https://api.openai.com/v1/chat/completions",
    "https://api.anthropic.com/v1/messages",
    "https://opencode.ai/inference/openai/v1/chat/completions",
    "https://gateway.ai.cloudflare.com/v1/x/y/compat/chat/completions",
    "https://openrouter.ai/api/v1/chat/completions",
    "https://api.z.ai/api/paas/v4/chat/completions",
    // package registries, model lists, other GitHub hosts
    "https://registry.npmjs.org/@opencode-ai/plugin",
    "https://models.dev/api.json",
    "https://api.github.com/repos/a/b",
    "https://raw.githubusercontent.com/a/b/main/x",
    "https://objects.githubusercontent.com/x",
    "https://codeload.github.com/a/b/zip/main",
    // look-alikes
    "https://github.com.evil.test/a",
    "https://evil.test/github.com",
    "https://api.shamwari.ai.evil.test/v1/chat/completions",
    "https://evil.test/v1/chat/completions?host=api.shamwari.ai",
    // the right hosts, the wrong way
    "http://github.com/a/b",
    "http://api.shamwari.ai/v1/chat/completions",
    "https://github.com:8443/a/b",
  ];
  for (const url of denied) {
    it(`refuses ${url}`, async () => {
      const { d, sent } = harness();
      const r = await egress(
        new Request(url, { method: "POST", body: "{}" }),
        d,
      );
      expect(r.status).toBe(403);
      expect(sent).toHaveLength(0);
    });
  }

  it("treats a trailing dot and upper case as the same host", async () => {
    const { d, sent } = harness();
    expect(
      (await egress(new Request("https://GitHub.com./a/b"), d)).status,
    ).toBe(200);
    expect(sent).toHaveLength(1);
  });
});
