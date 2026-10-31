// A stand-in for the Shamwari gateway, so the chat app can be built and tested
// before Core is deployed (shamwari-ai/shamwari#81, #19). It speaks the same
// wire contract as gateway/src/index.ts — POST /v1/chat/completions with a
// Bearer key — and answers from a few canned fixtures. It is a test tool, not
// a product: it has no model, no Ground, and no auth beyond the key's prefix.
//
//   node chat-mock/server.mjs [port]       (default 8788)
//
// Magic keys and magic words steer the failures the UI must handle:
//   key  sk_shamwari_mock_ok        answers normally
//   key  sk_shamwari_mock_402       -> 402        key  ..._429  -> 429 + Retry-After
//   key  sk_shamwari_mock_503       -> 503        key  ..._403  -> 403
//   anything else not starting with sk_shamwari_  -> 401
//   body.scope === 'personal'       -> 409 scope_requires_local_inference
//   a question containing "slow"    -> answers after 3 s
//   a question containing "nosource"-> an answer with no citations
import { createServer } from 'node:http';

export const FIXTURES = [
  {
    match: /equal|discriminat|tinashe|ruremekedzo/i,
    text:
      'Section 56 of the Constitution says everyone is equal before the law and has the right to equal protection and benefit of the law. ' +
      'It bars unfair discrimination on grounds such as nationality, race, gender, language and disability.',
    citations: [
      {
        title: 'Constitution of Zimbabwe Amendment (No. 20) Act 2013',
        heading: 'Section 56 — Equality and non-discrimination',
        authority: 'Parliament of Zimbabwe',
        effective_from: '2013-05-22',
        url: 'https://www.parlzim.gov.zw/',
      },
    ],
  },
  {
    match: /./,
    text:
      'Under the Constitution, every person has the right to life (section 48) and to personal liberty (section 49). ' +
      'Ask about a specific section and Shamwari will quote it.',
    citations: [
      {
        title: 'Constitution of Zimbabwe Amendment (No. 20) Act 2013',
        heading: 'Section 48 — Right to life',
        authority: 'Parliament of Zimbabwe',
        effective_from: '2013-05-22',
        url: 'https://www.parlzim.gov.zw/',
      },
      {
        title: 'Constitution of Zimbabwe Amendment (No. 20) Act 2013',
        heading: 'Section 49 — Right to personal liberty',
        authority: 'Parliament of Zimbabwe',
        effective_from: '2013-05-22',
        url: null,
      },
    ],
  },
];

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, idempotency-key, x-shamwari-channel',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  // Without this a browser hides Retry-After from the page, and the app cannot say how long to wait.
  'Access-Control-Expose-Headers': 'Retry-After',
};

const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json', ...cors, ...headers });
  res.end(JSON.stringify(body));
};

const replays = new Map();

export function createMock() {
  return createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors);
      return res.end();
    }
    if (req.method === 'GET' && req.url === '/health') return send(res, 200, { ok: true });
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
      return send(res, 404, { error: 'not_found' });
    }
    const key = (req.headers.authorization ?? '').replace(/^Bearer\s+/, '');
    if (!key.startsWith('sk_shamwari_')) return send(res, 401, { error: 'invalid_key' });
    if (key.endsWith('_402')) return send(res, 402, { error: 'payment_required' });
    if (key.endsWith('_403')) return send(res, 403, { error: 'scope_not_permitted_for_key' });
    if (key.endsWith('_429'))
      return send(res, 429, { error: 'quota_exceeded', upgrade: 'https://platform.shamwari.ai/billing' }, { 'Retry-After': '30' });
    if (key.endsWith('_503')) return send(res, 503, { error: 'auth_unavailable' }, { 'Retry-After': '5' });

    let raw = '';
    for await (const chunk of req) raw += chunk;
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return send(res, 400, { error: 'invalid_json' });
    }
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return send(res, 400, { error: 'messages_required' });
    }
    if (body.scope === 'personal') {
      // Same payload as gateway/src/scope.ts ScopeRefusal.toPayload().
      return send(res, 409, {
        error: 'scope_requires_local_inference',
        scope: 'personal',
        message: 'Personal-layer data cannot be sent to an external inference provider.',
        capability: 'cloud_inference',
        docs: 'https://docs.shamwari.ai/scopes',
      });
    }

    const idem = req.headers['idempotency-key'];
    if (idem && replays.has(idem)) return send(res, 200, replays.get(idem));

    const q = String(body.messages.at(-1)?.content ?? '');
    if (/slow/i.test(q)) await new Promise((r) => setTimeout(r, 3000));
    const fx = FIXTURES.find((f) => f.match.test(q));
    const out = {
      id: `mock-${Math.random().toString(36).slice(2, 10)}`,
      model: 'shamwari-economy',
      choices: [{ index: 0, message: { role: 'assistant', content: fx.text }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 40, total_tokens: 50 },
      shamwari: {
        tier: 'economy',
        scope: body.scope ?? 'platform',
        language: null,
        grounded: !/nosource/i.test(q),
        truncated: false,
        inference_path: 'gateway',
        model_served: 'workers-ai/mock',
        citations: /nosource/i.test(q) ? [] : fx.citations,
      },
    };
    if (idem) replays.set(idem, out);
    send(res, 200, out);
  });
}

// Run directly: start listening.
import { fileURLToPath } from 'node:url';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2] ?? 8788);
  createMock().listen(port, () => console.log(`shamwari gateway mock on http://localhost:${port}`));
}
