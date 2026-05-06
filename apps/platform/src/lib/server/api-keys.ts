/**
 * API-key domain types and a tiny in-memory fallback.
 *
 * In production every read/write goes through apiCall() to the FastAPI
 * backend at AI_API_URL. When the backend is unreachable (preview
 * deploys, local without Fly creds), we transparently fall back to a
 * per-process in-memory map so the UI still works for review purposes.
 * The fallback is keyed by AuthKit user id so previews stay isolated.
 */

import type { AuthKitAuth } from "@workos/authkit-sveltekit";
import { apiCall } from "./api-client";

export interface ApiKey {
  id: string;
  label: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface CreatedApiKey extends ApiKey {
  /** Plaintext key, returned exactly once at creation. */
  secret: string;
}

const memoryStore = new Map<string, ApiKey[]>();

function userKey(auth: AuthKitAuth): string {
  return auth.user?.id ?? "anonymous";
}

function randomSegment(length: number): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < length; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

function newKey(label: string): CreatedApiKey {
  const id = `key_${randomSegment(16)}`;
  const secret = `sk_live_${randomSegment(32)}`;
  return {
    id,
    label,
    prefix: secret.slice(0, 12),
    secret,
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
  };
}

export async function listApiKeys(auth: AuthKitAuth): Promise<ApiKey[]> {
  const result = await apiCall<{ keys: ApiKey[] }>({
    method: "GET",
    path: "/v1/api-keys",
    auth,
  });
  if (result.ok && result.data?.keys) return result.data.keys;
  return memoryStore.get(userKey(auth)) ?? [];
}

export async function createApiKey(
  auth: AuthKitAuth,
  label: string,
): Promise<CreatedApiKey> {
  const result = await apiCall<CreatedApiKey>({
    method: "POST",
    path: "/v1/api-keys",
    auth,
    body: { label },
  });
  if (result.ok && result.data) return result.data;

  // Fallback: mint locally, store in-process, return the secret once.
  const created = newKey(label);
  const list = memoryStore.get(userKey(auth)) ?? [];
  // Strip the secret before persisting; we only ever return it from this call.
  const { secret, ...stored } = created;
  void secret;
  memoryStore.set(userKey(auth), [...list, stored]);
  return created;
}

export async function revokeApiKey(
  auth: AuthKitAuth,
  id: string,
): Promise<boolean> {
  const result = await apiCall<unknown>({
    method: "DELETE",
    path: `/v1/api-keys/${encodeURIComponent(id)}`,
    auth,
  });
  if (result.ok) return true;

  const list = memoryStore.get(userKey(auth)) ?? [];
  const next = list.filter((key) => key.id !== id);
  memoryStore.set(userKey(auth), next);
  return next.length !== list.length;
}
