// The key/usage seam. Two halves: the default (Core + queue) behaves as it
// always did, and the Servers API implementation honours
// docs/servers-api-contract.md against a fake.
//
// What these fail on: auth failing open when the Servers API is down, an
// outage being cached as a verdict on a good key, content leaving the
// gateway in a usage event (rule 1), and metering being dropped on outage.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import coreFields from '../../core/usage_event_fields.json';
import keysSource from '../src/keys.ts?raw';
import worker from '../src/index';
import { authenticate } from '../src/auth';
import {
  keyService,
  usageMeter,
  usageEventPayload,
  USAGE_EVENT_FIELDS,
  CoreKeyService,
  permittedScopes,
  QueueUsageMeter,
  ServersApiKeyService,
  ServersApiUsageMeter,
} from '../src/keys';
import type { Env, SinkMessage } from '../src/types';

const RAW = 'sk_shamwari_abcdefghijklmnop';
const GOOD = {
  api_key_id: 'k1',
  owner_entity_id: 'e1',
  owner_person_id: null,
  key_type: 'shamwari',
  tier: 'community',
  monthly_token_cap: 100_000,
};

function makeEnv(extra: Record<string, unknown> = {}) {
  const store = new Map<string, string>();
  const sink: SinkMessage[] = [];
  const env = {
    AUTH_CACHE: {
      get: async (k: string) => (store.has(k) ? JSON.parse(store.get(k)!) : null),
      put: async (k: string, v: string) => void store.set(k, v),
    },
    SINK: {
      send: async (m: SinkMessage) => void sink.push(m),
      sendBatch: async (ms: { body: SinkMessage }[]) => void sink.push(...ms.map((m) => m.body)),
    },
    CORE_URL: 'https://core.example',
    SHAMWARI_CORE_TOKEN: 'core-token',
    AUTH_CACHE_TTL: '60',
    ...extra,
  } as unknown as Env;
  return { env, store, sink };
}

const SERVERS = {
  SERVERS_API_ENABLED: 'true',
  SERVERS_API_URL: 'https://servers.example/',
  SERVERS_API_TOKEN: 'servers-token',
};

const req = () =>
  new Request('https://x/v1/chat/completions', {
    headers: { Authorization: `Bearer ${RAW}` },
  });

/** A fake Servers API. `verify` and `usage` decide what each route does. */
function fakeServers(
  opts: {
    verify?: () => Response | Promise<Response>;
    usage?: () => Response | Promise<Response>;
    rollup?: () => Response | Promise<Response>;
  } = {},
) {
  const seen: {
    url: string;
    method: string;
    body: unknown;
    auth: string | null;
  }[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    seen.push({
      url,
      method: init.method ?? 'GET',
      body: init.body ? JSON.parse(init.body as string) : null,
      auth: new Headers(init.headers).get('Authorization'),
    });
    if (url.includes('/keys/verify')) return (opts.verify ?? (() => Response.json(GOOD)))();
    if (url.includes('/usage/events'))
      return (opts.usage ?? (() => Response.json({ accepted: 1 })))();
    if (url.includes('/usage/rollup'))
      return (opts.rollup ?? (() => Response.json({ total_tokens: 5 })))();
    throw new Error(`unexpected fetch ${url}`);
  });
  return seen;
}

beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => {}));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('default implementation', () => {
  it('is Core and the queue unless the flag is exactly "true"', () => {
    for (const flag of [undefined, '', 'false', 'TRUE', '1']) {
      const { env } = makeEnv({ ...SERVERS, SERVERS_API_ENABLED: flag });
      expect(keyService(env)).toBeInstanceOf(CoreKeyService);
      expect(usageMeter(env)).toBeInstanceOf(QueueUsageMeter);
    }
  });

  it('verifies against Core and never touches the Servers API', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      urls.push(url);
      return Response.json(GOOD);
    });
    const { env } = makeEnv(SERVERS_OFF());
    const r = await authenticate(req(), env);
    expect(r).toMatchObject({
      ok: true,
      auth: { apiKeyId: 'k1', ownerEntityId: 'e1' },
    });
    expect(urls).toEqual(['https://core.example/auth/verify']);
  });

  it('keeps the legacy failure shape: a Core error is a cached invalid, still closed', async () => {
    vi.stubGlobal('fetch', async () => new Response('boom', { status: 500 }));
    const { env, store } = makeEnv(SERVERS_OFF());
    expect(await authenticate(req(), env)).toEqual({
      ok: false,
      reason: 'invalid',
    });
    expect([...store.values()]).toEqual(['"invalid"']);
  });

  it('meters through the queue', async () => {
    const { env, sink } = makeEnv(SERVERS_OFF());
    await usageMeter(env).record({ requestId: 'r1' });
    expect(sink).toEqual([
      {
        database: 'platform',
        collection: 'usageEvents',
        doc: { requestId: 'r1' },
      },
    ]);
  });
});

function SERVERS_OFF() {
  return {};
}

