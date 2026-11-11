import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import worker from "../src/index.js";
import {
  inScope,
  stripPrefix,
  rewriteLocation,
  rewriteSetCookie,
  cacheControl,
  CSP,
} from "../src/rewrite.js";

const PUB = "https://shamwari.ai";

// A fake origin that records what it was asked and answers with what the test gives it.
function origin(answer) {
  const seen = [];
  return {
    seen,
    async fetch(req) {
      seen.push({
        url: req.url,
        method: req.method,
        headers: Object.fromEntries(req.headers),
        body: req.body ? await req.text() : null,
      });
      return typeof answer === "function" ? answer(req) : answer;
    },
  };
}
const call = (path, o, init) =>
  worker.fetch(new Request(PUB + path, init), { CHAT_ORIGIN: o });

test("scope has path boundaries", () => {
  for (const p of ["/chat", "/chat/", "/chat/api/x", "/chat/a/b"])
    assert.ok(inScope(p), p);
  for (const p of [
    "/",
    "/chatter",
    "/chat-x",
    "/chatlite",
    "/lite/",
    "/api/chat",
    "/chat%2Fapi",
  ])
    assert.ok(!inScope(p), p);
});

test("prefix is stripped, root stays root", () => {
  assert.equal(stripPrefix("/chat/"), "/");
  assert.equal(stripPrefix("/chat/api/auth"), "/api/auth");
  assert.equal(stripPrefix("/chat"), "/");
});

test("Location is re-prefixed only when it is ours and not already prefixed", () => {
  assert.equal(rewriteLocation("/login", PUB), "/chat/login");
  assert.equal(rewriteLocation("/login?a=1#x", PUB), "/chat/login?a=1#x");
  assert.equal(rewriteLocation("/chat/login", PUB), "/chat/login");
  assert.equal(
    rewriteLocation("https://shamwari.ai/c/abc", PUB),
    "/chat/c/abc",
  );
  assert.equal(
    rewriteLocation("https://shamwari.ai/chat/c/abc", PUB),
    "/chat/c/abc",
  );
  assert.equal(
    rewriteLocation("https://api.workos.com/sso/authorize?x=1", PUB),
    "https://api.workos.com/sso/authorize?x=1",
  );
  assert.equal(
    rewriteLocation("https://shamwari.ai.evil.example/x", PUB),
    "https://shamwari.ai.evil.example/x",
  );
});

test("Set-Cookie is scoped to /chat", () => {
  assert.equal(
    rewriteSetCookie(
      "refreshToken=abc; Path=/; HttpOnly; Secure; SameSite=Strict",
    ),
    "refreshToken=abc; Path=/chat; HttpOnly; Secure; SameSite=Strict",
  );
  assert.equal(rewriteSetCookie("a=b; HttpOnly"), "a=b; Path=/chat; HttpOnly");
  assert.equal(rewriteSetCookie("a=b; Path=/api"), "a=b; Path=/chat/api");
  assert.equal(rewriteSetCookie("a=b; Path=/chat/api"), "a=b; Path=/chat/api");
  assert.equal(
    rewriteSetCookie("a=b; Domain=shamwari.ai; Path=/"),
    "a=b; Path=/chat",
  );
  assert.equal(rewriteSetCookie("__Host-s=1; Path=/; Secure"), null);
  assert.equal(rewriteSetCookie("__host-s=1; Path=/; Secure"), null);
});

test("only hashed assets are immutable; the API is never cached", () => {
  const imm = "public, max-age=31536000, immutable";
  assert.equal(
    cacheControl("/chat/assets/index-Bx12_aZq9.js", "GET", 200),
    imm,
  );
  assert.equal(
    cacheControl("/chat/assets/index-Bx12_aZq9.js", "GET", 404),
    "no-cache",
  );
  assert.equal(
    cacheControl("/chat/assets/index-Bx12_aZq9.js", "POST", 200),
    "no-cache",
  );
  assert.equal(cacheControl("/chat/assets/logo.png", "GET", 200), "no-cache");
  assert.equal(cacheControl("/chat/", "GET", 200), "no-cache");
  assert.equal(cacheControl("/chat/api/messages", "GET", 200), "no-store");
  assert.equal(
    cacheControl("/chat/oauth/openid/callback", "GET", 302),
    "no-store",
  );
});

test("CSP carries the same-origin limits", () => {
  for (const d of [
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "connect-src 'self'",
  ])
    assert.ok(CSP.includes(d), d);
});

test("outside /chat is a plain 404 and the origin is never called", async () => {
  const o = origin(new Response("x"));
  for (const p of ["/", "/chatter", "/lite/", "/chat-x"]) {
    const r = await call(p, o);
    assert.equal(r.status, 404, p);
  }
  assert.equal(o.seen.length, 0);
});

test("/chat redirects to /chat/ keeping the query", async () => {
  const o = origin(new Response("x"));
  const r = await call("/chat?a=1", o);
  assert.equal(r.status, 308);
  assert.equal(r.headers.get("location"), "/chat/?a=1");
  assert.equal(o.seen.length, 0);
});

