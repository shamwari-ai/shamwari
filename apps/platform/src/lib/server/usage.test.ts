/**
 * Usage proxy returns a zeroed UsageSummary when AI_API_URL is unset.
 * The dashboard relies on this empty shape to render without throwing.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("$env/dynamic/private", () => ({ env: {} }));

import { getUsage } from "./usage";

const fakeAuth = {
  user: { id: "u" },
  accessToken: "",
} as unknown as import("@workos/authkit-sveltekit").AuthKitAuth;

describe("getUsage", () => {
  it("returns zeroed summary for default range", async () => {
    const usage = await getUsage(fakeAuth);
    expect(usage.range).toBe("30d");
    expect(usage.tokens).toBe(0);
    expect(usage.requests).toBe(0);
    expect(usage.tokenLimit).toBeGreaterThan(0);
    expect(usage.series).toEqual([]);
  });

  it("respects the range argument", async () => {
    const usage = await getUsage(fakeAuth, "7d");
    expect(usage.range).toBe("7d");
  });
});
