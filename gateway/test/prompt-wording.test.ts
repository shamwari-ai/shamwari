// The AI Gateway's prompt-injection guard (P1: BLOCK) rejected our system prompt with a 424 on every
// request when it opened "You are Shamwari" and used the old "must be verified" sentence. Keep both out,
// and keep the reasoning budget low so the reasoning model has tokens left to answer.
import { describe, expect, it, vi, afterEach } from "vitest";
import { ground } from "../src/ground";
import { viaGateway, viaWorkersAI } from "../src/gateway";
import { targets } from "../src/router";
import type { Env, Message } from "../src/types";

const messages: Message[] = [{ role: "user", content: "hi" }];

function env(run: unknown) {
  return {
    AI: { run },
    CF_ACCOUNT_ID: "a",
    CF_GATEWAY_ID: "g",
    CF_ROUTE_NAME: "shamwari",
    CF_AIG_TOKEN: { get: async () => "t" },
    ECONOMY_MODEL: "@cf/zai-org/glm-5.3-flash",
    STANDARD_MODEL: "@cf/zai-org/glm-5.3",
  } as unknown as Env;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("system prompt wording", () => {
  it("avoids the phrasings the AI Gateway guard blocks", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const e = env(async () => {
      throw new Error("down");
    });
    const r = await ground(
      e,
      [{ role: "user", content: "what is vat" }],
      "e-1",
      { scope: "platform", destination: "workers-ai" } as never,
      null,
    );
    expect(r.systemPrompt).toMatch(/Shamwari/);
    expect(r.systemPrompt).not.toMatch(/^You are Shamwari/);
    expect(r.systemPrompt).not.toMatch(/must be verified/);
  });
});

describe("reasoning budget", () => {
  it("is low on the Workers AI call", async () => {
    const run = vi.fn(async () => ({
      choices: [{ message: { content: "ok" } }],
    }));
    const e = env(run);
    await viaWorkersAI(e, targets(e).economy, messages, "platform");
    expect((run.mock.calls[0] as unknown[])[1]).toMatchObject({
      reasoning_effort: "low",
    });
  });

  it("is low on the AI Gateway call", async () => {
    const f = vi.fn(async () =>
      Response.json({ choices: [{ message: { content: "ok" } }] }),
    );
    vi.stubGlobal("fetch", f);
    const e = env(vi.fn());
    await viaGateway(e, targets(e).economy, messages, {
      tier: "economy",
      scope: "platform",
      ownerEntityId: "e",
      surface: "s",
      requestId: "r",
    });
    const body = JSON.parse(
      ((f.mock.calls[0] as unknown[])[1] as { body: string }).body,
    );
    expect(body.reasoning_effort).toBe("low");
  });
});
