import { describe, expect, it } from "vitest";
import { route, workspaceName } from "../src/router";
import { deps, jwt, req, token, NOW, nowS } from "./helpers";

describe("unauthenticated access is refused and reaches no workspace", () => {
  it("a page load with no session goes to sign-in", async () => {
    const { deps: d, rec } = deps();
    const r = await route(req("/", { navigate: true }), d);
    expect(r.status).toBe(302);
    expect(r.headers.get("Location")).toBe("/auth/login");
    expect(rec.names).toEqual([]);
  });

  it("an API call, a script or a stream with no session is a 401", async () => {
    const { deps: d, rec } = deps();
    for (const [path, method] of [
      ["/session", "POST"],
      ["/event", "GET"],
      ["/assets/app.js", "GET"],
      ["/pty", "GET"],
    ] as const) {
      const r = await route(req(path, { method }), d);
      expect(r.status, path).toBe(401);
    }
    expect(rec.names).toEqual([]);
  });

  it("a cookie that is not a session is refused and cleared", async () => {
    const { deps: d, rec } = deps();
    const r = await route(req("/session", { cookie: "forged" }), d);
    expect(r.status).toBe(401);
    expect(r.headers.get("Set-Cookie")).toMatch(
      /^__Host-shamwari_factory=; Path=\/; Max-Age=0/,
    );
    expect(rec.names).toEqual([]);
  });

  it("fails closed (503) when sign-in is not configured", async () => {
    const { deps: d, rec } = deps({ authFails: true });
    const r = await route(
      req("/", { cookie: "sealed:alice", navigate: true }),
      d,
    );
    expect(r.status).toBe(503);
    expect(rec.names).toEqual([]);
  });

  it("fails closed (503) when the session cannot be checked", async () => {
    const { deps: d, rec } = deps();
    const r = await route(req("/", { cookie: "unavailable" }), d);
    expect(r.status).toBe(503);
    expect(rec.names).toEqual([]);
  });

  it("a renewal WorkOS refuses ends the session", async () => {
    const { deps: d, rec } = deps({
      refresh: async () => ({ status: "denied" }),
    });
    const r = await route(
      req("/session", { cookie: "sealed:expired:alice" }),
      d,
    );
    expect(r.status).toBe(401);
    expect(rec.names).toEqual([]);
  });

  it("refuses a cross-site call even with a session (the workspace runs commands)", async () => {
    const { deps: d, rec } = deps();
    const r = await route(
      req("/session", {
        method: "POST",
        cookie: "sealed:alice",
        headers: { "Sec-Fetch-Site": "cross-site" },
      }),
      d,
    );
    expect(r.status).toBe(403);
    expect(rec.names).toEqual([]);
  });

  it("a token without a subject is not an identity", async () => {
    const { deps: d, rec } = deps({
      port: {
        ...(await import("./helpers")).fakePort(),
        check: async () => ({
          status: "valid",
          accessToken: jwt({ exp: nowS + 300, iat: nowS }),
          sid: "sid_x",
        }),
      },
      refresh: async () => ({ status: "denied" }),
    });
    const r = await route(req("/session", { cookie: "sealed:alice" }), d);
    expect(r.status).toBe(401);
    expect(rec.names).toEqual([]);
  });
});

describe("per-person isolation: the workspace comes from the verified session only", () => {
  it("user A reaches A's workspace, whatever the request names", async () => {
    const { deps: d, rec } = deps();
    const attempts = [
      req("/", { cookie: "sealed:alice" }),
      req("/user:bob/session", { cookie: "sealed:alice" }),
      req("/session?workspace=user:bob&url=x", { cookie: "sealed:alice" }),
      req("/session", {
        cookie: "sealed:alice",
        headers: { "X-Factory-Workspace": "user:bob", "X-User": "bob" },
      }),
    ];
    for (const a of attempts) {
      const r = await route(a, d);
      expect(r.status).toBe(200);
    }
    expect(new Set(rec.names)).toEqual(new Set([workspaceName("alice")]));
    expect(rec.credentials.every((c) => c.name === "user:alice")).toBe(true);
  });

  it("user B reaches only B's workspace, with B's own token", async () => {
    const { deps: d, rec } = deps();
    await route(req("/", { cookie: "sealed:alice" }), d);
    await route(req("/", { cookie: "sealed:bob" }), d);
    expect(rec.names).toEqual(["user:alice", "user:bob"]);
    expect(rec.credentials[0]!.token).toBe(token("alice"));
    expect(rec.credentials[1]!.token).toBe(token("bob"));
  });

  it("the session cookie and browser credentials are never forwarded to the workspace", async () => {
    const { deps: d, rec } = deps();
    await route(
      req("/session", {
        cookie: "sealed:alice",
        headers: { Authorization: "Basic eDp5" },
      }),
      d,
    );
    const f = rec.forwarded[0]!;
    expect(f.headers.get("Cookie")).toBeNull();
    expect(f.headers.get("Authorization")).toBeNull();
    expect(f.url).toBe("https://factory.example.test/session");
  });

  it("an expired session is renewed, its new cookie set, and the new token handed over", async () => {
    const { deps: d, rec } = deps();
    const r = await route(req("/", { cookie: "sealed:expired:alice" }), d);
    expect(r.status).toBe(200);
    expect(r.headers.get("Set-Cookie")).toMatch(
      /^__Host-shamwari_factory=sealed:alice; Path=\/; Max-Age=\d+; HttpOnly; Secure; SameSite=Lax$/,
    );
    expect(rec.names).toEqual(["user:alice"]);
    expect(rec.credentials[0]!.token).toBe(token("alice", { fresh: true }));
  });

  it("a token older than 30 minutes is renewed before the gateway sees it", async () => {
    const { deps: d, rec } = deps();
    await route(req("/", { cookie: "sealed:old:alice" }), d);
    expect(rec.credentials[0]!.token).toBe(token("alice", { fresh: true }));
    expect(NOW).toBeGreaterThan(0);
  });

  it("adds framing and referrer protection to what the workspace answers", async () => {
    const { deps: d } = deps();
    const r = await route(req("/", { cookie: "sealed:alice" }), d);
    expect(r.headers.get("X-Frame-Options")).toBe("DENY");
    expect(r.headers.get("Referrer-Policy")).toBe("no-referrer");
  });
});
