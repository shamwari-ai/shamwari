// The AI Gateway's prompt-injection guard (P1: BLOCK) rejected our system prompt with a 424 on every
// request when it opened "You are Shamwari" and used the old "must be verified" sentence. Keep both out,
// and keep the reasoning budget low so the reasoning model has tokens left to answer.
import { describe, expect, it, vi, afterEach } from "vitest";
import { BASE, ground } from "../src/ground";
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
  it("speaks to the model as Shamwari directly (the guard that needed a workaround is off)", async () => {
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
    expect(r.systemPrompt).toMatch(/^You are Shamwari/);
  });

  // What the model is told shapes what people read. Each line below is something a real answer did before
  // the 2026-11-23 rewrite: repeat our internal word for sources back to a person, open every reply with a
  // disclaimer, or run to tables and headings on a phone.
  it("never hands the model our internal vocabulary to repeat back to people", () => {
    const told = BASE.split("\n").filter((l) => !/^- Never mention/.test(l)).join("\n");
    expect(told).not.toMatch(/\bGround\b/);
    expect(told).not.toMatch(/\bcontext\b/i);
  });

  it("asks for short answers fit for a small screen, without tables or headings", () => {
    expect(BASE).toMatch(/about 150 words at most/);
    expect(BASE).toMatch(/No tables and no headings/);
  });

  it("keeps the disclaimer to law, fees and procedures, at the end, never for everyday talk", () => {
    expect(BASE).toMatch(/end with one short line/);
    expect(BASE).toMatch(/Say nothing about sources for everyday conversation/);
  });

  it("still forbids invented law: Acts, sections, instruments, fees, rates, dates", () => {
    expect(BASE).toMatch(/Never invent an Act, section number, statutory instrument, fee, rate or date/);
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
