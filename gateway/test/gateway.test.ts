// infer() reports which model served the request, and provenance is
// resolved from that rather than from the tier that was asked for.
//
// The defect this pins: an AI Gateway dynamic route can substitute the
// model without a deploy. Before this, a route failing over from Kimi to a
// restricted model produced conversation rows stamped `open_weight` and
// flagged trainingEligible — rule 2 broken by a dashboard edit.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { infer, buildMetadata, AIG_METADATA_MAX_ENTRIES } from '../src/gateway';
import type { RequestMetadata } from '../src/gateway';
import { targets } from '../src/router';
import type { Env, Message } from '../src/types';

const messages: Message[] = [{ role: 'user', content: 'What is the VAT rate?' }];

const meta: RequestMetadata = {
  tier: 'standard',
  scope: 'platform',
  ownerEntityId: 'e-1',
  surface: 'shamwari.ai',
  requestId: 'r-1',
};

function fakeEnv() {
  const run = vi.fn(async () => ({ response: 'fallback answer' }));
  return {
    AI: { run },
    CF_ACCOUNT_ID: 'acct',
    CF_GATEWAY_ID: 'gw',
    CF_AIG_TOKEN: 'aig',
    ECONOMY_MODEL: 'qwen3.8-max',
    STANDARD_MODEL: 'kimi-k3',
    QWEN_API_KEY: 'q',
    MOONSHOT_API_KEY: 'm',
  } as unknown as Env;
}

const body = JSON.stringify({
  choices: [{ message: { content: 'hello' } }],
  usage: { prompt_tokens: 10, completion_tokens: 5 },
});

/** Gateway responds 200 with the given extra headers. */
function stubGateway(headers: Record<string, string> = {}) {
  const seen: { url: string; headers: Record<string, string> }[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    seen.push({ url, headers: init.headers as Record<string, string> });
    return new Response(body, { headers: { 'Content-Type': 'application/json', ...headers } });
  });
  return seen;
}

beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

describe('AI Gateway custom metadata', () => {
  it('sends at most the five entries AI Gateway will actually keep', () => {
    // Cloudflare silently ignores entries beyond five. A sixth would not
    // error; it would just stop reaching the route that branches on it.
    expect(Object.keys(buildMetadata(meta)).length).toBeLessThanOrEqual(
      AIG_METADATA_MAX_ENTRIES,
    );
  });

  it('uses only scalar values — objects are not supported as metadata', () => {
    for (const v of Object.values(buildMetadata(meta))) {
      expect(['string', 'number', 'boolean']).toContain(typeof v);
    }
  });

  it('sends no cf.* keys, which Cloudflare reserves and strips', () => {
    for (const k of Object.keys(buildMetadata(meta))) {
      expect(k.startsWith('cf.')).toBe(false);
    }
  });

  it('carries the tier and owner so a route can branch and meter per tenant', () => {
    const m = buildMetadata(meta);
    expect(m.tier).toBe('standard');
    expect(m.owner_entity_id).toBe('e-1');
    expect(m.scope).toBe('platform');
  });

  it('never puts message content in metadata — it lands in Cloudflare logs', () => {
    const m = buildMetadata({ ...meta, ownerEntityId: 'e-1' });
    for (const v of Object.values(m)) {
      expect(v).not.toContain('VAT');
    }
  });

  it('attaches the metadata header on the gateway request', async () => {
    const seen = stubGateway();
    const env = fakeEnv();
    await infer(env, targets(env).standard, messages, meta);
    const sent = seen[0]?.headers['cf-aig-metadata'];
    expect(sent).toBeDefined();
    expect(JSON.parse(String(sent)).request_id).toBe('r-1');
  });
});

describe('provenance follows the model that actually served', () => {
  it('uses the requested model when the gateway names no substitute', async () => {
    stubGateway();
    const env = fakeEnv();
    const r = await infer(env, targets(env).standard, messages, meta);
    expect(r.provider).toBe('moonshot');
    expect(r.model).toBe('kimi-k3');
    expect(r.substituted).toBe(false);
    expect(r.licenseClass).toBe('open_weight');
  });

  it('reads cf-aig-model and cf-aig-provider when a dynamic route substitutes', async () => {
    stubGateway({ 'cf-aig-provider': 'qwen', 'cf-aig-model': 'qwen3.8-max' });
    const env = fakeEnv();
    const r = await infer(env, targets(env).standard, messages, meta);
    expect(r.provider).toBe('qwen');
    expect(r.model).toBe('qwen3.8-max');
    expect(r.requestedModel).toBe('kimi-k3');
    expect(r.substituted).toBe(true);
    expect(r.licenseClass).toBe('open_weight');
  });

  it('stamps restricted when a route substitutes a restricted model', async () => {
    // THE ASSERTION THAT WOULD HAVE CAUGHT THE DEFECT. The Worker asked for
    // an open-weight tier; the route answered with Claude. Nothing in the
    // Worker changed, and nothing was deployed.
    stubGateway({ 'cf-aig-provider': 'anthropic', 'cf-aig-model': 'claude-opus-5' });
    const env = fakeEnv();
    const r = await infer(env, targets(env).standard, messages, meta);
    expect(r.licenseClass).toBe('restricted');
    expect(r.substituted).toBe(true);
  });

  it('reports the real fallback model id, not the string "fallback"', async () => {
    // Both providers unreachable. usageEvents must still say which model
    // answered, and the allowlist needs something real to key on.
    vi.stubGlobal('fetch', async () => new Response('nope', { status: 503 }));
    const env = fakeEnv();
    const r = await infer(env, targets(env).standard, messages, meta);
    expect(r.path).toBe('workers-ai');
    expect(r.provider).toBe('workers-ai');
    expect(r.model).toBe('@cf/qwen/qwen3-30b-a3b-fp8');
    expect(r.model).not.toBe('fallback');
    expect(r.licenseClass).toBe('open_weight');
    expect(r.substituted).toBe(true);
  });

  it('still degrades gateway -> direct -> workers-ai', async () => {
    let call = 0;
    vi.stubGlobal('fetch', async () => {
      call += 1;
      // 1: gateway fails. 2: direct succeeds.
      if (call === 1) return new Response('nope', { status: 500 });
      return new Response(body, { headers: { 'Content-Type': 'application/json' } });
    });
    const env = fakeEnv();
    const r = await infer(env, targets(env).standard, messages, meta);
    expect(r.path).toBe('direct');
    // The direct path has no cf-aig-* headers, so requested is what served.
    expect(r.substituted).toBe(false);
    expect(r.licenseClass).toBe('open_weight');
  });
});
