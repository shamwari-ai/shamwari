import { decideDestination, parseScope, ScopeRefusal } from '../scope';
import { sha256Hex } from '../idempotency';
import { plain, clip } from '../extractive';
import type { Reach } from '../router';
import type { Env, Scope } from '../types';

/**
 * The channel-adapter interface (docs/tiered-access-design.md, "Channel
 * adapters"). One adapter per channel, one pipeline for all of them:
 *
 *   verify the operator -> parse -> RULE 1 GATE -> the gateway's own chat path
 *
 * An adapter is a client of the gateway, like Mind: it has no model access and
 * no Core access. It reaches Ground and inference only by calling
 * `/v1/chat/completions` in-process with the channel's own key, so every rule
 * that holds for an API caller (quota, scope, provenance, idempotency) holds
 * here without being re-implemented.
 *
 * RULE 1. The scope is a property of the adapter, fixed in code, never read
 * from the message: an SMS or USSD user cannot declare `personal`, and a
 * misconfigured adapter that does is refused here, before the chat path and
 * therefore before a byte reaches a provider. The gate runs again inside the
 * chat path; two checks because one is a single bug away from a leak.
 *
 * The sender (a phone number) is personal data and is never forwarded: it
 * is not in the chat request, the idempotency key, the stored conversation or
 * a log line. The tests scan every outbound call for it.
 */

export type ChannelName = 'sms' | 'ussd';

export interface Inbound {
  /** The operator's message or session id. Used only to derive an idempotency key. */
  id: string;
  /** What the person typed. */
  text: string;
  /** The sender. Held here for the operator's reply, never forwarded. */
  sender: string;
}

export interface Reply {
  text: string;
  /** USSD: close the session. */
  end: boolean;
}

export interface ChannelAdapter {
  channel: ChannelName;
  reach: Reach;
  /** What this channel can carry. Cloud-bound channels are `platform`. */
  scope: Scope;
  /** The length the operator allows for one reply. */
  maxChars: number;
  parse(body: unknown): Inbound | null;
  /** The first message of a session, before a question has been asked. */
  greeting?(inbound: Inbound): Reply | null;
  /** The operator's wire format for a reply. */
  render(reply: Reply): unknown;
}

export const MAX_INPUT_CHARS = 500;

export const MESSAGES = {
  personal:
    'Personal questions cannot be answered over this channel. Use the Shamwari app on your phone.',
  busy: 'Shamwari cannot answer right now. Please try again later.',
  quota: 'This service has reached its limit for now. Please try again later.',
  empty: 'Send your question as text and Shamwari will answer with its source.',
} as const;

async function hmacOk(secret: string, body: string, signature: string | null): Promise<boolean> {
  if (!signature || !/^[0-9a-f]{64}$/i.test(signature)) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const bytes = new Uint8Array(signature.match(/../g)!.map((h) => parseInt(h, 16)));
  return crypto.subtle.verify('HMAC', key, bytes, new TextEncoder().encode(body));
}

/** Answer plus one source line, plain ASCII, inside the channel's limit. */
export function compose(answer: string, cites: { label: string }[], maxChars: number): string {
  const source = cites[0]?.label ? plain(`Source: ${cites[0].label}`) : '';
  const srcBudget = Math.min(source.length, Math.floor(maxChars * 0.4));
  const src = source ? clip(source, srcBudget, '...').text : '';
  const room = Math.max(20, maxChars - (src ? src.length + 1 : 0));
  const body = clip(plain(answer), room, '...').text;
  return src ? `${body}\n${src}` : body;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export async function handleChannel(
  adapter: ChannelAdapter,
  req: Request,
  env: Env,
  /** The gateway's own handler, called in-process with an ordinary API request. */
  chat: (r: Request) => Promise<Response>,
): Promise<Response> {
  const secret = env.CHANNEL_WEBHOOK_SECRET;
  const apiKey = env.CHANNEL_API_KEY;
  // Fail closed: an unconfigured channel answers nothing.
  if (!secret || !apiKey) return json({ error: 'channel_not_configured' }, 503);

  const raw = await req.text();
  if (!(await hmacOk(secret, raw, req.headers.get('X-Signature')))) {
    return json({ error: 'invalid_signature' }, 401);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  const inbound = adapter.parse(parsed);
  if (!inbound) return json({ error: 'invalid_message' }, 400);

  const reply = (text: string, end = true) => json(adapter.render({ text, end }));

  const greeting = adapter.greeting?.(inbound);
  if (greeting) return json(adapter.render(greeting));

  const text = inbound.text.trim().slice(0, MAX_INPUT_CHARS);
  if (!text) return reply(MESSAGES.empty);

  // RULE 1 GATE. Before the chat path, so before Ground, embedding or inference.
  try {
    decideDestination(parseScope(adapter.scope), env, 'cloud_inference');
  } catch (e) {
    if (e instanceof ScopeRefusal) return reply(MESSAGES.personal);
    throw e;
  }

  // The operator's id and the text, hashed: a retry of the same message is the
  // same key, and nothing about the sender is in it.
  const key = await sha256Hex(`${adapter.channel}\n${inbound.id}\n${text}`);
  const res = await chat(
    new Request('https://gateway.internal/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': key,
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: text }],
        scope: adapter.scope,
        reach: adapter.reach,
        format: 'compact',
      }),
    }),
  );

  if (res.status === 409) return reply(MESSAGES.personal);
  if (res.status === 429) return reply(MESSAGES.quota);
  if (res.status !== 200) return reply(MESSAGES.busy);

  const out = (await res.json()) as { answer?: string; cites?: { label: string }[] };
  if (!out.answer) return reply(MESSAGES.busy);
  return reply(compose(out.answer, out.cites ?? [], adapter.maxChars));
}
