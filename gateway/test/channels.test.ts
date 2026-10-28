// Channel adapters (SMS, USSD) against a fake operator. The counts are the
// tests, as for rule 1 everywhere else: a refused or unsigned message makes no
// Ground, embedding, inference or sink call, and the sender's phone number
// appears in no outbound call at all.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import worker from '../src/index';
import { handleChannel, compose, MESSAGES } from '../src/channels/channel';
import type { ChannelAdapter } from '../src/channels/channel';
import { sms, SMS_MAX_CHARS } from '../src/channels/sms';
import { USSD_MAX_CHARS } from '../src/channels/ussd';
import type { Env, GroundChunk, SinkMessage } from '../src/types';

const SECRET = 'operator-shared-secret';
const PHONE = '+263771234567';

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

interface World {
  ground: number;
  inference: number;
  embed: number;
  sink: SinkMessage[];
  /** Every outbound request body and URL, to look for what must never be in them. */
  wire: string[];
}

function setup(opts: { answer?: string; chunks?: GroundChunk[]; overQuota?: boolean } = {}) {
  const w: World = { ground: 0, inference: 0, embed: 0, sink: [], wire: [] };
  const store = new Map<string, string>();
  const env = {
    AI: {
      run: vi.fn(async (_m: unknown, a: unknown) => {
        w.embed += 1;
        w.wire.push(JSON.stringify(a));
        return { data: [Array.from({ length: 1024 }, () => 0.1)] };
      }),
    },
    AUTH_CACHE: {
      get: async (k: string) =>
        k.startsWith('auth:')
          ? {
              apiKeyId: 'k1',
              ownerEntityId: 'channel-owner',
              ownerPersonId: null,
              keyType: 'standard',
              tier: 'community',
              monthlyTokenCap: 100_000,
            }
          : JSON.parse(store.get(k) ?? 'null'),
      put: async (k: string, v: string) => void (!k.startsWith('auth:') && store.set(k, v)),
      delete: async (k: string) => void store.delete(k),
    },
    SINK: {
      send: async (m: SinkMessage) => void w.sink.push(m),
      sendBatch: async (ms: { body: SinkMessage }[]) => void w.sink.push(...ms.map((m) => m.body)),
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
    CHANNEL_WEBHOOK_SECRET: SECRET,
    CHANNEL_API_KEY: 'sk_shamwari_channel',
  } as unknown as Env;

  vi.stubGlobal('fetch', async (url: string, init?: { body?: string }) => {
    const u = String(url);
    w.wire.push(u, String(init?.body ?? ''));
    if (u.includes('/rollup')) return Response.json({ total_tokens: opts.overQuota ? 1e9 : 0 });
    if (u.includes('/ground/search')) {
      w.ground += 1;
      const chunks = opts.chunks ?? [CHUNK];
      return Response.json({ chunks, hit: chunks.length > 0 });
    }
    w.inference += 1;
    return Response.json({
      choices: [{ message: { content: opts.answer ?? 'Section 48 protects the right to life.' } }],
      usage: {},
    });
  });
  return { env, w };
}

const pending: Promise<unknown>[] = [];
const ctx = {
  waitUntil: (p: Promise<unknown>) => void pending.push(p.catch(() => {})),
} as unknown as ExecutionContext;
const settle = () => Promise.all(pending.splice(0));

/** The fake operator: it signs what it sends, as the real one would. */
async function operator(path: string, body: unknown, secret = SECRET, signature?: string) {
  const raw = JSON.stringify(body);
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw)));
  const sig = [...mac].map((b) => b.toString(16).padStart(2, '0')).join('');
  return new Request(`https://gw.example${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Signature': signature ?? sig },
    body: raw,
  });
}

const text = (id: string, t = 'Do I have a right to life?') => ({ id, from: PHONE, text: t });
const nothingCalled = (w: World) => {
  expect(w.ground).toBe(0);
  expect(w.inference).toBe(0);
  expect(w.embed).toBe(0);
  expect(w.sink).toHaveLength(0);
};

beforeEach(() => vi.useRealTimers());
afterEach(() => vi.unstubAllGlobals());

describe('SMS', () => {
  it('answers a signed message with the answer and its source, inside three segments', async () => {
    const { env, w } = setup();
    const res = await worker.fetch(await operator('/v1/channels/sms', text('m1')), env, ctx);
    await settle();
    expect(res.status).toBe(200);
    const { reply } = (await res.json()) as { reply: string };
    expect(reply).toContain('Section 48 protects the right to life.');
    expect(reply).toContain('Source: Constitution of Zimbabwe - Section 48');
    expect(reply.length).toBeLessThanOrEqual(SMS_MAX_CHARS);
    expect(w.inference).toBe(1);
  });

  it('reply is plain ASCII, so one curly quote cannot force UCS-2', async () => {
    const { env } = setup({
      answer: 'It’s “protected” – always…',
      chunks: [{ ...CHUNK, title: 'Constitution – Zimbabwe' }],
    });
    const res = await worker.fetch(await operator('/v1/channels/sms', text('m2')), env, ctx);
    const { reply } = (await res.json()) as { reply: string };
    // eslint-disable-next-line no-control-regex
    expect(/^[\x00-\x7F]*$/.test(reply)).toBe(true);
  });

  it('a long answer is cut inside the limit and keeps its source line', async () => {
    const { env } = setup({ answer: 'word '.repeat(400) });
    const res = await worker.fetch(await operator('/v1/channels/sms', text('m3')), env, ctx);
    const { reply } = (await res.json()) as { reply: string };
    expect(reply.length).toBeLessThanOrEqual(SMS_MAX_CHARS);
    expect(reply).toContain('Source: ');
  });

  it('an operator retry of the same message is the same answer, run once', async () => {
    const { env, w } = setup();
    const a = await worker.fetch(await operator('/v1/channels/sms', text('dup')), env, ctx);
    await settle();
    const b = await worker.fetch(await operator('/v1/channels/sms', text('dup')), env, ctx);
    expect(await b.json()).toEqual(await a.json());
    expect(w.inference).toBe(1);
    expect(w.ground).toBe(1);
  });

  it('the sender is in no outbound call: not Ground, inference, embedding or the sink', async () => {
    const { env, w } = setup();
    await worker.fetch(await operator('/v1/channels/sms', text('m4')), env, ctx);
    await settle();
    expect(w.inference).toBe(1);
    const everything = JSON.stringify([w.wire, w.sink]);
    expect(everything).not.toContain('263771234567');
    expect(everything).not.toContain('771234567');
  });

  it('is metered like any caller: a spent quota is a short message, not a 500', async () => {
    const { env, w } = setup({ overQuota: true });
    const res = await worker.fetch(await operator('/v1/channels/sms', text('m5')), env, ctx);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { reply: string }).reply).toBe(MESSAGES.quota);
    expect(w.inference).toBe(0);
  });
});

describe('the operator is authenticated first', () => {
  it('a bad signature is a 401 and nothing is called', async () => {
    const { env, w } = setup();
    const res = await worker.fetch(
      await operator('/v1/channels/sms', text('x1'), 'wrong-secret'),
      env,
      ctx,
    );
    expect(res.status).toBe(401);
    nothingCalled(w);
  });

  it('a missing or malformed signature is a 401 and nothing is called', async () => {
    const { env, w } = setup();
    for (const sig of ['', 'zz', 'a'.repeat(64)]) {
      const res = await worker.fetch(
        await operator('/v1/channels/sms', text('x2'), SECRET, sig),
        env,
        ctx,
      );
      expect(res.status).toBe(401);
    }
    nothingCalled(w);
  });

  it('an unconfigured channel answers 503 and nothing else', async () => {
    const { env, w } = setup();
    delete (env as { CHANNEL_API_KEY?: string }).CHANNEL_API_KEY;
    const res = await worker.fetch(await operator('/v1/channels/sms', text('x3')), env, ctx);
    expect(res.status).toBe(503);
    nothingCalled(w);
    const { env: env2, w: w2 } = setup();
    delete (env2 as { CHANNEL_WEBHOOK_SECRET?: string }).CHANNEL_WEBHOOK_SECRET;
    expect(
      (await worker.fetch(await operator('/v1/channels/sms', text('x4')), env2, ctx)).status,
    ).toBe(503);
    nothingCalled(w2);
  });

  it('a malformed message is a 400 and nothing is called', async () => {
    const { env, w } = setup();
    const res = await worker.fetch(await operator('/v1/channels/sms', { id: 1 }), env, ctx);
    expect(res.status).toBe(400);
    nothingCalled(w);
  });
});

describe('rule 1 on a channel', () => {
  it('an adapter that carries personal scope is refused at the adapter, before the chat path', async () => {
    const { env, w } = setup();
    const chat = vi.fn(async () => new Response('should not be reached'));
    const personal: ChannelAdapter = { ...sms, scope: 'personal' };
    const res = await handleChannel(
      personal,
      await operator('/v1/channels/sms', text('p1')),
      env,
      chat,
    );
    await settle();
    expect(res.status).toBe(200);
    expect(((await res.json()) as { reply: string }).reply).toBe(MESSAGES.personal);
    expect(chat).not.toHaveBeenCalled();
    nothingCalled(w);
  });

  it('personal scope is a message the person can act on, not a silent downgrade', () => {
    expect(MESSAGES.personal).toMatch(/app/i);
    expect(MESSAGES.personal.length).toBeLessThanOrEqual(160);
  });

  it('the scope sent to the gateway is the adapter’s, never the message’s', async () => {
    const { env, w } = setup();
    // A message that tries to claim a scope or a reach is only text.
    const res = await worker.fetch(
      await operator('/v1/channels/sms', {
        ...text('p2'),
        scope: 'personal',
        reach: 'r2',
      }),
      env,
      ctx,
    );
    await settle();
    expect(res.status).toBe(200);
    const stored = w.sink.find((m) => m.collection === 'conversations');
    expect((stored?.doc as { scope: string }).scope).toBe('platform');
  });
});

describe('USSD', () => {
  it('an empty first request opens the session with a prompt and calls nothing', async () => {
    const { env, w } = setup();
    const res = await worker.fetch(
      await operator('/v1/channels/ussd', { sessionId: 's1', msisdn: PHONE, input: '' }),
      env,
      ctx,
    );
    expect(await res.json()).toEqual({ message: 'Shamwari. Type your question:', end: false });
    nothingCalled(w);
  });

  it('answers a question inside one screen and closes the session', async () => {
    const { env } = setup({ answer: 'x '.repeat(300) });
    const res = await worker.fetch(
      await operator('/v1/channels/ussd', {
        sessionId: 's2',
        msisdn: PHONE,
        input: 'Do I have a right to life?',
      }),
      env,
      ctx,
    );
    const j = (await res.json()) as { message: string; end: boolean };
    expect(j.end).toBe(true);
    expect(j.message.length).toBeLessThanOrEqual(USSD_MAX_CHARS);
    expect(j.message).toContain('Source: ');
  });
});

describe('compose', () => {
  it('never returns more than the limit, with or without a source', () => {
    for (const max of [60, 182, 459]) {
      const long = 'a'.repeat(2000);
      expect(compose(long, [{ label: 'L'.repeat(500) }], max).length).toBeLessThanOrEqual(max);
      expect(compose(long, [], max).length).toBeLessThanOrEqual(max);
    }
  });
});