describe('Servers API key verification', () => {
  it('sends only the prefix and the hash, to the contract path, with the service token', async () => {
    const seen = fakeServers();
    const { env } = makeEnv(SERVERS);
    const r = await authenticate(req(), env);
    expect(r).toMatchObject({
      ok: true,
      auth: { tier: 'community', monthlyTokenCap: 100_000 },
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe('https://servers.example/v1/shamwari/keys/verify');
    expect(seen[0]!.auth).toBe('Bearer servers-token');
    expect(Object.keys(seen[0]!.body as object).sort()).toEqual(['key_hash', 'key_prefix']);
    expect(JSON.stringify(seen[0]!.body)).not.toContain(RAW);
  });

  it.each([401, 403, 404])(
    '%i with {"error":"invalid_key"} is a definitive invalid, cached as one',
    async (status) => {
      fakeServers({ verify: () => Response.json({ error: 'invalid_key' }, { status }) });
      const { env, store } = makeEnv(SERVERS);
      expect(await authenticate(req(), env)).toEqual({
        ok: false,
        reason: 'invalid',
      });
      expect([...store.values()]).toEqual(['"invalid"']);
    },
  );

  it.each([401, 403, 404])(
    'a bare %i (our own token or route is wrong) is unavailable, so good keys are not poisoned',
    async (status) => {
      fakeServers({ verify: () => new Response('nope', { status }) });
      const { env, store } = makeEnv(SERVERS);
      expect(await authenticate(req(), env)).toEqual({ ok: false, reason: 'unavailable' });
      expect(store.size).toBe(0);
    },
  );

  const outages: [string, () => Response | Promise<Response>][] = [
    ['500', () => new Response('x', { status: 500 })],
    ['502', () => new Response('x', { status: 502 })],
    ['429', () => new Response('x', { status: 429 })],
    ['a thrown network error', () => Promise.reject(new Error('ECONNRESET'))],
    ['a timeout', () => Promise.reject(new DOMException('t', 'TimeoutError'))],
    ['a 200 that is not JSON', () => new Response('<html>', { status: 200 })],
    ['a 200 missing required fields', () => Response.json({ api_key_id: 'k1' })],
    ['a 200 with no key_type', () => Response.json({ ...GOOD, key_type: undefined })],
    ['a 200 with a zero cap', () => Response.json({ ...GOOD, monthly_token_cap: 0 })],
    ['a 200 with an empty owner', () => Response.json({ ...GOOD, owner_entity_id: '' })],
    ['a 200 with a string cap', () => Response.json({ ...GOOD, monthly_token_cap: '100000' })],
  ];
  it.each(outages)(
    'FAILS CLOSED on %s: unavailable, not ok, and nothing cached',
    async (_n, verify) => {
      fakeServers({ verify });
      const { env, store } = makeEnv(SERVERS);
      expect(await authenticate(req(), env)).toEqual({
        ok: false,
        reason: 'unavailable',
      });
      expect(store.size).toBe(0);
    },
  );

  it('FAILS CLOSED when enabled but unconfigured, and does not fall back to Core', async () => {
    const seen = fakeServers();
    const { env } = makeEnv({ SERVERS_API_ENABLED: 'true' });
    expect(await authenticate(req(), env)).toEqual({
      ok: false,
      reason: 'unavailable',
    });
    expect(seen).toHaveLength(0);
  });

  it('a valid key of another type is invalid here, and is cached as invalid', async () => {
    fakeServers({ verify: () => Response.json({ ...GOOD, key_type: 'nyuchi-api' }) });
    const { env, store } = makeEnv(SERVERS);
    expect(await authenticate(req(), env)).toEqual({ ok: false, reason: 'invalid' });
    expect([...store.values()]).toEqual(['"invalid"']);
  });

  it.each([['Shamwari'], [' shamwari'], ['shamwari '], [['shamwari']], [123]])(
    'key_type must match exactly: %j is not shamwari',
    async (key_type) => {
      fakeServers({ verify: () => Response.json({ ...GOOD, key_type }) });
      const { env } = makeEnv(SERVERS);
      expect((await authenticate(req(), env)).ok).toBe(false);
    },
  );

  it('ignores a returned scope label: key data never decides the request scope', async () => {
    fakeServers({ verify: () => Response.json({ ...GOOD, scope_label: 'personal' }) });
    const { env } = makeEnv(SERVERS);
    const r = await authenticate(req(), env);
    expect(r.ok && Object.keys(r.auth)).not.toContain('scope_label');
  });

  it('sends the internal-key second factor on every route when configured, and not otherwise', async () => {
    const seen: { url: string; key: string | null }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      seen.push({ url, key: new Headers(init.headers).get('x-nyuchi-internal-key') });
      return url.includes('/keys/verify')
        ? Response.json(GOOD)
        : url.includes('/rollup')
          ? Response.json({ total_tokens: 1 })
          : Response.json({});
    });
    const withKey = makeEnv({ ...SERVERS, SERVERS_API_INTERNAL_KEY: 'nyk_a.nys_b' }).env;
    await new ServersApiKeyService(withKey).verify('sk_shamwari_', 'h');
    await new ServersApiKeyService(withKey).usageTotal('e1', '2026-10');
    await new ServersApiUsageMeter(withKey).record({ requestId: 'r' });
    expect(seen.map((c) => c.key)).toEqual(['nyk_a.nys_b', 'nyk_a.nys_b', 'nyk_a.nys_b']);

    seen.length = 0;
    await new ServersApiKeyService(makeEnv(SERVERS).env).verify('sk_shamwari_', 'h');
    expect(seen[0]!.key).toBeNull();
  });

  it('a recovered service is believed at once (no outage verdict was cached)', async () => {
    let up = false;
    fakeServers({
      verify: () => (up ? Response.json(GOOD) : new Response('x', { status: 503 })),
    });
    const { env } = makeEnv(SERVERS);
    expect((await authenticate(req(), env)).ok).toBe(false);
    up = true;
    expect((await authenticate(req(), env)).ok).toBe(true);
  });

  it('a failing KV write does not deny a verified key', async () => {
    fakeServers();
    const { env } = makeEnv(SERVERS);
    (env.AUTH_CACHE as unknown as { put: () => Promise<void> }).put = async () => {
      throw new Error('kv 429');
    };
    expect((await authenticate(req(), env)).ok).toBe(true);
  });

  it('answers from the KV cache without calling the service', async () => {
    const seen = fakeServers();
    const { env } = makeEnv(SERVERS);
    await authenticate(req(), env);
    await authenticate(req(), env);
    expect(seen).toHaveLength(1);
  });
});

