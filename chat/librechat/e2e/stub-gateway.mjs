// A stand-in for the Shamwari gateway (gateway/src/index.ts, scope.ts). It mimics
// what LibreChat will see, including the two things that matter here: the 409 for
// personal scope, and that the gateway does NOT stream (it ignores `stream`).
// It records every request so the driver can prove what LibreChat sent and nothing else.
import { createServer } from "node:http";

const log = [];
const COMPLETIONS = "/v1/chat/completions";

const REFUSAL = {
  error: "scope_requires_local_inference",
  scope: "personal",
  message:
    "Personal-layer data cannot be sent to an external inference provider. " +
    "This endpoint generates its answer on Cloud, so it cannot serve " +
    "personal scope at all. Retrieve context from /v1/ground/context " +
    "and generate on the device with Shamwari Mind.",
  capability: "cloud_inference",
  docs: "https://docs.shamwari.ai/scopes",
};

const server = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    if (req.url === "/__log") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(log));
    }
    let body = null;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      body = null;
    }
    log.push({
      method: req.method,
      path: req.url,
      scope: body?.scope ?? null,
      stream: body?.stream ?? null,
      model: body?.model ?? null,
      channel: req.headers["x-shamwari-channel"] ?? null,
      // Only whether an Authorization header was present and its scheme, never a value.
      auth: req.headers.authorization
        ? req.headers.authorization.split(" ")[0]
        : null,
      keys: body ? Object.keys(body).sort() : [],
    });
    if (req.method !== "POST" || req.url !== COMPLETIONS) {
      res.writeHead(404, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: "not_found" }));
    }
    const scope =
      body?.scope === "personal" || body?.scope === "community"
        ? body.scope
        : "platform";
    if (scope === "personal") {
      res.writeHead(409, { "content-type": "application/json" });
      return res.end(JSON.stringify(REFUSAL));
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        id: "stub-1",
        object: "chat.completion",
        created: 0,
        model: "shamwari-economy",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "STUB-ANSWER" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        shamwari: {
          scope,
          inference_path: "gateway",
          citations: [
            {
              title: "Constitution of Zimbabwe",
              heading: "section 56",
              url: "https://example.org/constitution",
            },
          ],
        },
      }),
    );
  });
});

server.listen(8787, "127.0.0.1", () =>
  console.log("stub gateway on 127.0.0.1:8787"),
);
