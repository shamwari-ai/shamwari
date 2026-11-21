import { describe, expect, it } from "vitest";
import { route } from "../src/router";
import { SESSION_COOKIE, STATE_COOKIE } from "../src/session";
import { deps, req } from "./helpers";

describe("sign-in on the factory's own host", () => {
  it("cookies are host-only (__Host-): Secure, Path=/, no Domain", () => {
    expect(SESSION_COOKIE.startsWith("__Host-")).toBe(true);
    expect(STATE_COOKIE.startsWith("__Host-")).toBe(true);
  });

  it("login sets a one-time state cookie and goes to AuthKit", async () => {
    const { deps: d } = deps();
    const r = await route(req("/auth/login"), d);
    expect(r.status).toBe(302);
    expect(r.headers.get("Location")).toBe(
      "https://auth.example.test/authorize?state=state123",
    );
    const c = r.headers.get("Set-Cookie")!;
    expect(c).toMatch(/^__Host-shamwari_factory_oauth=state123; Path=\/;/);
    expect(c).not.toMatch(/Domain=/i);
  });

  it("the callback refuses a state that does not match, without looping back to sign-in", async () => {
    const { deps: d } = deps();
    const r = await route(
      req("/callback?state=other&code=good", {
        headers: { Cookie: "__Host-shamwari_factory_oauth=state123" },
      }),
      d,
    );
    expect(r.status).toBe(401);
    expect(r.headers.get("Location")).toBeNull();
  });

  it("a good callback sets the session cookie and always lands on /", async () => {
    const { deps: d } = deps();
    const r = await route(
      req("/callback?state=state123&code=good&return=https://evil.test", {
        headers: { Cookie: "__Host-shamwari_factory_oauth=state123" },
      }),
      d,
    );
    expect(r.status).toBe(302);
    expect(r.headers.get("Location")).toBe("/");
    const cookies = r.headers.getSetCookie();
    expect(
      cookies.some((c) =>
        c.startsWith("__Host-shamwari_factory=sealed:alice; Path=/;"),
      ),
    ).toBe(true);
    expect(cookies.every((c) => !/Domain=/i.test(c))).toBe(true);
  });

  it("a refused code is a failure page", async () => {
    const { deps: d } = deps();
    const r = await route(
      req("/callback?state=state123&code=bad", {
        headers: { Cookie: "__Host-shamwari_factory_oauth=state123" },
      }),
      d,
    );
    expect(r.status).toBe(401);
  });

  it("logout is POST only, refuses cross-site, and clears the cookie", async () => {
    const { deps: d } = deps();
    expect((await route(req("/auth/logout"), d)).status).toBe(405);
    expect(
      (
        await route(
          req("/auth/logout", {
            method: "POST",
            headers: { "Sec-Fetch-Site": "cross-site" },
          }),
          d,
        )
      ).status,
    ).toBe(403);
    const r = await route(
      req("/auth/logout", { method: "POST", cookie: "sealed:alice" }),
      d,
    );
    expect(r.status).toBe(204);
    expect(r.headers.getSetCookie()[0]).toMatch(
      /^__Host-shamwari_factory=; Path=\/; Max-Age=0/,
    );
  });

  it("sign-in routes answer 503 when the secrets are not bound", async () => {
    const { deps: d } = deps({ authFails: true });
    expect((await route(req("/auth/login"), d)).status).toBe(503);
  });
});
