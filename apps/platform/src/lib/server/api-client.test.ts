/**
 * Validates the apiCall fallback shape: when AI_API_URL isn't configured
 * the proxy returns a 503 result instead of throwing, so the dashboard
 * pages render an empty state instead of an error wall.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("$env/dynamic/private", () => ({ env: {} }));

describe("apiCall", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.restoreAllMocks());

  it("returns 503 when AI_API_URL is unset", async () => {
    const { apiCall } = await import("./api-client");
    const result = await apiCall({ path: "/v1/api-keys" });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(503);
    expect(result.error).toContain("AI_API_URL");
  });
});