describe('through the real handler', () => {
  it('returns 503 auth_unavailable, with Retry-After, when the Servers API is down', async () => {
    fakeServers({ verify: () => new Response('x', { status: 500 }) });
    const { env } = makeEnv(SERVERS);
    const res = await worker.fetch(
      new Request('https://x/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RAW}` },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
      }),
      env,
      { waitUntil() {} } as unknown as ExecutionContext,
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'auth_unavailable' });
    expect(res.headers.get('Retry-After')).toBe('5');
  });

  it('returns 401 for an invalid key', async () => {
    fakeServers({ verify: () => Response.json({ error: 'invalid_key' }, { status: 404 }) });
    const { env } = makeEnv(SERVERS);
    const res = await worker.fetch(
      new Request('https://x/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RAW}` },
        body: '{}',
      }),
      env,
      { waitUntil() {} } as unknown as ExecutionContext,
    );
    expect(res.status).toBe(401);
  });
});

describe('Servers API quota rollup', () => {
  it('returns the total, and throws when it cannot say (the caller decides what that means)', async () => {
    fakeServers({ rollup: () => Response.json({ total_tokens: 42 }) });
    const { env } = makeEnv(SERVERS);
    const svc = new ServersApiKeyService(env);
    expect(await svc.usageTotal('e1', '2026-10')).toBe(42);

    fakeServers({ rollup: () => new Response('x', { status: 500 }) });
    await expect(svc.usageTotal('e1', '2026-10')).rejects.toThrow();
    fakeServers({ rollup: () => Response.json({}) });
    await expect(svc.usageTotal('e1', '2026-10')).rejects.toThrow();
  });
});

describe('spill replay contract with Core', () => {
  it('the allowlist is identical to core/usage_event_fields.json, which Core replays with', () => {
    expect([...USAGE_EVENT_FIELDS].sort()).toEqual([...(coreFields as string[])].sort());
  });

  it('the default meter does not mark events spilled; only the fallback does', async () => {
    const { env, sink } = makeEnv({});
    await new QueueUsageMeter(env).record({ requestId: 'r' });
    expect(sink[0]!.doc).not.toHaveProperty('spilled');
  });
});

