import { describe, expect, it } from "vitest";
import {
  handle,
  SESSION_COOKIE,
  STATE_COOKIE,
  jwtExp,
} from "../../worker/session";
import { NOW, deps, fakePort, jwt, req, setCookies } from "./helpers";

const secs = NOW / 1000;
const live = jwt({ exp: secs + 300, sid: "s1" });
const aboutToLapse = jwt({ exp: secs + 20, sid: "s1" });

describe("login and callback", () => {
  it("starts sign-in with a one-time state cookie, HttpOnly, Secure, SameSite=Lax", async () => {
    const res = await handle(req("/chat/auth/login"), deps(fakePort()));
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(
      "https://auth.example/authorize?state=STATE123",
    );
    const c = setCookies(res)[0]!;
    expect(c).toContain(`${STATE_COOKIE}=STATE123`);
    for (const a of [
      "HttpOnly",
      "Secure",
      "SameSite=Lax",
      "Path=/",
      "Max-Age=600",
    ])
      expect(c).toContain(a);
    expect(c).not.toContain("Domain");
  });

  it("has no return parameter: nothing in the request decides where a person lands", async () => {
    const res = await handle(
      req("/chat/auth/login?return=https://evil.example"),
      deps(fakePort()),
    );
    expect(res.headers.get("Location")).not.toContain("evil");
    const cb = fakePort();
    const ok = await handle(
      req("/chat/callback?code=c1&state=STATE123&return=https://evil.example", {
        cookie: `${STATE_COOKIE}=STATE123`,
      }),
      deps(cb),
    );
    expect(ok.headers.get("Location")).toBe("/chat/");
  });

  it("on a good callback: exchanges the code, sets the session cookie, spends the state, lands on /chat/", async () => {
    const port = fakePort();
    const res = await handle(
      req("/chat/callback?code=c1&state=STATE123", {
        cookie: `${STATE_COOKIE}=STATE123`,
      }),
      deps(port),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/chat/");
    const cookies = setCookies(res);
    expect(cookies.find((c) => c.startsWith(`${STATE_COOKIE}=;`))).toContain(
      "Max-Age=0",
    );
    const s = cookies.find((c) =>
      c.startsWith(`${SESSION_COOKIE}=SEALED-NEW`),
    )!;
    for (const a of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/"])
      expect(s).toContain(a);
    expect(port.calls).toEqual(["exchange:c1"]);
  });

  it.each([
    [
      "a missing state cookie",
      "/chat/callback?code=c1&state=STATE123",
      undefined,
    ],
    [
      "a different state",
      "/chat/callback?code=c1&state=OTHER",
      `${STATE_COOKIE}=STATE123`,
    ],
    [
      "no state in the URL",
      "/chat/callback?code=c1",
      `${STATE_COOKIE}=STATE123`,
    ],
    [
      "an error from AuthKit",
      "/chat/callback?error=access_denied&state=STATE123",
      `${STATE_COOKIE}=STATE123`,
    ],
    ["no code", "/chat/callback?state=STATE123", `${STATE_COOKIE}=STATE123`],
  ])(
    "refuses %s without calling WorkOS or setting a session",
    async (_n, path, cookie) => {
      const port = fakePort();
      const res = await handle(req(path, { cookie }), deps(port));
      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toBe("/chat/?signin=failed");
      expect(port.calls).toEqual([]);
      expect(
        setCookies(res).some((c) => c.startsWith(`${SESSION_COOKIE}=S`)),
      ).toBe(false);
      expect(
        setCookies(res).some((c) => c.startsWith(`${STATE_COOKIE}=;`)),
      ).toBe(true);
    },
  );

  it("a refused code sets no session", async () => {
    const port = fakePort();
    port.codeResult = null;
    const res = await handle(
      req("/chat/callback?code=bad&state=STATE123", {
        cookie: `${STATE_COOKIE}=STATE123`,
      }),
      deps(port),
    );
    expect(res.headers.get("Location")).toBe("/chat/?signin=failed");
    expect(
      setCookies(res).some((c) => c.startsWith(`${SESSION_COOKIE}=S`)),
    ).toBe(false);
  });

  it("login and callback are GET only", async () => {
    for (const p of ["/chat/auth/login", "/chat/callback"]) {
      expect(
        (await handle(req(p, { method: "POST" }), deps(fakePort()))).status,
      ).toBe(405);
    }
  });
});

describe("token", () => {
  const withCookie = (extra: { site?: string } = {}) =>
    req("/chat/auth/token", { cookie: `${SESSION_COOKIE}=SEALED`, ...extra });

  it("401 and no WorkOS call when there is no cookie", async () => {
    const port = fakePort();
    const res = await handle(req("/chat/auth/token"), deps(port));
    expect(res.status).toBe(401);
    expect(port.calls).toEqual([]);
  });

  it("returns a still-valid token as is, no-store, with epoch-second expiry", async () => {
    const port = fakePort();
    port.checkResult = { status: "valid", accessToken: live, sid: "s1" };
    let refreshed = 0;
    const res = await handle(
      withCookie(),
      deps(port, async () => (refreshed++, { status: "denied" })),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      access_token: live,
      expires_at: secs + 300,
    });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Vary")).toBe("Cookie");
    expect(refreshed).toBe(0);
  });

  it("refreshes a token that is about to lapse, and sets the new cookie", async () => {
    const port = fakePort();
    port.checkResult = {
      status: "valid",
      accessToken: aboutToLapse,
      sid: "s1",
    };
    const fresh = jwt({ exp: secs + 300, sid: "s1" });
    const seen: string[] = [];
    const res = await handle(
      withCookie(),
      deps(
        port,
        async (sid, sealed) => (
          seen.push(`${sid}:${sealed}`),
          { status: "ok", sealed: "SEALED2", accessToken: fresh }
        ),
      ),
    );
    expect(seen).toEqual(["s1:SEALED"]);
    expect((await res.json()) as { access_token: string }).toMatchObject({
      access_token: fresh,
    });
    expect(setCookies(res)[0]).toContain(`${SESSION_COOKIE}=SEALED2`);
  });

  it("refreshes an expired token, keyed by the session id", async () => {
    const port = fakePort();
    port.checkResult = { status: "expired", sid: "sess-9" };
    const fresh = jwt({ exp: secs + 300, sid: "sess-9" });
    const seen: string[] = [];
    const res = await handle(
      withCookie(),
      deps(
        port,
        async (sid) => (
          seen.push(sid),
          { status: "ok", sealed: "S3", accessToken: fresh }
        ),
      ),
    );
    expect(res.status).toBe(200);
    expect(seen).toEqual(["sess-9"]);
  });

  it("a terminal refusal ends the session: 401 and the cookie is cleared", async () => {
    const port = fakePort();
    port.checkResult = { status: "expired", sid: "s1" };
    const res = await handle(
      withCookie(),
      deps(port, async () => ({ status: "denied" })),
    );
    expect(res.status).toBe(401);
    expect(setCookies(res)[0]).toMatch(
      new RegExp(`^${SESSION_COOKIE}=;.*Max-Age=0`),
    );
  });

  it("an unreadable cookie is not a session: 401 and cleared", async () => {
    const port = fakePort();
    port.checkResult = { status: "invalid" };
    const res = await handle(withCookie(), deps(port));
    expect(res.status).toBe(401);
    expect(setCookies(res)[0]).toContain("Max-Age=0");
  });

  it("a WorkOS outage is 503 with Retry-After, NOT a 401, and the cookie is left alone", async () => {
    const port = fakePort();
    port.checkResult = { status: "expired", sid: "s1" };
    const res = await handle(
      withCookie(),
      deps(port, async () => ({ status: "retry", retryAfter: 7 })),
    );
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("7");
    expect(setCookies(res)).toEqual([]);
  });

  it("clamps an absurd Retry-After", async () => {
    const port = fakePort();
    port.checkResult = { status: "expired", sid: "s1" };
    const res = await handle(
      withCookie(),
      deps(port, async () => ({ status: "retry", retryAfter: 99999 })),
    );
    expect(res.headers.get("Retry-After")).toBe("120");
  });

  it("a refreshed token with no readable expiry is not handed out", async () => {
    const port = fakePort();
    port.checkResult = { status: "expired", sid: "s1" };
    const res = await handle(
      withCookie(),
      deps(port, async () => ({
        status: "ok",
        sealed: "S",
        accessToken: "not-a-jwt",
      })),
    );
    expect(res.status).toBe(503);
    expect(setCookies(res)).toEqual([]);
  });

  it("refuses a request the browser says is cross-site, before reading the cookie", async () => {
    const port = fakePort();
    const res = await handle(withCookie({ site: "cross-site" }), deps(port));
    expect(res.status).toBe(403);
    expect(port.calls).toEqual([]);
  });

  it("accepts same-origin and a direct navigation", async () => {
    for (const site of ["same-origin", "none"]) {
      const port = fakePort();
      port.checkResult = { status: "valid", accessToken: live, sid: "s1" };
      expect((await handle(withCookie({ site }), deps(port))).status).toBe(200);
    }
  });

  it("is GET only", async () => {
    const res = await handle(
      req("/chat/auth/token", {
        method: "POST",
        cookie: `${SESSION_COOKIE}=S`,
      }),
      deps(fakePort()),
    );
    expect(res.status).toBe(405);
  });

  it("never puts the token in a URL, a cookie we set on a plain read, or a cacheable response", async () => {
    const port = fakePort();
    port.checkResult = { status: "valid", accessToken: live, sid: "s1" };
    const res = await handle(withCookie(), deps(port));
    expect(setCookies(res)).toEqual([]);
    expect(res.headers.get("Location")).toBeNull();
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("logout", () => {
  it("clears both cookies, answers 204, and revokes in the background", async () => {
    const port = fakePort();
    const d = deps(port);
    const res = await handle(
      req("/chat/auth/logout", {
        method: "POST",
        cookie: `${SESSION_COOKIE}=SEALED`,
      }),
      d,
    );
    expect(res.status).toBe(204);
    expect(setCookies(res).every((c) => c.includes("Max-Age=0"))).toBe(true);
    expect(setCookies(res)).toHaveLength(2);
    await Promise.all(d.waited);
    expect(port.calls).toEqual(["revoke:SEALED"]);
  });

  it("still signs out when revocation fails, and when there was no session", async () => {
    const port = fakePort();
    port.revokeFails = true;
    const d = deps(port);
    expect(
      (
        await handle(
          req("/chat/auth/logout", {
            method: "POST",
            cookie: `${SESSION_COOKIE}=S`,
          }),
          d,
        )
      ).status,
    ).toBe(204);
    await Promise.all(d.waited); // must not reject
    expect(
      (
        await handle(
          req("/chat/auth/logout", { method: "POST" }),
          deps(fakePort()),
        )
      ).status,
    ).toBe(204);
  });

  it("refuses a cross-site POST and a GET", async () => {
    const port = fakePort();
    expect(
      (
        await handle(
          req("/chat/auth/logout", {
            method: "POST",
            site: "cross-site",
            cookie: `${SESSION_COOKIE}=S`,
          }),
          deps(port),
        )
      ).status,
    ).toBe(403);
    expect((await handle(req("/chat/auth/logout"), deps(port))).status).toBe(
      405,
    );
    expect(port.calls).toEqual([]);
  });
});

describe("other", () => {
  it("answers 404 to anything else", async () => {
    expect(
      (await handle(req("/chat/auth/other"), deps(fakePort()))).status,
    ).toBe(404);
  });
  it("jwtExp reads exp and nothing else", () => {
    expect(jwtExp(jwt({ exp: 5 }))).toBe(5);
    expect(jwtExp("garbage")).toBeNull();
    expect(jwtExp(jwt({ exp: "x" }))).toBeNull();
  });
});
