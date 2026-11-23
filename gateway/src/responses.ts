/**
 * Open Responses: `POST /v1/responses` (shamwari#291, "Model wire shape: Open Responses").
 *
 * Pinned to the dated specification, 2026-04-24: `src/specifications/2026-04-24.mdx` and
 * `public/openapi/2026-04-24/openapi.json` in github.com/openresponses/openresponses
 * (read at commit dce9ddb). Section names below are that file's headings.
 *
 * A TRANSLATOR, NOT A SECOND CHAT PATH
 * ------------------------------------
 * This file has no model access, no Ground access and no Core access, the same as a
 * channel adapter (src/channels/channel.ts). It turns an Open Responses request into an
 * ordinary chat request, calls `/v1/chat/completions` IN-PROCESS with the caller's own
 * `Authorization`, and turns the answer back. So every rule that holds for a chat caller
 * holds here without being re-implemented, and none can be skipped:
 *
 *   - Rule 1: the scope gate (`resolveScope`/`decideDestination` in admit()), the
 *     own-information rule (personal.ts), and `providerScope` at every provider call.
 *     An explicit `"scope": "personal"` is forwarded untouched, so it is the same 409.
 *     The user's text is forwarded verbatim, so personal.ts sees exactly what it would see.
 *   - Rule 2: provenance is resolved from the model that served (provenance.ts) and the
 *     conversation row's `trainingEligible` comes from `conversationTrainable`, both in the
 *     chat path. `X-Shamwari-Channel` is forwarded as sent, never added or removed.
 *   - Auth, quota, idempotency, metering and usage events, and the Ground citations.
 *
 * Nothing here weakens a check: a request this file accepts becomes a chat request that
 * meets every check the chat endpoint applies, and a request it refuses never reaches it.
 *
 * WHAT IS REFUSED, AND WHY (never silently dropped)
 * -------------------------------------------------
 * The chat path has no tools, no stored responses, no streaming, no structured output,
 * no caller system prompt (Ground sets it) and no sampling controls. A field asking for
 * one of those is a 400 `invalid_request` naming the `param`, as "Errors" requires,
 * rather than an answer that quietly ignored it.
 */
import { authenticate } from './auth';
import type { Env } from './types';

type Chat = (r: Request) => Promise<Response>;

/** The spec's error types ("Errors" > "Error Types"). */
type ErrorType = 'server_error' | 'invalid_request' | 'not_found' | 'model_error' | 'too_many_requests';

const KNOWN_ERRORS: Record<number, ErrorType> = {
  400: 'invalid_request',
  401: 'invalid_request',
  403: 'invalid_request',
  404: 'not_found',
  409: 'invalid_request',
  422: 'invalid_request',
  429: 'too_many_requests',
};

/** Headers a client needs on a failure: how long to wait, and whether it was a replay. */
const PASS_HEADERS = ['Retry-After', 'Idempotent-Replayed'] as const;

