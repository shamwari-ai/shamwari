// Open Responses, POST /v1/responses (src/responses.ts), pinned to the 2026-04-24 spec.
//
// The endpoint is a translator in front of /v1/chat/completions, so most of these tests
// send the same question both ways and assert the two worlds are the same: the same
// provider calls (counted, as in test/scope-decision.test.ts), the same Core calls, the
// same stored rows. Rule 1 and rule 2 then hold on the new path because they hold on the
// old one, and a difference between the two is a failing test.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';
import { translateRequest } from '../src/responses';
import { OWN_INFORMATION_CODE } from '../src/personal';
import type { Env, GroundChunk, SinkMessage } from '../src/types';

const CHUNK: GroundChunk = {
  content: 'Every person has the right to life.',
  heading: 'Section 48',
  title: 'Constitution of Zimbabwe',
  authority: 'Parliament of Zimbabwe',
  resource_type: 'legislation',
  source_url: 'https://example.invalid/constitution',
  effective_from: '2013-05-22',
  scope: 'platform',
};

const AUTH = {
  apiKeyId: 'k1',
  ownerEntityId: 'e1',
  ownerPersonId: null,
  keyType: 'standard',
  tier: 'community',
  monthlyTokenCap: 100_000,
};

const PERSONAL_Q = 'How much PAYE do I owe on my salary?';
const PLAIN_Q = 'What does section 48 of the Constitution say?';
const SITE = 'https://shamwari.ai';

interface Wire {
  embed: number;
  core: Record<string, any>[];
  /** Every completion request: the scope in its metadata and the messages it carried. */
  completions: { scope: string | undefined; messages: { role: string; content: string }[] }[];
  sink: SinkMessage[];
  usage: Record<string, unknown>[];
}

function setup(
  opts: {
    consent?: boolean;
    scopes?: string[];
    overQuota?: boolean;
    finish?: string;
    inferenceFails?: boolean;
    chunks?: GroundChunk[];
  } = {},
) {
  const wire: Wire = { embed: 0, core: [], completions: [], sink: [], usage: [] };
  const store = new Map<string, string>();
  const auth = {
    ...AUTH,
    ...(opts.consent === undefined ? {} : { trainingConsent: opts.consent }),
    ...(opts.scopes ? { scopes: opts.scopes } : {}),
  };
  const env = {
    AI: {
      run: vi.fn(async () => {
        wire.embed += 1;
        return { data: [Array.from({ length: 1024 }, () => 0.1)], response: 'fallback' };
      }),
    },
    AUTH_CACHE: {
      get: async (k: string) => (k.startsWith('auth:') ? auth : JSON.parse(store.get(k) ?? 'null')),
      put: async (k: string, v: string) => void (!k.startsWith('auth:') && store.set(k, v)),
      delete: async (k: string) => void store.delete(k),
    },
    SINK: {
      send: async (m: SinkMessage) => void wire.sink.push(m),
      sendBatch: async (ms: { body: SinkMessage }[]) => void wire.sink.push(...ms.map((m) => m.body)),
    },
    CORE_URL: 'https://core.example',
    SHAMWARI_CORE_TOKEN: 't',
    EMBEDDING_MODEL: '@cf/baai/bge-m3',
    GROUND_TOP_K: '6',
    AUTH_CACHE_TTL: '300',
    ECONOMY_MODEL: '@cf/zai-org/glm-5.3-flash',
    STANDARD_MODEL: '@cf/zai-org/glm-5.3',
    SURFACE: 'shamwari.ai',
    MIND_AVAILABLE: 'false',
    CF_ACCOUNT_ID: 'acct',
    CF_GATEWAY_ID: 'gw',
    CF_ROUTE_NAME: 'shamwari',
    CF_AIG_TOKEN: { get: async () => 'aig' },
  } as unknown as Env;

  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('/rollup')) return Response.json({ total_tokens: opts.overQuota ? 1e9 : 0 });
    if (u.includes('/usage') || u.includes('/meter')) {
      wire.usage.push(JSON.parse(String(init?.body ?? '{}')));
      return Response.json({ ok: true });
    }
    if (u.includes('/ground/search')) {
      const body = JSON.parse(String(init?.body)) as Record<string, any>;
      wire.core.push(body);
      const chunks = (opts.chunks ?? [CHUNK]).map((c) => ({ ...c, scope: body.scope }));
      return Response.json({ chunks, hit: chunks.length > 0, scope: body.scope });
    }
    const meta = JSON.parse(String((init?.headers as Record<string, string>)['cf-aig-metadata'] ?? '{}'));
    const sent = JSON.parse(String(init?.body ?? '{}'));
    wire.completions.push({ scope: meta.scope, messages: sent.messages ?? [] });
    return opts.inferenceFails
      ? new Response('down', { status: 503 })
      : Response.json({
          choices: [{ message: { content: 'Section 48 protects the right to life.' }, finish_reason: opts.finish ?? 'stop' }],
          usage: { prompt_tokens: 120, completion_tokens: 9 },
        });
  });
  return { env, wire };
}

