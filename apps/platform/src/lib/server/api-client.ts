/**
 * Thin authenticated client for the FastAPI AI backend at AI_API_URL.
 *
 * Every server route under /api/* forwards through here so the frontend
 * never speaks to the backend directly and we have one place to enforce
 * auth, timeouts, and graceful degradation when the backend is offline
 * (Vercel previews vs. production).
 */

import { env } from "$env/dynamic/private";
import type { AuthKitAuth } from "@workos/authkit-sveltekit";

const TIMEOUT_MS = 8_000;

export interface ApiCallOptions {
  method?: "GET" | "POST" | "DELETE" | "PATCH";
  path: string;
  body?: unknown;
  /** AuthKit session from locals.auth — required for any user-scoped call. */
  auth?: AuthKitAuth;
  /** Optional URLSearchParams or plain query record. */
  query?: Record<string, string | number | undefined>;
}

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
}

function buildUrl(path: string, query?: ApiCallOptions["query"]): string {
  const base = env.AI_API_URL?.replace(/\/$/, "") ?? "";
  if (!base) {
    return "";
  }
  const u = new URL(`${base}${path.startsWith("/") ? path : `/${path}`}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
    }
  }
  return u.toString();
}

export async function apiCall<T>({
  method = "GET",
  path,
  body,
  auth,
  query,
}: ApiCallOptions): Promise<ApiResult<T>> {
  const url = buildUrl(path, query);
  if (!url) {
    return {
      ok: false,
      status: 503,
      error: "AI_API_URL not configured",
    };
  }

  const headers: Record<string, string> = {
    accept: "application/json",
  };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (auth?.accessToken) {
    headers.authorization = `Bearer ${auth.accessToken}`;
  } else if (auth?.user?.id) {
    headers["x-user-id"] = auth.user.id;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const text = await response.text();
    const data = text ? safeJson<T>(text) : undefined;

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        data,
        error:
          (data as { error?: string } | undefined)?.error ??
          response.statusText,
      };
    }

    return { ok: true, status: response.status, data };
  } catch (err) {
    return {
      ok: false,
      status: 502,
      error: err instanceof Error ? err.message : "Upstream request failed",
    };
  } finally {
    clearTimeout(timer);
  }
}

function safeJson<T>(text: string): T | undefined {
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}
