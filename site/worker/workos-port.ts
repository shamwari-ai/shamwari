import { WorkOS } from "@workos-inc/node";
import type { AuthKitPort, CheckResult, RefreshResult } from "./session";

/**
 * The only file that talks to the WorkOS SDK. Every WorkOS-specific decision is
 * here, so session.ts can be tested against a fake and this can be checked
 * against the SDK's types.
 *
 * Bindings, all by NAME. None of them is a secret except the two named below,
 * and those arrive as Secrets Store bindings (an object with get()) or, for
 * local development only, as plain strings from .dev.vars:
 *   WORKOS_CLIENT_ID      public: the AuthKit application's client id
 *   WORKOS_REDIRECT_URI   public: exactly https://shamwari.ai/chat/callback
 *   WORKOS_API_KEY        SECRET: the environment's API key (confidential client)
 *   COOKIE_PASSWORD       SECRET: seals the session cookie; at least 32 characters
 */
export type SecretBinding = string | { get(): Promise<string> } | undefined;

export interface WorkerEnv {
  WORKOS_CLIENT_ID?: string;
  WORKOS_REDIRECT_URI?: string;
  WORKOS_API_KEY?: SecretBinding;
  COOKIE_PASSWORD?: SecretBinding;
  SESSION_REFRESH?: DurableObjectNamespaceLike;
}

export interface DurableObjectNamespaceLike {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(req: Request): Promise<Response> };
}

export async function secret(b: SecretBinding): Promise<string | undefined> {
  if (typeof b === "string") return b || undefined;
  if (b && typeof b.get === "function") return (await b.get()) || undefined;
  return undefined;
}

export type Port = AuthKitPort & {
  refresh(sealed: string): Promise<RefreshResult>;
};

/** Misconfiguration is an error to the caller (a 500), never a silent "signed out". */
export async function makePort(
  env: WorkerEnv,
  workosOverride?: WorkOS,
): Promise<Port> {
  const clientId = env.WORKOS_CLIENT_ID;
  const redirectUri = env.WORKOS_REDIRECT_URI;
  const apiKey = await secret(env.WORKOS_API_KEY);
  const cookiePassword = await secret(env.COOKIE_PASSWORD);
  if (!clientId || !redirectUri || !apiKey || !cookiePassword)
    throw new Error("session worker is not configured");
  if (cookiePassword.length < 32)
    throw new Error("COOKIE_PASSWORD must be at least 32 characters");

  const workos = workosOverride ?? new WorkOS(apiKey, { clientId });
  const um = workos.userManagement;
  const load = (sealed: string) =>
    um.loadSealedSession({ sessionData: sealed, cookiePassword });

  /** `sid` from a token the SDK has already read out of our own sealed cookie. */
  const sidOf = (accessToken: string): string | null => {
    try {
      const seg = accessToken.split(".")[1] ?? "";
      const o = JSON.parse(
        atob(
          seg
            .replace(/-/g, "+")
            .replace(/_/g, "/")
            .padEnd(Math.ceil(seg.length / 4) * 4, "="),
        ),
      ) as {
        sid?: unknown;
      };
      return typeof o.sid === "string" && o.sid ? o.sid : null;
    } catch {
      return null;
    }
  };

  return {
    authorizationUrl: (state) =>
      um.getAuthorizationUrl({
        provider: "authkit",
        clientId,
        redirectUri,
        state,
      }),

    async exchangeCode(code) {
      try {
        const r = await um.authenticateWithCode({
          clientId,
          code,
          session: { sealSession: true, cookiePassword },
        });
        return r.sealedSession ? { sealed: r.sealedSession } : null;
      } catch {
        return null;
      }
    },

    async check(sealed): Promise<CheckResult> {
      try {
        const a = await load(sealed).authenticate();
        if (a.authenticated)
          return {
            status: "valid",
            accessToken: a.accessToken,
            sid: a.sessionId,
          };
        // An expired access token fails verification as invalid_jwt. That is the ordinary
        // "time to refresh" case; anything else (no cookie, unreadable cookie) is not a session.
        if (a.reason === "invalid_jwt") {
          const data = await um.getSessionFromCookie({
            sessionData: sealed,
            cookiePassword,
          });
          const sid = data ? sidOf(data.accessToken) : null;
          return sid ? { status: "expired", sid } : { status: "invalid" };
        }
        return { status: "invalid" };
      } catch {
        // A cookie we cannot read (wrong password after rotation, tampering) is not a session.
        return { status: "invalid" };
      }
    },

    async refresh(sealed): Promise<RefreshResult> {
      try {
        const r = await load(sealed).refresh({ cookiePassword });
        if (r.authenticated) {
          if (!r.sealedSession || !r.session?.accessToken)
            return { status: "retry" };
          return {
            status: "ok",
            sealed: r.sealedSession,
            accessToken: r.session.accessToken,
          };
        }
        return r.retryable
          ? { status: "retry", retryAfter: r.retryAfter }
          : { status: "denied" };
      } catch {
        return { status: "retry" };
      }
    },

    async revoke(sealed) {
      const a = await load(sealed).authenticate();
      const sid = a.authenticated ? a.sessionId : null;
      if (sid) await um.revokeSession({ sessionId: sid });
    },
  };
}