test("with no origin binding it answers 503 and sends nothing", async () => {
  const r = await worker.fetch(new Request(PUB + "/chat/"), {});
  assert.equal(r.status, 503);
  assert.equal(r.headers.get("cache-control"), "no-store");
});

test("the origin sees the stripped path, query, method and body", async () => {
  const o = origin(new Response("{}", { status: 200 }));
  await call("/chat/api/messages?x=1&y=2", o, {
    method: "POST",
    body: '{"a":1}',
    headers: { "content-type": "application/json" },
  });
  assert.equal(o.seen.length, 1);
  const s = o.seen[0];
  assert.equal(
    new URL(s.url).pathname + new URL(s.url).search,
    "/api/messages?x=1&y=2",
  );
  assert.equal(s.method, "POST");
  assert.equal(s.body, '{"a":1}');
});

test("forwarded headers are the proxy's, not the visitor's", async () => {
  const o = origin(new Response("ok"));
  await call("/chat/", o, {
    headers: {
      "x-forwarded-host": "evil.example",
      "x-forwarded-for": "1.2.3.4",
      "x-real-ip": "1.2.3.4",
      cookie: "a=b",
    },
  });
  const h = o.seen[0].headers;
  assert.equal(h["x-forwarded-host"], "shamwari.ai");
  assert.equal(h["x-forwarded-proto"], "https");
  assert.equal(h["x-forwarded-for"], undefined);
  assert.equal(h["x-real-ip"], undefined);
  assert.equal(h.cookie, "a=b");
});

test("response: Location, every Set-Cookie, security headers, no framework banner", async () => {
  const headers = new Headers({
    location: "/c/new",
    "x-powered-by": "Express",
    server: "x",
  });
  headers.append("set-cookie", "refreshToken=a; Path=/; HttpOnly; Secure");
  headers.append(
    "set-cookie",
    "token_provider=openid; Domain=shamwari.ai; Path=/",
  );
  headers.append("set-cookie", "__Host-bad=1; Path=/; Secure");
  const o = origin(new Response(null, { status: 302, headers }));
  const r = await call("/chat/login", o);
  assert.equal(r.status, 302);
  assert.equal(r.headers.get("location"), "/chat/c/new");
  assert.deepEqual(r.headers.getSetCookie(), [
    "refreshToken=a; Path=/chat; HttpOnly; Secure",
    "token_provider=openid; Path=/chat",
  ]);
  assert.equal(r.headers.get("content-security-policy"), CSP);
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.equal(r.headers.get("x-frame-options"), "DENY");
  assert.equal(r.headers.get("x-powered-by"), null);
  assert.equal(r.headers.get("server"), null);
});

test("no cookie the proxy returns can be sent outside /chat", async () => {
  const headers = new Headers();
  for (const c of [
    "a=1",
    "b=2; Path=/",
    "c=3; Path=/x",
    "d=4; Domain=shamwari.ai",
    "e=5; Path=/chat",
  ])
    headers.append("set-cookie", c);
  const r = await call(
    "/chat/api/auth/refresh",
    origin(new Response("ok", { headers })),
  );
  const set = r.headers.getSetCookie();
  assert.equal(set.length, 5);
  for (const c of set) {
    assert.match(c, /; Path=\/chat(\/[^;]*)?(;|$)/, c);
    assert.doesNotMatch(c, /Domain=/i, c);
  }
});

test("an unreachable origin is a 502 with no detail", async () => {
  const o = {
    async fetch() {
      throw new Error("connect ECONNREFUSED 10.0.0.9:3080");
    },
  };
  const r = await call("/chat/", o);
  assert.equal(r.status, 502);
  assert.doesNotMatch(await r.text(), /ECONNREFUSED|10\.0/);
});

test("the response body is streamed through untouched", async () => {
  const r = await call(
    "/chat/",
    origin(
      new Response("<html>hi</html>", {
        headers: { "content-type": "text/html" },
      }),
    ),
  );
  assert.equal(await r.text(), "<html>hi</html>");
});

// ---- the config can switch nothing on, and the source holds no provider --------------

const strip = (s) => s.replace(/\/\/.*$/gm, "").replace(/,(\s*[}\]])/g, "$1");
test("wrangler.jsonc declares no route, domain, public URL or binding", () => {
  const text = strip(
    readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
  );
  const cfg = JSON.parse(text);
  for (const k of [
    "routes",
    "route",
    "custom_domain",
    "vpc_services",
    "services",
    "kv_namespaces",
    "r2_buckets",
    "d1_databases",
    "secrets_store_secrets",
    "vars",
  ]) {
    assert.equal(cfg[k], undefined, `wrangler.jsonc must not declare ${k}`);
  }
  assert.equal(cfg.workers_dev, false);
  assert.equal(cfg.preview_urls, false);
});

test("no inference-provider host or key name appears in the proxy", () => {
  const dir = new URL("../src/", import.meta.url);
  const bad =
    /(openai|anthropic|api\.z\.ai|moonshot|dashscope|groq|mistral|openrouter|deepseek|OPENAI_API_KEY|ANTHROPIC_API_KEY)/i;
  for (const f of readdirSync(dir))
    assert.doesNotMatch(readFileSync(new URL(f, dir), "utf8"), bad, f);
});