const pending: Promise<unknown>[] = [];
const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p.catch(() => {})) } as unknown as ExecutionContext;
const settle = () => Promise.all(pending.splice(0));

const request = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`https://gw.example${path}`, {
    method: 'POST',
    headers: { Authorization: 'Bearer sk_shamwari_test', 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const responses = (body: unknown, headers?: Record<string, string>) => request('/v1/responses', body, headers);
const chat = (q: string, extra: Record<string, unknown> = {}, headers?: Record<string, string>) =>
  request('/v1/chat/completions', { messages: [{ role: 'user', content: q }], ...extra }, headers);

/** What a world saw, without ids and timestamps, so two worlds can be compared. */
const seen = (w: Wire) => ({
  embed: w.embed,
  core: w.core.map(({ scope, needs_own_information }) => ({ scope, needs_own_information })),
  completions: w.completions,
  sink: w.sink.map((m) => {
    const { requestId, createdAt, lastMessageAt, latencyMs, ...rest } = m.doc as Record<string, unknown>;
    return { collection: m.collection, ...rest };
  }),
});

/** The same question through /v1/chat/completions and /v1/responses, in two fresh worlds. */
async function both(
  q: string,
  opts: Parameters<typeof setup>[0] = {},
  extra: Record<string, unknown> = {},
  headers: Record<string, string> = {},
) {
  const a = setup(opts);
  const viaChat = await (await worker.fetch(chat(q, extra, headers), a.env, ctx)).clone();
  await settle();
  const b = setup(opts);
  const viaResponses = await worker.fetch(responses({ input: q, ...extra }, headers), b.env, ctx);
  await settle();
  return { viaChat, viaResponses, chatWire: a.wire, responsesWire: b.wire };
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('round trip', () => {
  it('a string input comes back as a completed response with one assistant message', async () => {
    const { env, wire } = setup();
    const res = await worker.fetch(responses({ model: 'shamwari', input: PLAIN_Q, metadata: { ticket: 'A-1' } }), env, ctx);
    await settle();
    expect(res.status).toBe(200);
    // "HTTP Responses": not streaming, so application/json only.
    expect(res.headers.get('Content-Type')).toBe('application/json');
    const r = (await res.json()) as any;
    expect(r.object).toBe('response');
    expect(r.id).toMatch(/^resp_[0-9a-f]{32}$/);
    expect(r.status).toBe('completed');
    expect(r.error).toBeNull();
    expect(r.incomplete_details).toBeNull();
    expect(typeof r.created_at).toBe('number');
    expect(r.completed_at).toBeGreaterThanOrEqual(r.created_at);
    expect(r.output).toEqual([
      {
        type: 'message',
        id: expect.stringMatching(/^msg_[0-9a-f]{32}$/),
        status: 'completed',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'Section 48 protects the right to life.', annotations: [], logprobs: [] }],
      },
    ]);
    expect(r.usage).toEqual({
      input_tokens: 120,
      output_tokens: 9,
      total_tokens: 129,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 0 },
    });
    expect(r.metadata).toEqual({ ticket: 'A-1' });
    expect(r.store).toBe(false);
    expect(r.previous_response_id).toBeNull();
    expect(r.tools).toEqual([]);
    // The question reached the model once, as the user's turn, after Ground's system prompt.
    expect(wire.completions).toHaveLength(1);
    expect(wire.completions[0]!.messages.at(-1)).toEqual({ role: 'user', content: PLAIN_Q });
    expect(wire.completions[0]!.messages[0]!.role).toBe('system');
  });

  it('every field the 2026-04-24 ResponseResource requires is present', async () => {
    const { env } = setup();
    const r = (await (await worker.fetch(responses({ input: PLAIN_Q }), env, ctx)).json()) as Record<string, unknown>;
    // ResponseResource.required in public/openapi/2026-04-24/openapi.json.
    const required = [
      'id', 'object', 'created_at', 'completed_at', 'status', 'incomplete_details', 'model',
      'previous_response_id', 'instructions', 'output', 'error', 'tools', 'tool_choice', 'truncation',
      'parallel_tool_calls', 'text', 'top_p', 'presence_penalty', 'frequency_penalty', 'top_logprobs',
      'temperature', 'reasoning', 'usage', 'max_output_tokens', 'max_tool_calls', 'store', 'background',
      'service_tier', 'metadata', 'safety_identifier', 'prompt_cache_key',
    ];
    for (const k of required) expect(r, k).toHaveProperty(k);
  });

  it('message items with input_text, and earlier assistant turns, become the chat messages', async () => {
    const { env, wire } = setup();
    const res = await worker.fetch(
      responses({
        input: [
          { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'What is section 48?' }] },
          { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'The right to life.' }] },
          { role: 'user', content: [{ type: 'input_text', text: 'Who' }, { type: 'input_text', text: 'does it cover?' }] },
        ],
      }),
      env,
      ctx,
    );
    expect(res.status).toBe(200);
    expect(wire.completions[0]!.messages.slice(1)).toEqual([
      { role: 'user', content: 'What is section 48?' },
      { role: 'assistant', content: 'The right to life.' },
      { role: 'user', content: 'Who\ndoes it cover?' },
    ]);
  });

  it('carries the Ground citations and provenance in the optional shamwari extension, not in core fields', async () => {
    const { env } = setup();
    const r = (await (await worker.fetch(responses({ input: PLAIN_Q }), env, ctx)).json()) as any;
    expect(r.shamwari.citations).toEqual([
      {
        title: 'Constitution of Zimbabwe',
        heading: 'Section 48',
        authority: 'Parliament of Zimbabwe',
        effective_from: '2013-05-22',
        url: 'https://example.invalid/constitution',
      },
    ]);
    expect(r.shamwari.model_served).toEqual(expect.any(String));
    expect(r.shamwari.model_substituted).toEqual(expect.any(Boolean));
    expect(r.shamwari.inference_path).toEqual(expect.any(String));
    expect(r.shamwari.scope).toBe('platform');
    expect(r.shamwari.answered_without_own_information).toBe(false);
  });

  it('an answer cut off by the token budget is an incomplete item in an incomplete response', async () => {
    const { env } = setup({ finish: 'length' });
    const r = (await (await worker.fetch(responses({ input: PLAIN_Q }), env, ctx)).json()) as any;
    expect(r.status).toBe('incomplete');
    expect(r.incomplete_details).toEqual({ reason: 'max_output_tokens' });
    expect(r.output[0].status).toBe('incomplete');
    expect(r.completed_at).toBeNull();
  });

  it('is metered and recorded exactly as the same request on /v1/chat/completions', async () => {
    const { viaChat, viaResponses, chatWire, responsesWire } = await both(PLAIN_Q, { consent: true });
    expect(viaChat.status).toBe(200);
    expect(viaResponses.status).toBe(200);
    expect(seen(responsesWire)).toEqual(seen(chatWire));
    expect(responsesWire.sink.some((m) => m.collection === 'conversations')).toBe(true);
    // The usage event (the meter is the sink queue in this world) carries tokens and cost.
    const usage = responsesWire.sink.find((m) => m.collection === 'usageEvents')?.doc as Record<string, unknown>;
    expect(usage).toMatchObject({ ownerEntityId: 'e1', apiKeyId: 'k1', inputTokens: 120, outputTokens: 9 });
    expect(usage).toHaveProperty('costUsdEstimate');
  });

  it('an idempotent retry is the same response, run once', async () => {
    const { env, wire } = setup();
    const first = await worker.fetch(responses({ input: PLAIN_Q }, { 'Idempotency-Key': 'retry-1' }), env, ctx);
    await settle();
    const again = await worker.fetch(responses({ input: PLAIN_Q }, { 'Idempotency-Key': 'retry-1' }), env, ctx);
    expect(again.headers.get('Idempotent-Replayed')).toBe('true');
    const [a, b] = [(await first.json()) as any, (await again.json()) as any];
    expect(b.id).toBe(a.id);
    expect(b.output).toEqual(a.output);
    expect(wire.completions).toHaveLength(1);
    expect(wire.core).toHaveLength(1);
  });
});