describe('Servers API usage metering', () => {
  const doc = {
    requestId: 'r1',
    ownerEntityId: 'e1',
    apiKeyId: 'k1',
    billingPeriod: '2026-10',
    inputTokens: 10,
    outputTokens: 5,
    createdAt: '2026-10-29T00:00:00Z',
  };

  it('posts an idempotent batch and does not queue when accepted', async () => {
    const seen = fakeServers();
    const { env, sink } = makeEnv(SERVERS);
    await new ServersApiUsageMeter(env).record(doc);
    expect(seen[0]!.url).toBe('https://servers.example/v1/shamwari/usage/events');
    expect(seen[0]!.body).toEqual({ events: [doc] });
    expect(sink).toHaveLength(0);
  });

  it.each([
    ['a 500', () => new Response('x', { status: 500 })],
    ['a network error', () => Promise.reject(new Error('down'))],
  ] as [string, () => Response | Promise<Response>][])(
    'queues the event instead of dropping it on %s',
    async (_n, usage) => {
      fakeServers({ usage });
      const { env, sink } = makeEnv(SERVERS);
      await new ServersApiUsageMeter(env).record(doc);
      // `spilled` is what Core's replay job selects on; without it the event is never delivered.
      expect(sink).toEqual([
        { database: 'platform', collection: 'usageEvents', doc: { ...doc, spilled: true } },
      ]);
    },
  );

  it('surfaces a failed fallback rather than swallowing it (the queue meter itself never throws)', async () => {
    fakeServers({ usage: () => new Response('x', { status: 500 }) });
    const { env } = makeEnv(SERVERS);
    const meter = new ServersApiUsageMeter(env, {
      record: async () => {
        throw new Error('queue down');
      },
    });
    // The fallback's own failure is the caller's to see only via logs; the
    // request path wraps record() in waitUntil. Pin that it rejects visibly
    // rather than silently, so a lost event is at least logged upstream.
    await expect(meter.record(doc)).rejects.toThrow('queue down');
  });

  it.each([
    ['an object', { pod: 'x', data: 'my clinic results' }],
    ['a pod identifier', 'pod:abc123'],
    ['free text', 'my clinic results'],
    ['an empty string', ''],
  ])('RULE 1: scope is a label only; %s is dropped, not forwarded', (_n, scope) => {
    const out = usageEventPayload({ requestId: 'r1', scope });
    expect(out).toEqual({ requestId: 'r1' });
    expect(JSON.stringify(out)).not.toContain('clinic');
  });

  it('RULE 1: every key on the wire is on the allowlist, so a new body field fails here', async () => {
    const seen = fakeServers();
    const { env } = makeEnv(SERVERS);
    const junk = Object.fromEntries(
      [
        'messages',
        'content',
        'prompt',
        'completion',
        'answer',
        'text',
        'citations',
        'systemPrompt',
        'embedding',
        'newField',
      ].map((k) => [k, 'x']),
    );
    await new ServersApiUsageMeter(env).record({ ...doc, ...junk });
    const sent = Object.keys((seen[0]!.body as { events: object[] }).events[0]!);
    for (const k of sent) expect(USAGE_EVENT_FIELDS as readonly string[]).toContain(k);
    for (const k of Object.keys(junk)) expect(sent).not.toContain(k);
  });

  it('RULE 1: carries no prompt, answer or scope-gated content, whatever the event holds', async () => {
    const seen = fakeServers();
    const { env } = makeEnv(SERVERS);
    await new ServersApiUsageMeter(env).record({
      ...doc,
      messages: [{ role: 'user', content: 'my clinic results' }],
      content: 'secret',
      prompt: 'secret',
      answer: 'secret',
      scope: 'personal',
      systemPrompt: 'secret',
    });
    const sent = JSON.stringify(seen[0]!.body);
    expect(sent).not.toContain('secret');
    expect(sent).not.toContain('clinic');
    expect(Object.keys(JSON.parse(sent).events[0])).not.toContain('messages');
    // The scope *label* is allowed; the scope word is not what must stay out.
    expect(JSON.parse(sent).events[0].scope).toBe('personal');
    expect(Object.keys(usageEventPayload({ messages: 1, content: 1, requestId: 'r' }))).toEqual([
      'requestId',
    ]);
  });
});

describe('key scopes', () => {
  it('absent scopes mean community and platform; personal is never a default', () => {
    expect(permittedScopes({} as never)).toEqual(['community', 'platform']);
  });

  it('scopes from the Servers API are kept, filtered to the three names, never invented', async () => {
    fakeServers({
      verify: () => Response.json({ ...GOOD, scopes: ['personal', 'platform', 'admin', 'ALL'] }),
    });
    const { env } = makeEnv(SERVERS);
    const r = await authenticate(req(), env);
    expect(r.ok && r.auth.scopes).toEqual(['personal', 'platform']);
  });

  it.each([
    ['a string', 'personal'],
    ['an object', { personal: true }],
    ['numbers', [1, 2]],
  ])('scopes that are %s are malformed: unavailable, nothing cached', async (_n, scopes) => {
    fakeServers({ verify: () => Response.json({ ...GOOD, scopes }) });
    const { env, store } = makeEnv(SERVERS);
    expect(await authenticate(req(), env)).toEqual({ ok: false, reason: 'unavailable' });
    expect(store.size).toBe(0);
  });

  it('a null scopes (an unset column) means the default, not an outage', async () => {
    fakeServers({ verify: () => Response.json({ ...GOOD, scopes: null }) });
    const { env } = makeEnv(SERVERS);
    const r = await authenticate(req(), env);
    expect(r.ok).toBe(true);
    expect(r.ok && r.auth.scopes).toBeUndefined();
  });

  it('an explicit empty list stays empty: that key may ask for nothing', async () => {
    fakeServers({ verify: () => Response.json({ ...GOOD, scopes: [] }) });
    const { env } = makeEnv(SERVERS);
    const r = await authenticate(req(), env);
    expect(r.ok && r.auth.scopes).toEqual([]);
  });
});

