/**
 * User profile domain — proxies to /v1/users/me with a graceful fallback
 * (returns the AuthKit-known basics) when the backend is unreachable.
 */

import type { AuthKitAuth } from "@workos/authkit-sveltekit";
import { apiCall } from "./api-client";

export interface UserPreferences {
  language: string;
  theme: "light" | "dark" | "system";
  notifications_enabled: boolean;
  default_model_slug: string | null;
}

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  image: string | null;
  role: string;
  preferences: UserPreferences;
  organization_ids: string[];
  is_active: boolean;
}

const DEFAULT_PREFS: UserPreferences = {
  language: "en",
  theme: "system",
  notifications_enabled: true,
  default_model_slug: null,
};

export async function getProfile(auth: AuthKitAuth): Promise<UserProfile> {
  const result = await apiCall<UserProfile>({
    method: "GET",
    path: "/v1/users/me",
    auth,
  });
  if (result.ok && result.data) return result.data;
  return {
    id: auth.user?.id ?? "anonymous",
    name: auth.user?.firstName ?? auth.user?.email?.split("@")[0] ?? "There",
    email: auth.user?.email ?? "unknown@example.com",
    image: auth.user?.profilePictureUrl ?? null,
    role: "developer",
    preferences: DEFAULT_PREFS,
    organization_ids: [],
    is_active: true,
  };
}

export interface ProfileUpdate {
  name?: string;
  image?: string | null;
  preferences?: Partial<UserPreferences>;
}

export async function updateProfile(
  auth: AuthKitAuth,
  patch: ProfileUpdate,
): Promise<UserProfile | null> {
  const result = await apiCall<UserProfile>({
    method: "PATCH",
    path: "/v1/users/me",
    auth,
    body: patch,
  });
  return result.ok && result.data ? result.data : null;
}