describe('rule 1 holds on the new path', () => {
  it('an explicit personal scope is the same 409 as on the chat endpoint, and NOTHING is called', async () => {
    for (const q of [PLAIN_Q, PERSONAL_Q]) {
      for (const mode of [undefined, 'extractive']) {
        const opts = { scopes: ['personal', 'community', 'platform'] };
        const { viaChat, viaResponses, chatWire, responsesWire } = await both(q, opts, { scope: 'personal', mode });
        expect(viaChat.status).toBe(409);
        expect(viaResponses.status).toBe(409);
        const err = ((await viaResponses.json()) as any).error;
        expect(err).toMatchObject({ type: 'invalid_request', code: 'scope_requires_local_inference', param: 'scope' });
        expect(err.message).toBe(((await viaChat.json()) as any).message);
        expect(seen(responsesWire)).toEqual({ embed: 0, core: [], completions: [], sink: [] });
        expect(seen(responsesWire)).toEqual(seen(chatWire));
      }
    }
  });

  it('a personal-looking question reaches no model, exactly as on the chat endpoint (shamwari#291)', async () => {
    const { viaChat, viaResponses, chatWire, responsesWire } = await both(PERSONAL_Q, { consent: true });
    expect(viaResponses.status).toBe(200);
    // Counted: no embedding, no completion, one Core call at platform scope, no conversation row.
    expect(responsesWire.embed).toBe(0);
    expect(responsesWire.completions).toHaveLength(0);
    expect(responsesWire.core.map((b) => b.scope)).toEqual(['platform']);
    expect(responsesWire.sink.filter((m) => m.collection === 'conversations')).toHaveLength(0);
    expect(seen(responsesWire)).toEqual(seen(chatWire));

    const r = (await viaResponses.json()) as any;
    const c = (await viaChat.json()) as any;
    expect(r.model).toBe('shamwari-extractive');
    expect(r.output[0].content[0].text).toBe(c.choices[0].message.content);
    expect(r.shamwari.inference_path).toBe('extractive');
    expect(r.shamwari.answered_without_own_information).toBe(true);
    expect(r.shamwari.notice.code).toBe(OWN_INFORMATION_CODE);
  });

  it('the own-information rule sees the same turns: personal text in an input_text part is caught', async () => {
    const { env, wire } = setup();
    const res = await worker.fetch(
      responses({ input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: PERSONAL_Q }] }] }),
      env,
      ctx,
    );
    expect(res.status).toBe(200);
    expect(wire.completions).toHaveLength(0);
    expect(wire.embed).toBe(0);
  });

  it('a key that holds no cloud-safe scope is refused as on the chat endpoint', async () => {
    const { viaChat, viaResponses, responsesWire } = await both(PLAIN_Q, { scopes: ['personal'] });
    expect(viaChat.status).toBe(403);
    expect(viaResponses.status).toBe(403);
    expect(((await viaResponses.json()) as any).error.code).toBe('scope_not_permitted_for_key');
    expect(responsesWire.completions).toHaveLength(0);
  });
});

