// Drives a real LibreChat (the pinned build) against the stub gateway and checks the
// Rule 1 claims from docs/librechat.md. Exits non-zero on the first broken claim.
// Runs in the same network namespace as LibreChat and the stub.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const APP = "http://127.0.0.1:3080";
const STUB = "http://127.0.0.1:8787";
const NIL = "00000000-0000-0000-0000-000000000000";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const note = (k, v) => console.log(`[observed] ${k}=${JSON.stringify(v)}`);

async function until(label, fn, ms = 120_000) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) {
      last = e;
    }
    await sleep(1500);
  }
  throw new Error(
    `timed out waiting for ${label}${last ? `: ${last.message}` : ""}`,
  );
}

// LibreChat refuses requests whose User-Agent is not a recognised browser ("Illegal
// request", api/server/middleware/uaParser.js), so the driver presents as one.
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const json = async (path, init = {}) => {
  const res = await fetch(APP + path, {
    ...init,
    headers: { "user-agent": UA, ...init.headers },
  });
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, body, text };
};

// Loopback inside an isolated container network, no TLS by design; the React rule does not apply to this Node script.
// nosemgrep: typescript.react.security.react-insecure-request.react-insecure-request
const stubLog = async () => (await fetch(`${STUB}/__log`)).json();

await until(
  "LibreChat to be up",
  // nosemgrep: typescript.react.security.react-insecure-request.react-insecure-request
  async () => (await fetch(`${APP}/health`)).ok,
);
console.log("LibreChat is up");

// 1. A throwaway account.
const email = `e2e-${randomUUID().slice(0, 8)}@example.test`;
const password = `Pw-${randomUUID()}`;
const reg = await json("/api/auth/register", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    name: "E2E",
    username: "e2e",
    email,
    password,
    confirm_password: password,
  }),
});
note("register.status", reg.status);
assert.ok(
  reg.status === 200 || reg.status === 201,
  `register failed: ${reg.status} ${reg.text.slice(0, 300)}`,
);
const login = await json("/api/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email, password }),
});
assert.equal(
  login.status,
  200,
  `login failed: ${login.status} ${login.text.slice(0, 300)}`,
);
const token = login.body.token;
assert.ok(token, "no token");
const auth = {
  authorization: `Bearer ${token}`,
  "content-type": "application/json",
  "user-agent": UA,
};

// 2. Ask a question through one endpoint; return what the person would be shown.
async function ask(endpoint, text) {
  const payload = JSON.stringify({
    text,
    endpoint,
    endpointType: "custom",
    model: "shamwari-economy",
    messageId: randomUUID(),
    parentMessageId: NIL,
    isCreatedByUser: true,
    sender: "User",
  });
  // LibreChat answers 503 SERVER_NOT_READY for a short window after /health is green
  // (first run, CI). Wait it out; any other status is a real answer.
  let res;
  for (let i = 0; i < 40; i++) {
    res = await json(`/api/agents/chat/${encodeURIComponent(endpoint)}`, {
      method: "POST",
      headers: auth,
      body: payload,
    });
    if (res.body?.code !== "SERVER_NOT_READY") break;
    await sleep(3000);
  }
  note(`ask(${endpoint}).status`, res.status);
  assert.ok(
    res.status < 300,
    `chat request refused: ${res.status} ${res.text.slice(0, 400)}`,
  );
  const conversationId = res.body?.conversationId ?? res.body?.streamId;
  assert.ok(conversationId, `no conversation id: ${res.text.slice(0, 300)}`);
  // Read the stream so the generation runs to its end, then read what was stored.
  const stream = await fetch(
    `${APP}/api/agents/chat/stream/${conversationId}`,
    { headers: auth },
  );
  const streamText = await stream.text();
  let shown = "";
  await until(
    `the ${endpoint} answer to be stored`,
    async () => {
      const m = await json(`/api/messages/${conversationId}`, {
        headers: auth,
      });
      const list = Array.isArray(m.body) ? m.body : (m.body?.messages ?? []);
      const reply = list.find((x) => x.isCreatedByUser === false);
      if (!reply) return false;
      shown =
        typeof reply.text === "string" && reply.text
          ? reply.text
          : JSON.stringify(reply.content ?? "");
      return shown.length > 0;
    },
    60_000,
  );
  return { shown, streamText };
}

// 3. Platform scope reaches the gateway, and only the gateway.
const platform = await ask(
  "Shamwari",
  "What does section 56 of the Constitution say?",
);
note("platform.shown", platform.shown.slice(0, 200));
// Always show what the stub received, so a failure here is diagnosable from the log.
note("stub.log.after-platform", await stubLog());
assert.match(
  platform.shown,
  /STUB-ANSWER/,
  "the gateway's answer was not shown",
);

// 4. Personal scope: the gateway refuses with 409 and no answer is produced (Rule 1).
const personal = await ask("Shamwari (personal)", "What is in my payslip?");
note("personal.shown", personal.shown.slice(0, 400));
assert.match(
  personal.shown,
  /scope_requires_local_inference/,
  "the refusal did not reach the person",
);
assert.doesNotMatch(
  personal.shown,
  /STUB-ANSWER/,
  "a personal question was answered",
);
// The plain sentence is NOT shown yet: the OpenAI client keeps only the error code
// from the gateway's body, so LibreChat prints the code. Tracked in docs/librechat.md
// ("A fork patch maps the code to the sentence"); recorded here so it cannot go unseen.
note(
  "personal.plain_sentence_shown",
  /Personal-layer data cannot be sent/.test(personal.shown),
);

// 5. What LibreChat actually sent. This is the Rule 1 record.
const log = await stubLog();
note("stub.log", log);
const calls = log.filter((e) => e.path === "/v1/chat/completions");
assert.equal(
  log.length,
  calls.length,
  `LibreChat called something other than chat completions: ${JSON.stringify(log.map((e) => e.path))}`,
);
assert.equal(
  calls.length,
  2,
  `expected exactly one call per question (no title or helper calls), got ${calls.length}`,
);
assert.deepEqual(
  calls.map((c) => c.scope),
  ["platform", "personal"],
  "scope did not reach the gateway as configured",
);
for (const c of calls) {
  assert.ok(
    !c.keys.includes("user"),
    "LibreChat sent its internal user id to the gateway",
  );
  assert.equal(c.channel, "pwa", "X-Shamwari-Channel: pwa was not sent");
  assert.equal(c.auth, "Bearer", "no bearer authorization");
  assert.notEqual(c.stream, true, "LibreChat asked the gateway for a stream");
}

// 6. Informational, not a pass/fail yet: are the gateway's citations shown?
note(
  "citations.visible",
  /Constitution of Zimbabwe/.test(platform.shown) ||
    /section 56/.test(platform.shown),
);

console.log(
  "OK: LibreChat talked only to the stub gateway, with the configured scopes",
);