export function errorResponse(
  status: number,
  code: string,
  message: string,
  param: string | null = null,
  headers: Record<string, string> = {},
  type: ErrorType = KNOWN_ERRORS[status] ?? 'server_error',
): Response {
  return new Response(JSON.stringify({ error: { type, code, message, param } }), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

const unsupported = (param: string, message: string) =>
  errorResponse(400, 'unsupported_parameter', message, param);
const invalid = (param: string, message: string) => errorResponse(400, 'invalid_value', message, param);

/** Present with a meaningful value: not undefined, not null. */
const given = (v: unknown) => v !== undefined && v !== null;

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** What the caller asked for that the response echoes ("ResponseResource"). */
interface Echo {
  model: string | null;
  metadata: Record<string, string>;
  truncation: 'auto' | 'disabled';
  tool_choice: 'none' | 'auto';
  parallel_tool_calls: boolean;
  max_tool_calls: number | null;
  safety_identifier: string | null;
  prompt_cache_key: string | null;
}

export type Translated =
  | { ok: false; response: Response }
  | { ok: true; chat: Record<string, unknown>; echo: Echo };

/**
 * One input item's text. User content is `input_text`, assistant content is `output_text`
 * ("Content" > "User Content vs Model Content"); anything else (images, files, video,
 * refusals) is a modality the chat path cannot carry, so it is refused, not dropped.
 */
function textOf(content: unknown, role: 'user' | 'assistant', at: string): string | Response {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return invalid(`${at}.content`, 'content must be a string or an array of content parts.');
  const want = role === 'user' ? 'input_text' : 'output_text';
  const parts: string[] = [];
  for (let j = 0; j < content.length; j++) {
    const p = content[j] as { type?: unknown; text?: unknown } | null;
    const here = `${at}.content[${j}]`;
    if (!p || typeof p !== 'object') return invalid(here, 'a content part must be an object.');
    if (p.type !== want) {
      return errorResponse(
        400,
        'unsupported_content_type',
        `Content of type ${JSON.stringify(p.type)} is not supported on a ${role} message here: ` +
          `this endpoint accepts ${want} only.`,
        `${here}.type`,
      );
    }
    if (typeof p.text !== 'string') return invalid(`${here}.text`, 'text must be a string.');
    parts.push(p.text);
  }
  return parts.join('\n');
}

/** `input` as chat messages: a string is one user turn; items must be messages. */
function messagesOf(input: unknown): ChatMessage[] | Response {
  if (typeof input === 'string') {
    if (!input.trim()) return invalid('input', 'input must not be empty.');
    return [{ role: 'user', content: input }];
  }
  if (!Array.isArray(input) || input.length === 0) {
    return errorResponse(400, 'missing_required_parameter', 'input is required: a string or a non-empty array of message items.', 'input');
  }
  const out: ChatMessage[] = [];
  for (let i = 0; i < input.length; i++) {
    const item = input[i] as { type?: unknown; role?: unknown; content?: unknown } | null;
    const at = `input[${i}]`;
    if (!item || typeof item !== 'object') return invalid(at, 'an input item must be an object.');
    // `type` defaults to "message" in the schema (UserMessageItemParam and siblings).
    const type = item.type ?? 'message';
    if (type !== 'message') {
      // function_call, function_call_output, reasoning, item_reference, compaction, and
      // any implementor-prefixed type: none has a meaning on the chat path.
      return errorResponse(
        400,
        'unsupported_input_type',
        `Input items of type ${JSON.stringify(type)} are not supported here: this endpoint accepts message items only.`,
        `${at}.type`,
      );
    }
    if (item.role === 'system' || item.role === 'developer') {
      return errorResponse(
        400,
        'unsupported_input_type',
        'System and developer messages are not supported: Shamwari sets the system prompt from its Ground ' +
          'context, and /v1/chat/completions does not use a caller system prompt either.',
        `${at}.role`,
      );
    }
    if (item.role !== 'user' && item.role !== 'assistant') {
      return invalid(`${at}.role`, 'role must be "user" or "assistant".');
    }
    const text = textOf(item.content, item.role, at);
    if (text instanceof Response) return text;
    out.push({ role: item.role, content: text });
  }
  if (!out.some((m) => m.role === 'user')) {
    return errorResponse(400, 'missing_required_parameter', 'input must contain at least one user message.', 'input');
  }
  return out;
}

/** MetadataParam: at most 16 pairs, keys up to 64 characters, string values up to 512. */
function metadataOf(v: unknown): Record<string, string> | Response {
  if (!given(v)) return {};
  if (typeof v !== 'object' || Array.isArray(v)) return invalid('metadata', 'metadata must be an object.');
  const entries = Object.entries(v as Record<string, unknown>);
  if (entries.length > 16) return invalid('metadata', 'metadata holds at most 16 key-value pairs.');
  for (const [k, val] of entries) {
    if (k.length > 64) return invalid('metadata', 'metadata keys are at most 64 characters.');
    if (typeof val !== 'string' || val.length > 512) {
      return invalid('metadata', 'metadata values are strings of at most 512 characters.');
    }
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

/**
 * The Open Responses request as a chat request, or the error that says why it cannot be one.
 * Pure: no I/O, so every refusal is testable without a world.
 */
export function translateRequest(body: unknown): Translated {
  const fail = (response: Response): Translated => ({ ok: false, response });
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return fail(invalid('body', 'The request body must be a JSON object.'));
  }
  const b = body as Record<string, unknown>;

  // --- Fields the chat path cannot honour: refused, never ignored. ---------------
  // Streaming: the chat path does not stream (gateway/README.md, "Not in this phase"), so
  // there is no honest event sequence to send ("Streaming", "HTTP Responses").
  if (b.stream === true) {
    return fail(unsupported('stream', 'Streaming is not supported on this endpoint yet. Send "stream": false or omit it.'));
  }
  if (b.background === true) return fail(unsupported('background', 'Background responses are not supported.'));
  // "previous_response_id": a server given one MUST load that response. Nothing is stored here.
  if (given(b.previous_response_id)) {
    return fail(
      unsupported(
        'previous_response_id',
        'Responses are not stored on this server, so previous_response_id cannot be loaded. Send the earlier turns in input.',
      ),
    );
  }
  if (b.store === true) {
    return fail(unsupported('store', 'Responses are not stored for retrieval on this server. Send "store": false or omit it.'));
  }
  if (given(b.conversation)) return fail(unsupported('conversation', 'Server-side conversations are not supported.'));
  // Tools: the chat path has no tools. "tool_choice": "required" or a named function MUST
  // call a tool, and "allowed_tools" MUST be enforced, so neither can be accepted.
  if (given(b.tools) && !(Array.isArray(b.tools) && b.tools.length === 0)) {
    return fail(unsupported('tools', 'Tools and function calling are not supported on this endpoint.'));
  }
  if (given(b.tool_choice) && b.tool_choice !== 'auto' && b.tool_choice !== 'none') {
    return fail(unsupported('tool_choice', 'No tools are available here, so tool_choice can only be "auto" or "none".'));
  }
  if (given(b.instructions) && b.instructions !== '') {
    return fail(
      unsupported(
        'instructions',
        'Caller instructions are not supported: Shamwari sets the system prompt from its Ground context.',
      ),
    );
  }
  if (Array.isArray(b.include) ? b.include.length > 0 : given(b.include)) {
    return fail(unsupported('include', 'No optional output (logprobs, encrypted reasoning) is available here.'));
  }
  const text = b.text as { format?: { type?: unknown } | null; verbosity?: unknown } | null | undefined;
  if (given(text)) {
    if (typeof text !== 'object') return fail(invalid('text', 'text must be an object.'));
    if (given(text.format) && text.format?.type !== 'text') {
      return fail(unsupported('text.format', 'Only plain text output is supported; structured output is not.'));
    }
    if (given(text.verbosity)) return fail(unsupported('text.verbosity', 'Output verbosity cannot be set here.'));
  }
  if (given(b.reasoning)) {
    const r = b.reasoning as { effort?: unknown; summary?: unknown };
    if (typeof r !== 'object' || given(r.effort) || given(r.summary)) {
      return fail(unsupported('reasoning', 'Reasoning effort and summaries cannot be set here.'));
    }
  }
  // Sampling controls: the routed model's settings are fixed by the gateway, not the caller.
  for (const p of ['temperature', 'top_p', 'presence_penalty', 'frequency_penalty', 'max_output_tokens'] as const) {
    if (given(b[p])) return fail(unsupported(p, `${p} cannot be set here: the gateway chooses the model and its settings.`));
  }
  if (given(b.top_logprobs) && b.top_logprobs !== 0) {
    return fail(unsupported('top_logprobs', 'Log probabilities are not available here.'));
  }
  if (given(b.service_tier) && b.service_tier !== 'auto' && b.service_tier !== 'default') {
    return fail(unsupported('service_tier', 'Only the "default" service tier is available.'));
  }
  // The chat endpoint's compact envelope is a different wire shape, not an Open Responses one.
  if (given(b.format)) return fail(unsupported('format', 'format is a /v1/chat/completions option; this endpoint answers in the Open Responses shape.'));

  // --- Fields that are checked and echoed. ----------------------------------------
  if (given(b.truncation) && b.truncation !== 'auto' && b.truncation !== 'disabled') {
    return fail(invalid('truncation', 'truncation must be "auto" or "disabled".'));
  }
  if (given(b.model) && typeof b.model !== 'string') return fail(invalid('model', 'model must be a string.'));
  for (const p of ['safety_identifier', 'prompt_cache_key'] as const) {
    if (given(b[p]) && (typeof b[p] !== 'string' || (b[p] as string).length > 64)) {
      return fail(invalid(p, `${p} must be a string of at most 64 characters.`));
    }
  }
  const metadata = metadataOf(b.metadata);
  if (metadata instanceof Response) return fail(metadata);
  const messages = messagesOf(b.input);
  if (messages instanceof Response) return fail(messages);

  // The chat request. `scope`, `reach` and `mode` are Shamwari's own request fields
  // ("Extending existing schemas"), forwarded exactly as sent: above all an explicit
  // "personal" scope, which the chat path's gate refuses with 409. Dropping it here would
  // turn the caller's "this is personal" into an ordinary Cloud request.
  const chat: Record<string, unknown> = { messages };
  if (given(b.model)) chat.model = b.model;
  for (const k of ['scope', 'reach', 'mode'] as const) if (b[k] !== undefined) chat[k] = b[k];

  return {
    ok: true,
    chat,
    echo: {
      model: typeof b.model === 'string' ? b.model : null,
      metadata,
      truncation: b.truncation === 'auto' ? 'auto' : 'disabled',
      tool_choice: b.tool_choice === 'none' ? 'none' : 'auto',
      parallel_tool_calls: b.parallel_tool_calls === true,
      max_tool_calls: typeof b.max_tool_calls === 'number' ? b.max_tool_calls : null,
      safety_identifier: typeof b.safety_identifier === 'string' ? b.safety_identifier : null,
      prompt_cache_key: typeof b.prompt_cache_key === 'string' ? b.prompt_cache_key : null,
    },
  };
}

interface ChatResult {
  id: string;
  model: string;
  choices: { message: { content: string }; finish_reason: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  shamwari?: Record<string, unknown>;
}

/** Deterministic from the chat id, so an idempotent replay returns the same ids. */
const hex = (id: string) => id.replace(/[^0-9a-fA-F]/g, '').toLowerCase() || crypto.randomUUID().replace(/-/g, '');

/**
 * The chat answer as a ResponseResource. Every field the 2026-04-24 schema requires is
 * present; Shamwari's citations, scope decision, provenance (`model_served`,
 * `model_substituted`, `inference_path`) and the own-information notice ride in one
 * optional `shamwari` object ("Extending existing schemas": optional, documented, core
 * fields unchanged in meaning). No core field is invented or repurposed: `annotations`
 * stays empty because a `url_citation` needs a character span and a URL, and Ground's
 * citations have neither span nor, always, a URL.
 */
export function toResponse(chat: ChatResult, echo: Echo, createdAt: number, completedAt: number) {
  const choice = chat.choices[0];
  const text = choice?.message.content ?? '';
  // "Items are state machines": an item cut off by the token budget is `incomplete`, and
  // then the response MUST be `incomplete` too.
  const cut = choice?.finish_reason === 'length';
  const id = hex(chat.id);
  const input = chat.usage?.prompt_tokens ?? 0;
  const output = chat.usage?.completion_tokens ?? 0;
  return {
    id: `resp_${id}`,
    object: 'response' as const,
    created_at: createdAt,
    completed_at: cut ? null : completedAt,
    status: cut ? 'incomplete' : 'completed',
    incomplete_details: cut ? { reason: 'max_output_tokens' } : null,
    model: chat.model,
    previous_response_id: null,
    instructions: null,
    output: [
      {
        type: 'message' as const,
        id: `msg_${id}`,
        status: cut ? 'incomplete' : 'completed',
        role: 'assistant' as const,
        content: [{ type: 'output_text' as const, text, annotations: [], logprobs: [] }],
      },
    ],
    error: null,
    tools: [],
    tool_choice: echo.tool_choice,
    truncation: echo.truncation,
    parallel_tool_calls: echo.parallel_tool_calls,
    text: { format: { type: 'text' as const } },
    top_p: 1,
    presence_penalty: 0,
    frequency_penalty: 0,
    top_logprobs: 0,
    temperature: 1,
    reasoning: null,
    usage: {
      input_tokens: input,
      output_tokens: output,
      total_tokens: chat.usage?.total_tokens ?? input + output,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 0 },
    },
    max_output_tokens: null,
    max_tool_calls: echo.max_tool_calls,
    store: false,
    background: false,
    service_tier: 'default',
    metadata: echo.metadata,
    safety_identifier: echo.safety_identifier,
    prompt_cache_key: echo.prompt_cache_key,
    shamwari: chat.shamwari ?? null,
  };
}

/** A chat-path refusal in the spec's error shape, keeping its status, code and wait. */
async function translateError(res: Response): Promise<Response> {
  let payload: Record<string, unknown> = {};
  try {
    payload = (await res.json()) as Record<string, unknown>;
  } catch {
    /* no body */
  }
  const code = typeof payload.error === 'string' ? payload.error : 'error';
  const message =
    typeof payload.message === 'string'
      ? payload.message
      : typeof payload.hint === 'string'
        ? payload.hint
        : code.replace(/_/g, ' ');
  const params: Record<string, string> = {
    invalid_mode: 'mode',
    invalid_reach: 'reach',
    invalid_idempotency_key: 'Idempotency-Key',
    idempotency_key_reuse: 'Idempotency-Key',
    scope_requires_local_inference: 'scope',
  };
  const headers: Record<string, string> = {};
  for (const h of PASS_HEADERS) {
    const v = res.headers.get(h);
    if (v !== null) headers[h] = v;
  }
  // Every inference path failed with nothing from Ground: the chat path says so as a retryable 503
  // (inference_unavailable, with Retry-After). In the spec's shape that is a model_error.
  if (code === 'inference_unavailable') {
    return errorResponse(res.status, 'model_unavailable', 'No model could answer this request. Retry later.', null, headers, 'model_error');
  }
  return errorResponse(res.status, code, message, params[code] ?? null, headers);
}

/**
 * `POST /v1/responses`. `chat` is the gateway's own handler, called in-process with an
 * ordinary chat request carrying the caller's own credentials.
 */
export async function handleResponses(req: Request, env: Env, chat: Chat): Promise<Response> {
  const createdAt = Math.floor(Date.now() / 1000);

  // Who is asking, before anything about the request is looked at. The chat path
  // authenticates again (a cache hit); this only keeps an unauthenticated caller from
  // learning how the body would have been judged.
  const authed = await authenticate(req, env);
  if (!authed.ok) {
    if (authed.reason === 'unavailable') {
      return errorResponse(503, 'auth_unavailable', 'Authentication is unavailable. Retry shortly.', null, { 'Retry-After': '5' });
    }
    if (authed.reason === 'forbidden') {
      return errorResponse(403, 'not_provisioned', authed.detail);
    }
    return errorResponse(401, 'invalid_api_key', 'The API key or token is missing or invalid.');
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, 'invalid_json', 'The request body must be JSON.', 'body');
  }
  const t = translateRequest(body);
  if (!t.ok) return t.response;

  const headers: Record<string, string> = {
    Authorization: req.headers.get('Authorization') ?? '',
    'Content-Type': 'application/json',
  };
  // Forwarded as sent and never invented: the channel marker decides what is stored and
  // whether it can ever be training material (rule 2), and the key makes a retry a replay.
  for (const h of ['Idempotency-Key', 'X-Shamwari-Channel']) {
    const v = req.headers.get(h);
    if (v !== null) headers[h] = v;
  }

  let res: Response;
  try {
    res = await chat(
      new Request('https://gateway.internal/v1/chat/completions', {
        method: 'POST',
        headers,
        body: JSON.stringify(t.chat),
      }),
    );
  } catch (e) {
    // Every inference path failed with nothing from Ground to fall back on.
    console.error('responses: chat path threw', String(e));
    return errorResponse(500, 'model_unavailable', 'No model could answer this request. Retry later.', null, {}, 'model_error');
  }
  if (res.status !== 200) return translateError(res);

  const out = toResponse((await res.json()) as ChatResult, t.echo, createdAt, Math.floor(Date.now() / 1000));
  const replayed = res.headers.get('Idempotent-Replayed');
  return new Response(JSON.stringify(out), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...(replayed ? { 'Idempotent-Replayed': replayed } : {}) },
  });
}