describe('rule 2 holds on the new path', () => {
  const conversation = (w: Wire) => w.sink.find((m) => m.collection === 'conversations')?.doc as Record<string, any>;

  it('provenance is the served model, stamped as on the chat endpoint', async () => {
    const { responsesWire, chatWire } = await both(PLAIN_Q, { consent: true });
    const row = conversation(responsesWire);
    expect(row.licenseClass).toBe(conversation(chatWire).licenseClass);
    expect(row.teacherModel).toBe(conversation(chatWire).teacherModel);
    expect(['open_weight', 'restricted']).toContain(row.licenseClass);
  });

  it('no consent, no training: the row is not trainable without an explicit trainingConsent: true', async () => {
    for (const consent of [undefined, false]) {
      const { responsesWire, chatWire } = await both(PLAIN_Q, { consent });
      expect(conversation(responsesWire).trainingConsent).toBe(false);
      expect(conversation(responsesWire).trainingEligible).toBe(false);
      expect(conversation(responsesWire).trainingEligible).toBe(conversation(chatWire).trainingEligible);
    }
  });

  it('with consent and an open-weight answer, the row is trainable exactly when it is on the chat endpoint', async () => {
    const { responsesWire, chatWire } = await both(PLAIN_Q, { consent: true });
    expect(conversation(responsesWire).trainingConsent).toBe(true);
    expect(conversation(responsesWire).trainingEligible).toBe(conversation(chatWire).trainingEligible);
  });

  it('the channel marker is forwarded: channel traffic is never trainable, and web chat stores no conversation', async () => {
    const sms = await both(PLAIN_Q, { consent: true }, {}, { 'X-Shamwari-Channel': 'sms' });
    expect(conversation(sms.responsesWire).trainingEligible).toBe(false);
    expect(seen(sms.responsesWire)).toEqual(seen(sms.chatWire));

    const pwa = await both(PLAIN_Q, { consent: true }, {}, { 'X-Shamwari-Channel': 'pwa' });
    expect(conversation(pwa.responsesWire)).toBeUndefined();
    expect(seen(pwa.responsesWire)).toEqual(seen(pwa.chatWire));
  });
});

