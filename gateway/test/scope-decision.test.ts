// The system, not the user, decides the scope (shamwari-ai/shamwari#81).
//
// Rule 1 stated as counts. Every provider-bound call is recorded (the embedding, the
// completion, the Workers AI fallback) with the scope it was made under, and the tests
// assert how many carried anything but community or platform. A personal path to a
// provider is a leak even if the response is an error, so each case says how many calls
// it made. Same style as test/extractive-handler.test.ts and test/e2e.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';
import { ground } from '../src/ground';
import { infer, viaGateway, viaWorkersAI } from '../src/gateway';
import { providerScope, resolveScope, ScopeRefusal } from '../src/scope';
import type { ScopeResolution } from '../src/scope';
import { needsOwnInformation, OWN_INFORMATION_NOTICE } from '../src/personal';
import { compose } from '../src/channels/channel';
import { conversationTrainable } from '../src/index';
import { targets } from '../src/router';
import cases from '../../core/scope_cases.json';
import type { Env, GroundChunk, Scope, SinkMessage } from '../src/types';

const CLOUD_SAFE = new Set(['community', 'platform']);

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
  trainingConsent: true,
};

const PERSONAL_Q = 'How much PAYE do I owe on my salary?';
const PLAIN_Q = 'What does section 48 of the Constitution say?';

interface Wire {
  /** Every call to the Workers AI binding: an embedding, or the fallback model. */
  embed: { scope: null }[];
  /** Every request to Core's /ground/search, parsed. */
  core: Record<string, any>[];
  /** Every completion request to the AI Gateway: the scope in its metadata. */
  completions: { scope: string | undefined }[];
  sink: SinkMessage[];
}

function setup(
  opts: {
    mind?: boolean;
    scopes?: string[];
    /** What Core's /ground/search answers, given the body it was sent. */
    core?: (body: Record<string, any>) => Record<string, unknown>;
    /** Core answers with this status and no body, instead of an answer. */
    coreStatus?: number;
    inferenceFails?: boolean;
  } = {},
) {
  const wire: Wire = { embed: [], core: [], completions: [], sink: [] };
  const env = {
    AI: {
      run: vi.fn(async () => {
        wire.embed.push({ scope: null });
        return { data: [Array.from({ length: 1024 }, () => 0.1)], response: 'generated' };
      }),
    },
    AUTH_CACHE: {
      get: async () => (opts.scopes ? { ...AUTH, scopes: opts.scopes } : AUTH),
      put: async () => {},
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
    MIND_AVAILABLE: opts.mind ? 'true' : 'false',
    CF_ACCOUNT_ID: 'acct',
    CF_GATEWAY_ID: 'gw',
    CF_ROUTE_NAME: 'shamwari',
    CF_AIG_TOKEN: { get: async () => 'aig' },
  } as unknown as Env;

  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('/rollup')) return Response.json({ total_tokens: 0 });
    if (u.includes('/ground/search')) {
      const body = JSON.parse(String(init?.body)) as Record<string, any>;
      wire.core.push(body);
      if (opts.coreStatus) return new Response('{}', { status: opts.coreStatus });
      const answer = opts.core
        ? opts.core(body)
        : { chunks: [{ ...CHUNK, scope: body.scope }], hit: true, scope: body.scope };
      return Response.json(answer);
    }
    const meta = JSON.parse(String((init?.headers as Record<string, string>)['cf-aig-metadata'] ?? '{}'));
    wire.completions.push({ scope: meta.scope });
    return opts.inferenceFails
      ? new Response('down', { status: 503 })
      : Response.json({ choices: [{ message: { content: 'generated' } }], usage: {} });
  });
  return { env, wire };
}

const ctx = { waitUntil: (p: Promise<unknown>) => void p.catch(() => {}) } as unknown as ExecutionContext;

