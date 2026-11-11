import {
  CSP,
  PREFIX,
  cacheControl,
  inScope,
  originRequestHeaders,
  rewriteLocation,
  rewriteSetCookie,
  stripPrefix,
} from "./rewrite.js";

// The proxy Worker for https://shamwari.ai/chat (docs/librechat.md). It reaches LibreChat
// only through the `CHAT_ORIGIN` binding (a Workers VPC service or a service binding), never
// by a public address. With no binding it answers 503 and sends nothing anywhere.
//
// Routes are NOT declared in wrangler.jsonc. Attaching `shamwari.ai/chat` and
// `shamwari.ai/chat/*` to this Worker is the owner's cutover step 7.

const PUBLIC_ORIGIN = "https://shamwari.ai";

function plain(status, text) {
  return new Response(text, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!inScope(url.pathname)) return plain(404, "Not found");

    // `/chat` -> `/chat/`: the page's <base href> only works with the trailing slash.
    if (url.pathname === PREFIX) {
      return new Response(null, {
        status: 308,
        headers: {
          Location: PREFIX + "/" + url.search,
          "Cache-Control": "no-cache",
        },
      });
    }

    const origin = env?.CHAT_ORIGIN;
    if (!origin || typeof origin.fetch !== "function")
      return plain(503, "Chat is not available yet.");

    const target = new URL(
      stripPrefix(url.pathname) + url.search,
      "http://chat-origin.internal",
    );
    const init = {
      method: req.method,
      headers: originRequestHeaders(req.headers, PUBLIC_ORIGIN),
      redirect: "manual",
    };
    if (req.method !== "GET" && req.method !== "HEAD") {
      init.body = req.body;
      init.duplex = "half"; // a streamed body; Node and browsers require it, Workers ignore it
    }

    let res;
    try {
      res = await origin.fetch(new Request(target, init));
    } catch {
      return plain(502, "Chat is temporarily unavailable.");
    }

    const headers = new Headers(res.headers);
    headers.delete("x-powered-by");
    headers.delete("server");

    const location = headers.get("location");
    if (location)
      headers.set("location", rewriteLocation(location, PUBLIC_ORIGIN));

    const cookies =
      typeof res.headers.getSetCookie === "function"
        ? res.headers.getSetCookie()
        : [];
    if (cookies.length > 0 || headers.has("set-cookie")) {
      headers.delete("set-cookie");
      for (const c of cookies) {
        const scoped = rewriteSetCookie(c);
        if (scoped !== null) headers.append("set-cookie", scoped);
      }
    }

    headers.set("content-security-policy", CSP);
    headers.set("x-content-type-options", "nosniff");
    headers.set("x-frame-options", "DENY");
    headers.set("referrer-policy", "strict-origin-when-cross-origin");
    headers.set(
      "cache-control",
      cacheControl(url.pathname, req.method, res.status),
    );

    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers,
    });
  },
};