describe('auth', () => {
  it('no key is a 401 in the spec error shape, and nothing is called', async () => {
    const { env, wire } = setup();
    const res = await worker.fetch(
      new Request('https://gw.example/v1/responses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: PLAIN_Q }),
      }),
      env,
      ctx,
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: { type: 'invalid_request', code: 'invalid_api_key', message: expect.any(String), param: null },
    });
    expect(seen(wire)).toEqual({ embed: 0, core: [], completions: [], sink: [] });
  });

  it('an unauthenticated caller gets a 401 even for a body that would be refused', async () => {
    const { env } = setup();
    const res = await worker.fetch(
      new Request('https://gw.example/v1/responses', { method: 'POST', body: JSON.stringify({ input: 'x', stream: true }) }),
      env,
      ctx,
    );
    expect(res.status).toBe(401);
  });

  it('a spent quota is a 429 too_many_requests, and nothing is generated', async () => {
    const { env, wire } = setup({ overQuota: true });
    const res = await worker.fetch(responses({ input: PLAIN_Q }), env, ctx);
    expect(res.status).toBe(429);
    expect(((await res.json()) as any).error).toMatchObject({ type: 'too_many_requests', code: 'quota_exceeded' });
    expect(wire.completions).toHaveLength(0);
  });

  it('only POST is served', async () => {
    const { env } = setup();
    const res = await worker.fetch(new Request('https://gw.example/v1/responses', { method: 'GET' }), env, ctx);
    expect(res.status).toBe(404);
  });
});