const post = (path: string, body: Record<string, unknown>) =>
  new Request(`https://gw.example${path}`, {
    method: 'POST',
    headers: { Authorization: 'Bearer sk_shamwari_test', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

const chat = (q: string, extra: Record<string, unknown> = {}) =>
  post('/v1/chat/completions', { messages: [{ role: 'user', content: q }], ...extra });

/** Every provider-bound call this world saw: an embedding is one, a completion is one. */
const providerCalls = (w: Wire) => w.embed.length + w.completions.length;
/** Every scope any request in this world was made under, towards Core or a provider. */
const scopesSeen = (w: Wire) => [...w.core.map((b) => b.scope), ...w.completions.map((c) => c.scope)];

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('the rules agree with Core (shared cases)', () => {
  it('gives the answer core/scope_cases.json gives, for every case', () => {
    for (const c of cases.cases) {
      expect(needsOwnInformation(c.text), c.text).toBe(c.needs_own_information);
    }
  });
});

describe('(c) the client cannot force a scope', () => {
  const asked: unknown[] = ['community', 'platform', 'COMMUNITY', 'nonsense', '', 42, null, undefined, {}];

  it('resolveScope never reads a client-sent value other than an explicit personal', () => {
    for (const requested of asked) {
      for (const q of [PLAIN_Q, PERSONAL_Q]) {
        const r = resolveScope({
          messages: [{ role: 'user', content: q }],
          requested,
          grants: ['community', 'platform'],
          env: { MIND_AVAILABLE: 'false' } as Env,
          capability: 'cloud_inference',
        });
        expect(r.scope, String(requested)).toBe('platform');
        expect(r.destination).toBe('cloud');
      }
    }
  });

  it('the scope follows the key\'s grants, not the request', () => {
    const base = { messages: [], env: { MIND_AVAILABLE: 'false' } as Env, capability: 'cloud_inference' as const };
    expect(resolveScope({ ...base, requested: 'platform', grants: ['community'] }).scope).toBe('community');
    expect(resolveScope({ ...base, requested: 'community', grants: ['platform'] }).scope).toBe('platform');
  });

  it('through the Worker: a client-sent community reaches Core and the provider as platform', async () => {
    const { env, wire } = setup();
    const res = await worker.fetch(chat(PLAIN_Q, { scope: 'community' }), env, ctx);
    expect(res.status).toBe(200);
    expect(scopesSeen(wire)).toEqual(['platform', 'platform']);
    expect(((await res.json()) as any).shamwari.scope).toBe('platform');
  });

  it('a client-sent scope on the mind endpoint is not read either, unless it is an explicit personal', async () => {
    const { env, wire } = setup({ mind: true });
    const res = await worker.fetch(
      post('/v1/ground/context', { messages: [{ role: 'user', content: PLAIN_Q }], scope: 'community' }),
      env,
      ctx,
    );
    expect(res.status).toBe(200);
    expect(wire.core.map((b) => b.scope)).toEqual(['platform']);
  });
});

describe('(a) no personal path to a provider', () => {
  it('an explicit personal request on the chat endpoint is a 409 and NOTHING is called', async () => {
    for (const mind of [false, true]) {
      for (const q of [PLAIN_Q, PERSONAL_Q]) {
        for (const mode of [undefined, 'extractive']) {
          const { env, wire } = setup({ mind, scopes: ['personal', 'community', 'platform'] });
          const res = await worker.fetch(chat(q, { scope: 'personal', mode }), env, ctx);
          expect(res.status).toBe(409);
          expect(((await res.json()) as any).error).toBe('scope_requires_local_inference');
          expect(providerCalls(wire) + wire.core.length + wire.sink.length).toBe(0);
        }
      }
    }
  });

  it('COUNTS the provider calls on the new path: a personal-looking question makes exactly one embedding and one completion, both cloud-safe', async () => {
    const { env, wire } = setup(); // Cloud-only mode: MIND_AVAILABLE=false
    const res = await worker.fetch(chat(PERSONAL_Q), env, ctx);
    expect(res.status).toBe(200);
    expect(wire.embed).toHaveLength(1);
    expect(wire.completions).toHaveLength(1);
    expect(wire.core).toHaveLength(1);
    for (const s of scopesSeen(wire)) expect(CLOUD_SAFE.has(s)).toBe(true);
    expect(scopesSeen(wire).filter((s) => s === 'personal')).toHaveLength(0);
    // Nothing the Worker stored claims personal scope either.
    await Promise.resolve();
    for (const m of wire.sink) expect((m.doc as { scope: string }).scope).toBe('platform');
  });

  it('holds for every combination of key grants, Mind flag, mode and client-sent scope', async () => {
    const grants = [undefined, ['personal', 'community', 'platform'], ['community'], ['platform']];
    for (const scopes of grants) {
      for (const mind of [false, true]) {
        for (const mode of [undefined, 'extractive']) {
          for (const scope of [undefined, 'community', 'platform', 'bogus']) {
            for (const q of [PLAIN_Q, PERSONAL_Q]) {
              const { env, wire } = setup({ scopes, mind });
              await worker.fetch(chat(q, { scope, mode }), env, ctx);
              expect(scopesSeen(wire).filter((s) => !CLOUD_SAFE.has(s as string))).toEqual([]);
              if (mode === 'extractive') expect(wire.completions).toHaveLength(0);
            }
          }
        }
      }
    }
  });

  it('ground() refuses to embed for a decision a provider may not see, and counts zero', async () => {
    const { env, wire } = setup();
    const bad: ScopeResolution = {
      scope: 'personal',
      destination: 'cloud',
      grants: ['personal'],
      withoutOwnInformation: false,
    };
    await expect(
      ground(env, [{ role: 'user', content: PERSONAL_Q }], 'e1', bad, null),
    ).rejects.toBeInstanceOf(ScopeRefusal);
    expect(providerCalls(wire) + wire.core.length).toBe(0);
  });

  it('infer(), viaGateway() and viaWorkersAI() refuse a personal scope at the call, and count zero', async () => {
    const { env, wire } = setup();
    const target = targets(env).economy;
    const meta = { tier: 'economy', scope: 'personal', ownerEntityId: 'e1', surface: 's', requestId: 'r' } as const;
    await expect(infer(env, target, [], meta)).rejects.toBeInstanceOf(ScopeRefusal);
    await expect(viaGateway(env, target, [], meta)).rejects.toBeInstanceOf(ScopeRefusal);
    await expect(viaWorkersAI(env, target, [], 'personal')).rejects.toBeInstanceOf(ScopeRefusal);
    expect(providerCalls(wire)).toBe(0);
  });

  it('providerScope refuses a mind destination and any scope outside community and platform', () => {
    expect(() => providerScope({ scope: 'platform', destination: 'mind' })).toThrow(ScopeRefusal);
    for (const scope of ['personal', 'nonsense'] as Scope[]) {
      expect(() => providerScope({ scope, destination: 'cloud' })).toThrow(ScopeRefusal);
    }
    expect(providerScope({ scope: 'community', destination: 'cloud' })).toBe('community');
  });

  it('a mind destination makes no embedding (unchanged) and the Mind endpoint still serves explicit personal', async () => {
    const { env, wire } = setup({ mind: true, scopes: ['personal', 'platform'] });
    const res = await worker.fetch(
      post('/v1/ground/context', { messages: [{ role: 'user', content: PERSONAL_Q }], scope: 'personal' }),
      env,
      ctx,
    );
    expect(res.status).toBe(200);
    expect(wire.embed).toHaveLength(0);
    expect(wire.completions).toHaveLength(0);
    expect(wire.core.map((b) => [b.scope, b.destination])).toEqual([['personal', 'mind']]);
    expect(((await res.json()) as any).shamwari.answered_without_own_information).toBe(false);
  });
});

describe('(b) a personal-looking question is never answered without the marker', () => {
  it('Cloud-only mode: the response says it was answered without the person\'s own information, with the Mind message', async () => {
    const { env } = setup();
    const j = (await (await worker.fetch(chat(PERSONAL_Q), env, ctx)).json()) as any;
    expect(j.shamwari.answered_without_own_information).toBe(true);
    expect(j.shamwari.notice).toEqual({
      code: 'answered_without_your_own_information',
      message: OWN_INFORMATION_NOTICE,
    });
    expect(j.shamwari.notice.message).toContain('On-device Shamwari Mind will use your own information');
    expect(j.shamwari.scope).toBe('platform'); // not silently retried as something else, not personal
  });

  it('every shared personal-looking case carries the marker through the Worker', async () => {
    for (const c of cases.cases.filter((c) => c.needs_own_information)) {
      const { env } = setup();
      const res = await worker.fetch(chat(c.text), env, ctx);
      expect(res.status, c.text).toBe(200);
      expect(((await res.json()) as any).shamwari.answered_without_own_information, c.text).toBe(true);
    }
  });

  it('a plain question carries no notice (the field is still present, false)', async () => {
    const { env } = setup();
    const j = (await (await worker.fetch(chat(PLAIN_Q), env, ctx)).json()) as any;
    expect(j.shamwari.answered_without_own_information).toBe(false);
    expect(j.shamwari.notice).toBeNull();
  });

  it('the extractive rung carries it too, and calls no model', async () => {
    const { env, wire } = setup();
    const j = (await (await worker.fetch(chat(PERSONAL_Q, { mode: 'extractive' }), env, ctx)).json()) as any;
    expect(j.shamwari.answered_without_own_information).toBe(true);
    expect(wire.completions).toHaveLength(0);
  });

  it('the degraded answer (every inference path failed) carries it', async () => {
    const { env } = setup({ inferenceFails: true });
    (env.AI.run as any).mockImplementation(async (_m: unknown, input: { text?: string[] }) => {
      if (input.text) return { data: [Array.from({ length: 1024 }, () => 0.1)] };
      throw new Error('workers ai down');
    });
    const j = (await (await worker.fetch(chat(PERSONAL_Q), env, ctx)).json()) as any;
    expect(j.shamwari.degraded).toBe(true);
    expect(j.shamwari.answered_without_own_information).toBe(true);
  });

  it('a follow-up straight after a personal turn is still flagged', async () => {
    const { env } = setup();
    const res = await worker.fetch(
      post('/v1/chat/completions', {
        messages: [
          { role: 'user', content: 'I earn $400 a month' },
          { role: 'assistant', content: 'Ok.' },
          { role: 'user', content: 'and how much tax is that?' },
        ],
      }),
      env,
      ctx,
    );
    expect(((await res.json()) as any).shamwari.answered_without_own_information).toBe(true);
  });

  it('the compact envelope carries it as one string, only when true', async () => {
    const { env } = setup();
    const yes = (await (await worker.fetch(chat(PERSONAL_Q, { format: 'compact' }), env, ctx)).json()) as any;
    expect(yes.notice).toBe(OWN_INFORMATION_NOTICE);
    const no = (await (await worker.fetch(chat(PLAIN_Q, { format: 'compact' }), env, ctx)).json()) as any;
    expect(no).not.toHaveProperty('notice');
  });

  it('SMS and USSD replies carry the short notice inside the character limit', () => {
    for (const max of [160, 182, 450]) {
      const out = compose('x'.repeat(2000), [{ label: 'Constitution - s 48' }], max, 'gateway', OWN_INFORMATION_NOTICE);
      expect(out.length).toBeLessThanOrEqual(max);
      expect(out).toContain('Answered without your own info');
    }
    expect(compose('Short answer.', [], 450, 'gateway')).not.toContain('own info');
  });
});

describe('what review found', () => {
  it('the Mind endpoint never says "answered without your own information", whatever Core says: the device holds it', async () => {
    const { env } = setup({
      mind: true,
      scopes: ['personal', 'platform'],
      core: (b) => ({ chunks: [{ ...CHUNK, scope: b.scope }], hit: true, scope: b.scope, needs_own_information: true }),
    });
    const res = await worker.fetch(
      post('/v1/ground/context', { messages: [{ role: 'user', content: PERSONAL_Q }], scope: 'personal' }),
      env,
      ctx,
    );
    const j = (await res.json()) as any;
    expect(j.shamwari.destination).toBe('mind');
    expect(j.shamwari.answered_without_own_information).toBe(false);
    expect(j.shamwari.notice).toBeNull();
  });

  it('a conversation the system judged personal is never Mind training material, in any scope', async () => {
    const { env, wire } = setup();
    await worker.fetch(chat(PERSONAL_Q), env, ctx);
    await Promise.resolve();
    const conv = wire.sink.find((m) => m.collection === 'conversations')!.doc as any;
    expect(conv.trainingEligible).toBe(false);

    const plain = setup();
    await worker.fetch(chat(PLAIN_Q), plain.env, ctx);
    await Promise.resolve();
    expect((plain.wire.sink.find((m) => m.collection === 'conversations')!.doc as any).trainingEligible).toBe(true);
  });

  it('conversationTrainable says no when the question looked personal', () => {
    expect(conversationTrainable('platform', 'open_weight', false, 'shamwari', true, true)).toBe(false);
    expect(conversationTrainable('platform', 'open_weight', false, 'shamwari', false, true)).toBe(true);
  });

  it('the notice does not squeeze a USSD answer to a few words', () => {
    const out = compose('x'.repeat(2000), [{ label: 'y'.repeat(200) }], 182, 'gateway', OWN_INFORMATION_NOTICE);
    const body = out.split('\n')[0]!;
    expect(out.length).toBeLessThanOrEqual(182);
    expect(body.length).toBeGreaterThanOrEqual(70);
  });
});

describe('(d) Core and the gateway cannot disagree about a scope decision', () => {
  it('sends Core the grants and its own view, so Core decides again from the same facts', async () => {
    const { env, wire } = setup({ scopes: ['community', 'platform'] });
    await worker.fetch(chat(PERSONAL_Q), env, ctx);
    expect(wire.core[0]).toMatchObject({
      scope: 'platform',
      destination: 'cloud',
      granted_scopes: ['community', 'platform'],
      needs_own_information: true,
    });
  });

  it('Core answering for a different scope than was asked: its chunks are not used, nothing is cited', async () => {
    for (const core of [
      () => ({ chunks: [{ ...CHUNK, scope: 'personal', content: 'PAYSLIP' }], hit: true, scope: 'personal' }),
      () => ({ chunks: [{ ...CHUNK, scope: 'community' }], hit: true, scope: 'community' }),
      () => ({ chunks: [{ ...CHUNK, scope: 'personal', content: 'PAYSLIP' }], hit: true, scope: 'platform' }),
      () => ({ chunks: [CHUNK], hit: true }), // no scope at all
    ]) {
      const { env, wire } = setup({ core });
      const res = await worker.fetch(chat(PLAIN_Q), env, ctx);
      const text = await res.text();
      expect(res.status).toBe(200);
      const j = JSON.parse(text);
      expect(j.shamwari.grounded).toBe(false);
      expect(j.shamwari.citations).toEqual([]);
      expect(text).not.toContain('PAYSLIP');
      // And the ungrounded answer was still made under a cloud-safe scope.
      expect(scopesSeen(wire).filter((s) => !CLOUD_SAFE.has(s as string))).toEqual([]);
    }
  });

  it('Core saying the question needs the person\'s own information adds the notice even if the gateway did not', async () => {
    const { env } = setup({
      core: (b) => ({ chunks: [{ ...CHUNK, scope: b.scope }], hit: true, scope: b.scope, needs_own_information: true }),
    });
    const j = (await (await worker.fetch(chat(PLAIN_Q), env, ctx)).json()) as any;
    expect(j.shamwari.answered_without_own_information).toBe(true);
  });

  it('Core saying false cannot remove a notice the gateway raised', async () => {
    const { env } = setup({
      core: (b) => ({ chunks: [{ ...CHUNK, scope: b.scope }], hit: true, scope: b.scope, needs_own_information: false }),
    });
    const j = (await (await worker.fetch(chat(PERSONAL_Q), env, ctx)).json()) as any;
    expect(j.shamwari.answered_without_own_information).toBe(true);
  });

  it('Core refusing the scope (403 or 409) leaves the answer ungrounded, never retried under another scope', async () => {
    for (const coreStatus of [403, 409]) {
      const { env, wire } = setup({ coreStatus });
      const res = await worker.fetch(chat(PERSONAL_Q), env, ctx);
      expect(res.status).toBe(200);
      expect(wire.core).toHaveLength(1); // one attempt: no retry as another scope
      expect(((await res.json()) as any).shamwari.grounded).toBe(false);
      expect(scopesSeen(wire).filter((s) => !CLOUD_SAFE.has(s as string))).toEqual([]);
    }
  });
});

describe('storing a conversation is not consent to train on it', () => {
  it('a caller with no recorded consent is never trainable, whatever else is true', () => {
    // Every other term says yes; only consent is missing.
    expect(conversationTrainable('platform', 'open_weight', false, 'shamwari')).toBe(false);
    expect(conversationTrainable('community', 'open_weight', false, 'standard', false, false)).toBe(false);
    expect(conversationTrainable('platform', 'open_weight', false, 'shamwari', false, true)).toBe(true);
  });

  it('an API caller without consent is stored, but not as training material', async () => {
    const { trainingConsent: _, ...unasked } = AUTH;
    const { env, wire } = setup();
    // The cached auth context is what authenticate() reads first.
    (env.AUTH_CACHE as unknown as { get: () => Promise<unknown> }).get = async () => unasked;
    await worker.fetch(chat(PLAIN_Q), env, ctx);
    await Promise.resolve();
    const conv = wire.sink.find((m) => m.collection === 'conversations')!.doc as any;
    expect(conv.trainingEligible).toBe(false);
    expect(conv.trainingConsent).toBe(false);
  });
});
