/**
 * Usage stats domain. Same fallback story as api-keys: real fetch against
 * AI_API_URL, empty zeros when the backend is unreachable so the dashboard
 * renders without exceptions.
 */

import type { AuthKitAuth } from "@workos/authkit-sveltekit";
import { apiCall } from "./api-client";

export type UsageRange = "7d" | "30d" | "90d";

export interface UsageSummary {
  range: UsageRange;
  tokens: number;
  tokenLimit: number;
  requests: number;
  errorsPercent: number;
  p95LatencyMs: number;
  series: { date: string; tokens: number; requests: number }[];
}

const EMPTY: UsageSummary = {
  range: "30d",
  tokens: 0,
  tokenLimit: 1_000_000,
  requests: 0,
  errorsPercent: 0,
  p95LatencyMs: 0,
  series: [],
};

export async function getUsage(
  auth: AuthKitAuth,
  range: UsageRange = "30d",
): Promise<UsageSummary> {
  const result = await apiCall<UsageSummary>({
    method: "GET",
    path: "/v1/usage",
    auth,
    query: { range },
  });
  if (result.ok && result.data) {
    return { ...EMPTY, ...result.data, range };
  }
  return { ...EMPTY, range };
}