describe('CORS', () => {
  it('a preflight from the app origin is answered, as for the chat endpoint', async () => {
    const { env } = setup();
    const res = await worker.fetch(
      new Request('https://gw.example/v1/responses', {
        method: 'OPTIONS',
        headers: { Origin: SITE, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization, content-type' },
      }),
      env,
      ctx,
    );
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(SITE);
    expect(res.headers.get('Access-Control-Allow-Methods')).toBe('POST, OPTIONS');
  });

  it('responses, errors included, carry the allowed origin and nothing for an unlisted one', async () => {
    const { env } = setup();
    const ok = await worker.fetch(responses({ input: PLAIN_Q }, { Origin: SITE }), env, ctx);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe(SITE);
    const refused = await worker.fetch(responses({ input: PLAIN_Q, stream: true }, { Origin: SITE }), env, ctx);
    expect(refused.status).toBe(400);
    expect(refused.headers.get('Access-Control-Allow-Origin')).toBe(SITE);
    const evil = await worker.fetch(responses({ input: PLAIN_Q }, { Origin: 'https://evil.example' }), env, ctx);
    expect(evil.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(evil.headers.get('Vary')).toContain('Origin');
  });
});

describe('unsupported features are a 400 naming the param, never silently dropped', () => {
  const cases: [string, Record<string, unknown>, string][] = [
    ['streaming', { stream: true }, 'stream'],
    ['background', { background: true }, 'background'],
    ['a stored previous response', { previous_response_id: 'resp_123' }, 'previous_response_id'],
    ['storing the response', { store: true }, 'store'],
    ['a server-side conversation', { conversation: 'conv_1' }, 'conversation'],
    ['function tools', { tools: [{ type: 'function', name: 'f', parameters: {} }] }, 'tools'],
    ['a required tool call', { tool_choice: 'required' }, 'tool_choice'],
    ['a named function', { tool_choice: { type: 'function', name: 'f' } }, 'tool_choice'],
    ['allowed_tools', { tool_choice: { type: 'allowed_tools', tools: [] } }, 'tool_choice'],
    ['caller instructions', { instructions: 'Answer in French.' }, 'instructions'],
    ['include', { include: ['message.output_text.logprobs'] }, 'include'],
    ['structured output', { text: { format: { type: 'json_schema', name: 'x', schema: {} } } }, 'text.format'],
    ['verbosity', { text: { verbosity: 'low' } }, 'text.verbosity'],
    ['reasoning effort', { reasoning: { effort: 'high' } }, 'reasoning'],
    ['temperature', { temperature: 0.2 }, 'temperature'],
    ['top_p', { top_p: 0.5 }, 'top_p'],
    ['max_output_tokens', { max_output_tokens: 64 }, 'max_output_tokens'],
    ['top_logprobs', { top_logprobs: 3 }, 'top_logprobs'],
    ['a priority tier', { service_tier: 'priority' }, 'service_tier'],
    ['the compact envelope', { format: 'compact' }, 'format'],
  ];

  for (const [what, extra, param] of cases) {
    it(`${what} (${param})`, async () => {
      const { env, wire } = setup();
      const res = await worker.fetch(responses({ input: PLAIN_Q, ...extra }), env, ctx);
      expect(res.status).toBe(400);
      expect(res.headers.get('Content-Type')).toBe('application/json');
      expect(((await res.json()) as any).error).toEqual({
        type: 'invalid_request',
        code: 'unsupported_parameter',
        message: expect.any(String),
        param,
      });
      expect(seen(wire)).toEqual({ embed: 0, core: [], completions: [], sink: [] });
    });
  }

  const inputs: [string, unknown, string, string][] = [
    ['an image', [{ type: 'message', role: 'user', content: [{ type: 'input_image', image_url: 'https://x.example/a.png' }] }], 'unsupported_content_type', 'input[0].content[0].type'],
    ['a file', [{ role: 'user', content: [{ type: 'input_text', text: 'see' }, { type: 'input_file', file_url: 'https://x.example/a.pdf' }] }], 'unsupported_content_type', 'input[0].content[1].type'],
    ['a function call output', [{ type: 'function_call_output', call_id: 'c1', output: '{}' }], 'unsupported_input_type', 'input[0].type'],
    ['a reasoning item', [{ type: 'reasoning', summary: [] }], 'unsupported_input_type', 'input[0].type'],
    ['a vendor item', [{ type: 'acme:search_result', id: 'x', status: 'completed' }], 'unsupported_input_type', 'input[0].type'],
    ['a system message', [{ role: 'system', content: 'Be terse.' }, { role: 'user', content: PLAIN_Q }], 'unsupported_input_type', 'input[0].role'],
    ['a developer message', [{ role: 'developer', content: 'Be terse.' }, { role: 'user', content: PLAIN_Q }], 'unsupported_input_type', 'input[0].role'],
    ['no user turn', [{ role: 'assistant', content: 'Hello.' }], 'missing_required_parameter', 'input'],
    ['no input', undefined, 'missing_required_parameter', 'input'],
    ['an empty string', '   ', 'invalid_value', 'input'],
    ['an unknown role', [{ role: 'tool', content: 'x' }], 'invalid_value', 'input[0].role'],
  ];

  for (const [what, input, code, param] of inputs) {
    it(`input with ${what}`, async () => {
      const { env, wire } = setup();
      const res = await worker.fetch(responses({ input }), env, ctx);
      expect(res.status).toBe(400);
      expect(((await res.json()) as any).error).toMatchObject({ type: 'invalid_request', code, param });
      expect(seen(wire)).toEqual({ embed: 0, core: [], completions: [], sink: [] });
    });
  }

  it('malformed JSON and bad metadata are 400 invalid_request', async () => {
    const { env } = setup();
    const bad = await worker.fetch(responses('{not json'), env, ctx);
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as any).error.code).toBe('invalid_json');
    const many = Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`k${i}`, 'v']));
    for (const metadata of [many, { k: 1 }, { k: 'x'.repeat(513) }, ['a']]) {
      const res = await worker.fetch(responses({ input: PLAIN_Q, metadata }), env, ctx);
      expect(((await res.json()) as any).error).toMatchObject({ type: 'invalid_request', param: 'metadata' });
    }
  });

  it('the harmless defaults are accepted: no tools, tool_choice auto or none, store false, stream false', () => {
    const t = translateRequest({
      input: PLAIN_Q,
      tools: [],
      tool_choice: 'none',
      store: false,
      stream: false,
      instructions: null,
      include: [],
      text: { format: { type: 'text' } },
      truncation: 'auto',
      service_tier: 'auto',
      top_logprobs: 0,
      temperature: null,
    });
    expect(t.ok).toBe(true);
    if (t.ok) {
      expect(t.chat).toEqual({ messages: [{ role: 'user', content: PLAIN_Q }] });
      expect(t.echo.tool_choice).toBe('none');
      expect(t.echo.truncation).toBe('auto');
    }
  });

  it('forwards the Shamwari request fields scope, reach and mode untouched, and nothing else', () => {
    const t = translateRequest({ input: PLAIN_Q, model: 'shamwari', scope: 'personal', reach: 'r1', mode: 'extractive', user: 'u' });
    expect(t.ok && t.chat).toEqual({
      messages: [{ role: 'user', content: PLAIN_Q }],
      model: 'shamwari',
      scope: 'personal',
      reach: 'r1',
      mode: 'extractive',
    });
  });

  it('a chat-path validation error keeps its status in the spec shape', async () => {
    const { env } = setup();
    const res = await worker.fetch(responses({ input: PLAIN_Q, reach: 'r9' }), env, ctx);
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error).toMatchObject({ type: 'invalid_request', code: 'invalid_reach', param: 'reach' });
  });

  it('a failure on every inference path with nothing from Ground is a retryable model_error, not an opaque 500', async () => {
    const { env } = setup({ inferenceFails: true, chunks: [] });
    // The Workers AI fallback is the AI binding; make it fail too.
    (env.AI.run as any).mockImplementation(async () => {
      throw new Error('workers ai down');
    });
    const res = await worker.fetch(responses({ input: PLAIN_Q }), env, ctx);
    // The chat path answers this as a 503 the caller may retry, with when; the spec's shape keeps both.
    expect(res.status).toBe(503);
    expect(res.headers.get('Retry-After')).toBe('15');
    expect(((await res.json()) as any).error).toMatchObject({ type: 'model_error', code: 'model_unavailable' });
  });
});
