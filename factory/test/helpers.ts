import type { AuthKitPort, CheckResult, RefreshResult } from "../src/session";
import type { RouterDeps, WorkspaceStub } from "../src/router";

/** An unsigned JWT-shaped token: the gate reads claims that the port has already verified. */
export function jwt(claims: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "none" })}.${b64(claims)}.sig`;
}

export const NOW = 1_800_000_000_000;
export const nowS = NOW / 1000;

export function token(sub: string, extra: Record<string, unknown> = {}) {
  return jwt({
    sub,
    sid: `sid_${sub}`,
    iat: nowS - 60,
    exp: nowS + 300,
    ...extra,
  });
}

/** Sealed cookies the fake port understands: `sealed:<userId>`, `sealed:expired:<userId>`, `bad`. */
export function fakePort(over: Partial<AuthKitPort> = {}): AuthKitPort {
  return {
    authorizationUrl: (state) =>
      `https://auth.example.test/authorize?state=${state}`,
    exchangeCode: async (code) =>
      code === "good" ? { sealed: "sealed:alice" } : null,
    async check(sealed): Promise<CheckResult> {
      if (sealed === "unavailable") return { status: "unavailable" };
      const m = /^sealed:(expired:|old:)?([a-z]+)$/.exec(sealed);
      if (!m) return { status: "invalid" };
      const user = m[2]!;
      if (m[1] === "expired:") return { status: "expired", sid: `sid_${user}` };
      if (m[1] === "old:")
        return {
          status: "valid",
          accessToken: token(user, { iat: nowS - 45 * 60 }),
          sid: `sid_${user}`,
        };
      return { status: "valid", accessToken: token(user), sid: `sid_${user}` };
    },
    revoke: async () => undefined,
    ...over,
  };
}

export interface Recorded {
  names: string[];
  credentials: { name: string; token: string }[];
  forwarded: Request[];
}

export function deps(
  over: {
    port?: AuthKitPort;
    refresh?: (sid: string, sealed: string) => Promise<RefreshResult>;
    authFails?: boolean;
    workspaceResponse?: (req: Request) => Response;
  } = {},
): { deps: RouterDeps; rec: Recorded } {
  const rec: Recorded = { names: [], credentials: [], forwarded: [] };
  const port = over.port ?? fakePort();
  return {
    rec,
    deps: {
      async auth() {
        if (over.authFails)
          throw new Error("factory sign-in is not configured");
        return {
          port,
          randomState: () => "state123",
          check: (s) => port.check(s),
          now: () => NOW,
          refresh:
            over.refresh ??
            (async (sid) => ({
              status: "ok",
              sealed: `sealed:${sid.replace("sid_", "")}`,
              accessToken: token(sid.replace("sid_", ""), { fresh: true }),
            })),
        };
      },
      workspace(name): WorkspaceStub {
        rec.names.push(name);
        return {
          async setGatewayCredential(t) {
            rec.credentials.push({ name, token: t });
          },
          async fetch(req) {
            rec.forwarded.push(req);
            return (
              over.workspaceResponse?.(req) ??
              new Response(`workspace ${name}`, { status: 200 })
            );
          },
        };
      },
    },
  };
}

export const ORIGIN = "https://factory.example.test";

export function req(
  path: string,
  init: RequestInit & { cookie?: string; navigate?: boolean } = {},
): Request {
  const headers = new Headers(init.headers);
  if (init.cookie)
    headers.set("Cookie", `__Host-shamwari_factory=${init.cookie}`);
  if (init.navigate) {
    headers.set("Sec-Fetch-Mode", "navigate");
    headers.set("Accept", "text/html");
  }
  return new Request(ORIGIN + path, { ...init, headers });
}
