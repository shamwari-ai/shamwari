/**
 * Billing proxy: empty plan list, null subscription, /pricing portal
 * fallback when AI_API_URL is unset. Dashboard pages rely on these
 * shapes to render the empty states cleanly.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("$env/dynamic/private", () => ({ env: {} }));

import {
  createPortalSession,
  getSubscription,
  listPlans,
} from "./billing";

const auth = {
  user: { id: "u" },
  accessToken: "",
} as unknown as import("@workos/authkit-sveltekit").AuthKitAuth;

describe("billing fallback", () => {
  it("listPlans returns [] when backend is unreachable", async () => {
    expect(await listPlans(auth)).toEqual([]);
  });

  it("getSubscription returns null when backend is unreachable", async () => {
    expect(await getSubscription(auth)).toBeNull();
  });

  it("createPortalSession falls back to /pricing", async () => {
    const session = await createPortalSession(auth);
    expect(session.url).toBe("https://shamwari.ai/pricing");
    expect(session.expires_at).toBeTruthy();
  });
});
