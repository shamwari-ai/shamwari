// Pure functions for the /chat reverse proxy (docs/librechat.md, "Sub-path hosting").
// LibreChat's server mounts everything at the root and expects whatever sits in front
// of it to strip the prefix. No I/O here, so every rule is unit-testable.

export const PREFIX = "/chat";

/** True for `/chat` and `/chat/...` only. `/chatter` and `/chat-x` are not ours. */
export function inScope(pathname) {
  return pathname === PREFIX || pathname.startsWith(PREFIX + "/");
}

/** `/chat/api/x` -> `/api/x`; `/chat/` -> `/`. Caller has checked `inScope`. */
export function stripPrefix(pathname) {
  const rest = pathname.slice(PREFIX.length);
  return rest === "" ? "/" : rest;
}

/**
 * Re-prefix a `Location` from the origin. The origin is root-relative, so `/login` must
 * become `/chat/login`. Anything already under `/chat`, and any other host (the sign-in
 * provider), is left alone. An absolute URL on our own host is treated like a relative one.
 */
export function rewriteLocation(location, publicOrigin) {
  if (location == null || location === "") return location;
  let target;
  try {
    target = new URL(location, publicOrigin);
  } catch {
    return location;
  }
  if (target.origin !== new URL(publicOrigin).origin) return location;
  if (inScope(target.pathname))
    return target.pathname + target.search + target.hash;
  return PREFIX + target.pathname + target.search + target.hash;
}

/**
 * Scope one `Set-Cookie` to `/chat`, so LibreChat's cookies are never sent to the marketing
 * pages or the light chat on the same origin. Returns the new header, or null to drop it.
 *  - `Path=/` or no Path -> `Path=/chat`; `Path=/x` -> `Path=/chat/x`; `/chat...` is kept.
 *  - `Domain` is removed, so the cookie is host-only.
 *  - `__Host-` cookies must have `Path=/`, which would defeat the scoping: dropped.
 */
export function rewriteSetCookie(header) {
  const parts = header.split(";").map((p) => p.trim());
  const nameValue = parts.shift() ?? "";
  const name = nameValue.split("=")[0].trim();
  if (name.toLowerCase().startsWith("__host-")) return null;
  let path = null;
  const attrs = [];
  for (const p of parts) {
    if (p === "") continue;
    const key = p.split("=")[0].trim().toLowerCase();
    if (key === "path") {
      path = p.slice(p.indexOf("=") + 1).trim();
    } else if (key === "domain") {
      // dropped: host-only
    } else {
      attrs.push(p);
    }
  }
  let scoped;
  if (path == null || path === "" || path === "/") scoped = PREFIX;
  else if (path === PREFIX || path.startsWith(PREFIX + "/")) scoped = path;
  else scoped = PREFIX + (path.startsWith("/") ? path : "/" + path);
  return [nameValue, "Path=" + scoped, ...attrs].join("; ");
}

/**
 * Same-origin risk (docs/librechat.md): LibreChat shares an origin with the marketing site
 * and the light chat, whose history is in IndexedDB. These are the response limits that do
 * not depend on LibreChat's inline scripts. `script-src` is NOT here yet: it needs the real
 * build's inline scripts read first (listed as "to test" in the doc).
 */
export const CSP = [
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "connect-src 'self'",
].join("; ");

const HASHED_ASSET =
  /^\/chat\/assets\/.+-[A-Za-z0-9_-]{8,}\.(?:js|css|woff2?|ttf|png|jpe?g|svg|webp|avif|ico|map)$/;

/** Cache rule by path. Only files whose name carries a content hash are immutable. */
export function cacheControl(pathname, method, status) {
  if (
    pathname.startsWith(PREFIX + "/api/") ||
    pathname.startsWith(PREFIX + "/oauth/")
  )
    return "no-store";
  if (method === "GET" && status === 200 && HASHED_ASSET.test(pathname)) {
    return "public, max-age=31536000, immutable";
  }
  return "no-cache";
}

/** Headers the proxy sets itself, never trusting the visitor's. */
export function originRequestHeaders(inbound, publicOrigin) {
  const h = new Headers(inbound);
  for (const k of [...h.keys()]) {
    if (k.startsWith("x-forwarded-") || k === "forwarded" || k === "x-real-ip")
      h.delete(k);
  }
  const pub = new URL(publicOrigin);
  h.set("x-forwarded-proto", pub.protocol.replace(":", ""));
  h.set("x-forwarded-host", pub.host);
  return h;
}
