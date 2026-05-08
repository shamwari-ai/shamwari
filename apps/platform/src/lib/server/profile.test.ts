/**
 * profile fallback returns a sensible default that uses AuthKit-known
 * fields so the settings page renders before /v1/users/me is reachable.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("$env/dynamic/private", () => ({ env: {} }));

import { getProfile, updateProfile } from "./profile";

const auth = {
  user: {
    id: "user_123",
    email: "alice@example.com",
    firstName: "Alice",
    profilePictureUrl: null,
  },
  accessToken: "",
} as unknown as import("@workos/authkit-sveltekit").AuthKitAuth;

describe("profile fallback", () => {
  it("returns default profile from AuthKit when backend is unreachable", async () => {
    const profile = await getProfile(auth);
    expect(profile.id).toBe("user_123");
    expect(profile.email).toBe("alice@example.com");
    expect(profile.name).toBe("Alice");
    expect(profile.preferences.language).toBe("en");
    expect(profile.role).toBe("developer");
  });

  it("update returns null when backend is unreachable", async () => {
    const result = await updateProfile(auth, { name: "Alice Q" });
    expect(result).toBeNull();
  });
});
