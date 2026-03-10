function requireEnv(name: string): string {
  const value = process.env[name];
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
  NEXT_PUBLIC_STYTCH_PUBLIC_TOKEN:
    process.env.NEXT_PUBLIC_STYTCH_PUBLIC_TOKEN ?? "",
} as const;