describe('least privilege: the Servers API credential can only do three things', () => {
  it('every call the gateway can make goes to one of three routes, with the right method', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      calls.push(`${init.method ?? 'GET'} ${new URL(url).pathname}`);
      return url.includes('/keys/verify')
        ? Response.json(GOOD)
        : url.includes('/rollup')
          ? Response.json({ total_tokens: 1 })
          : Response.json({});
    });
    const { env } = makeEnv({ ...SERVERS, SERVERS_API_INTERNAL_KEY: 'nyk_a.nys_b' });
    await new ServersApiKeyService(env).verify('sk_shamwari_', 'h');
    await new ServersApiKeyService(env).usageTotal('e1', '2026-10');
    await new ServersApiUsageMeter(env).record({ requestId: 'r' });
    expect(new Set(calls)).toEqual(
      new Set([
        'POST /v1/shamwari/keys/verify',
        'GET /v1/shamwari/usage/rollup',
        'POST /v1/shamwari/usage/events',
      ]),
    );
  });

  it('the source names no issuing, revoking, listing or deleting route', () => {
    const paths = [...keysSource.matchAll(/\/v1\/shamwari\/[\w/-]+/g)].map((m) => m[0]);
    expect(new Set(paths)).toEqual(
      new Set([
        '/v1/shamwari/keys/verify',
        '/v1/shamwari/usage/rollup',
        '/v1/shamwari/usage/events',
      ]),
    );
  });
});

describe('no secret in logs, errors or usage events', () => {
  const secrets = {
    SERVERS_API_TOKEN: 'tok-SECRET-1',
    SERVERS_API_INTERNAL_KEY: 'nyk_id.nys_SECRET-2',
    SHAMWARI_CORE_TOKEN: 'core-SECRET-3',
  };

  function capture() {
    const out: string[] = [];
    for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, m).mockImplementation(
        (...a: unknown[]) => void out.push(a.map(String).join(' ')),
      );
    }
    return out;
  }

  it('failures of every kind never print a credential, the raw key or its hash', async () => {
    const out = capture();
    const { env } = makeEnv({ ...SERVERS, ...secrets });
    for (const verify of [
      () => new Response('x', { status: 500 }),
      () => Promise.reject(new Error('boom')),
      () => new Response('<html>', { status: 200 }),
    ]) {
      fakeServers({ verify, usage: () => new Response('x', { status: 500 }) });
      await authenticate(req(), env);
      await new ServersApiUsageMeter(env).record({ requestId: 'r1' });
    }
    const all = out.join('\n');
    for (const v of [...Object.values(secrets), RAW]) expect(all).not.toContain(v);
    expect(all).not.toMatch(/[0-9a-f]{64}/); // no full digest either
  });

  it('a usage event carries none of the credentials', async () => {
    const seen = fakeServers();
    const { env } = makeEnv({ ...SERVERS, ...secrets });
    await new ServersApiUsageMeter(env).record({ requestId: 'r', apiKeyId: 'k1' });
    const body = JSON.stringify(seen[0]!.body);
    for (const v of Object.values(secrets)) expect(body).not.toContain(v);
  });

  it('the credentials are only ever sent as headers, never in a URL or a body', async () => {
    const seen = fakeServers();
    const { env } = makeEnv({ ...SERVERS, ...secrets });
    await new ServersApiKeyService(env).verify('sk_shamwari_', 'h');
    await new ServersApiKeyService(env).usageTotal('e1', '2026-10');
    for (const c of seen) {
      for (const v of Object.values(secrets)) {
        expect(c.url).not.toContain(v);
        expect(JSON.stringify(c.body)).not.toContain(v);
      }
    }
  });
});
