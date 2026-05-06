import { env as privateEnv } from "$env/dynamic/private";
import { env as publicEnv } from "$env/dynamic/public";

function requireEnv(name: string): string {
  const value = privateEnv[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  get MONGODB_URI() {
    return requireEnv("MONGODB_URI");
  },
  get STYTCH_PROJECT_ID() {
    return requireEnv("STYTCH_PROJECT_ID");
  },
  get STYTCH_SECRET() {
    return requireEnv("STYTCH_SECRET");
  },
  get AI_API_URL() {
    return requireEnv("AI_API_URL");
  },
  /** Client-safe public token — may be empty during build */
  PUBLIC_STYTCH_PUBLIC_TOKEN: publicEnv.PUBLIC_STYTCH_PUBLIC_TOKEN ?? "",
} as const;
