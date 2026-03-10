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
  get R2_ACCOUNT_ID() {
    return requireEnv("R2_ACCOUNT_ID");
  },
  get R2_ACCESS_KEY_ID() {
    return requireEnv("R2_ACCESS_KEY_ID");
  },
  get R2_SECRET_ACCESS_KEY() {
    return requireEnv("R2_SECRET_ACCESS_KEY");
  },
  R2_BUCKET_NAME: process.env.R2_BUCKET_NAME ?? "shamwari-assets",
  /** Client-safe public token — may be empty during build */
  NEXT_PUBLIC_STYTCH_PUBLIC_TOKEN:
    process.env.NEXT_PUBLIC_STYTCH_PUBLIC_TOKEN ?? "",
} as const;
