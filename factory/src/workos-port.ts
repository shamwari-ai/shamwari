import { WorkOS } from "@workos-inc/node";
import { secret, type Env } from "./env";
import {
  jwtClaims,
  type AuthKitPort,
  type CheckResult,
  type RefreshResult,
} from "./session";

/**
 * The only file that talks to the WorkOS SDK, as in site/worker/workos-port.ts
 * (same calls, same rules: an unexpected fault is never a sign-out).
 */
export type Port = AuthKitPort & {
  refresh(sealed: string): Promise<RefreshResult>;
};

/** Why a WorkOS call failed: name, status and code only. Never a token or a cookie. */
function reason(err: unknown): string {
  if (!(err instanceof Error)) return "unknown error";
  const e = err as Error & { status?: unknown; code?: unknown };
  return [
    e.name,
    typeof e.status === "number" ? `status ${e.status}` : "",
    typeof e.code === "string" ? `code ${e.code}` : "",
  ]
    .filter(Boolean)
    .join(" | ")
    .slice(0, 200);
}

/** Misconfiguration throws (the caller answers 503), never a silent "signed out". */
export async function makePort(env: Env, override?: WorkOS): Promise<Port> {
  const clientId = env.WORKOS_CLIENT_ID;
  const redirectUri = env.WORKOS_REDIRECT_URI;
  const apiKey = await secret(env.WORKOS_API_KEY);
  const cookiePassword = await secret(env.COOKIE_PASSWORD);
  if (!clientId || !redirectUri || !apiKey || !cookiePassword)
    throw new Error("factory sign-in is not configured");
  if (cookiePassword.length < 32)
    throw new Error("COOKIE_PASSWORD must be at least 32 characters");

  const workos = override ?? new WorkOS(apiKey, { clientId });
  const um = workos.userManagement;
  const load = (sealed: string) =>
    um.loadSealedSession({ sessionData: sealed, cookiePassword });
  const sidFromSealed = async (sealed: string): Promise<string | null> => {
    const data = await um.getSessionFromCookie({
      sessionData: sealed,
      cookiePassword,
    });
    const sid = data ? jwtClaims(data.accessToken)?.sid : null;
    return typeof sid === "string" && sid ? sid : null;
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
      } catch (err) {
        console.error("workos code exchange failed:", reason(err));
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
        if (a.reason === "invalid_jwt") {
          const sid = await sidFromSealed(sealed);
          return sid ? { status: "expired", sid } : { status: "invalid" };
        }
        return { status: "invalid" };
      } catch {
        return { status: "unavailable" };
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
      } catch (err) {
        console.error("workos refresh failed:", reason(err));
        return { status: "retry" };
      }
    },

    async revoke(sealed) {
      const sid = await sidFromSealed(sealed);
      if (sid) await um.revokeSession({ sessionId: sid });
    },
  };
}
