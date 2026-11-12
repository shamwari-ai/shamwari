import { afterEach, describe, expect, it, vi } from "vitest";
import { core, CORE_TIMEOUT_MS } from "../src/core";
import type { Env } from "../src/types";

const env = {
  CORE_URL: "https://core.invalid",
  SHAMWARI_CORE_TOKEN: "t",
} as unknown as Env;

afterEach(() => vi.unstubAllGlobals());

describe("core() never hangs", () => {
  it("passes an abort signal so a silent Core is cut off", async () => {
    let seen: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        seen = init.signal as AbortSignal;
        return new Response('{"ok":true}', { status: 200 });
      }),
    );
    await core(env, "/health");
    expect(seen).toBeInstanceOf(AbortSignal);
    expect(CORE_TIMEOUT_MS).toBeLessThanOrEqual(5000);
  });

  it("rejects when Core accepts the connection and never answers", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            (init.signal as AbortSignal).addEventListener("abort", () =>
              reject(init.signal!.reason),
            );
          }),
      ),
    );
    const pending = core(env, "/ground/search", {
      method: "POST",
      body: { q: "x" },
    });
    const caught = pending.catch((e) => e);
    await vi.advanceTimersByTimeAsync(CORE_TIMEOUT_MS + 10);
    expect(await caught).toBeInstanceOf(Error);
    vi.useRealTimers();
  });
});
