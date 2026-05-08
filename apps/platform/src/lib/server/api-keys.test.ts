/**
 * The api-keys server module degrades to an in-memory per-user store
 * when the backend is unreachable. These tests exercise that fallback
 * so dashboard previews render real CRUD without needing CouchDB up.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("$env/dynamic/private", () => ({ env: {} }));

import { createApiKey, listApiKeys, revokeApiKey } from "./api-keys";

const fakeAuth = (id: string) =>
  ({
    user: { id, email: `${id}@test` },
    accessToken: "",
  }) as unknown as import("@workos/authkit-sveltekit").AuthKitAuth;

describe("api-keys (memory fallback)", () => {
  beforeEach(() => vi.resetModules());

  it("creates and lists keys per user", async () => {
    const alice = fakeAuth("alice");
    const created = await createApiKey(alice, "production-web");
    expect(created.secret).toMatch(/^sk_live_/);

    const list = await listApiKeys(alice);
    expect(list).toHaveLength(1);
    expect(list[0].label).toBe("production-web");
    expect("secret" in list[0]).toBe(false);
  });

  it("revoke removes a known key, returns false otherwise", async () => {
    const bob = fakeAuth("bob");
    const created = await createApiKey(bob, "stage");
    expect(await revokeApiKey(bob, created.id)).toBe(true);
    expect(await revokeApiKey(bob, "key_unknown")).toBe(false);
  });
});
