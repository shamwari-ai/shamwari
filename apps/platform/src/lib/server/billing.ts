/**
 * Billing domain types + thin proxies to /v1/billing/*.
 *
 * Same fallback story as api-keys/usage: empty plan list and a /pricing
 * portal URL when AI_API_URL is unreachable so previews still render.
 */

import type { AuthKitAuth } from "@workos/authkit-sveltekit";
import { apiCall } from "./api-client";

export interface BillingPlan {
  id: string;
  name: string;
  slug: string;
  description: string;
  price: number;
  price_currency: string;
  eligible_quantity: number;
  rate_limit_rpm: number;
  features: string[];
}

export interface Subscription {
  id: string;
  ordered_item: string;
  order_status: string;
  cancel_at_period_end: boolean;
  current_period_start: string | null;
  current_period_end: string | null;
}

export interface BillingPortalSession {
  url: string;
  expires_at: string;
}

export async function listPlans(auth: AuthKitAuth): Promise<BillingPlan[]> {
  const result = await apiCall<BillingPlan[]>({
    method: "GET",
    path: "/v1/billing/plans",
    auth,
  });
  return result.ok && result.data ? result.data : [];
}

export async function getSubscription(
  auth: AuthKitAuth,
): Promise<Subscription | null> {
  const result = await apiCall<Subscription>({
    method: "GET",
    path: "/v1/billing/subscription",
    auth,
  });
  return result.ok && result.data ? result.data : null;
}

export async function createPortalSession(
  auth: AuthKitAuth,
): Promise<BillingPortalSession> {
  const result = await apiCall<BillingPortalSession>({
    method: "POST",
    path: "/v1/billing/portal",
    auth,
  });
  if (result.ok && result.data) return result.data;
  return {
    url: "https://shamwari.ai/pricing",
    expires_at: new Date().toISOString(),
  };
}
