import type {
  AuthKitPort,
  CheckResult,
  Deps,
  RefreshResult,
} from "../../worker/session";

export const b64 = (o: unknown) =>
  Buffer.from(JSON.stringify(o)).toString("base64url");
export const jwt = (claims: Record<string, unknown>) =>
  `${b64({ alg: "RS256" })}.${b64(claims)}.sig`;

export const NOW = 1_800_000_000_000; // ms

export interface Fake extends AuthKitPort {
  calls: string[];
  codeResult: { sealed: string } | null;
  checkResult: CheckResult;
  revokeFails: boolean;
}

export function fakePort(): Fake {
  const f: Fake = {
    calls: [],
    codeResult: { sealed: "SEALED-NEW" },
    checkResult: { status: "invalid" },
    revokeFails: false,
    authorizationUrl: (state) =>
      `https://auth.example/authorize?state=${state}`,
    async exchangeCode(code) {
      f.calls.push(`exchange:${code}`);
      return f.codeResult;
    },
    async check(sealed) {
      f.calls.push(`check:${sealed}`);
      return f.checkResult;
    },
    async revoke(sealed) {
      f.calls.push(`revoke:${sealed}`);
      if (f.revokeFails) throw new Error("workos down");
    },
  };
  return f;
}

export function deps(
  port: AuthKitPort,
  refresh?: Deps["refresh"],
): Deps & { waited: Promise<unknown>[] } {
  const waited: Promise<unknown>[] = [];
  return {
    port,
    refresh:
      refresh ?? (async (): Promise<RefreshResult> => ({ status: "denied" })),
    now: () => NOW,
    randomState: () => "STATE123",
    waitUntil: (p) => void waited.push(p),
    waited,
  };
}

export const req = (
  path: string,
  init: RequestInit & { cookie?: string; site?: string } = {},
) => {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set("Cookie", init.cookie);
  if (init.site) headers.set("Sec-Fetch-Site", init.site);
  return new Request(`https://shamwari.ai${path}`, { ...init, headers });
};

export const setCookies = (res: Response) => res.headers.getSetCookie();
