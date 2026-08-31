// "Cloudflare is an enhancement, never a dependency" holds only while the
// fallback paths work — and on a healthy day nothing reaches them, which is
// why they rot. These tests cover the probe that reads all three.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { probe, healthDoc } from '../src/probe';
import type { Env } from '../src/types';

function fakeEnv(aiOk = true) {
  const run = vi.fn(async () => {
    if (!aiOk) throw new Error('workers ai down');
    return { response: 'ok' };
  });
  return {
    AI: { run },
    CF_ACCOUNT_ID: 'acct',
    CF_GATEWAY_ID: 'gw',
    CF_AIG_TOKEN: 'aig',
    ECONOMY_MODEL: 'qwen3.8-max',
    STANDARD_MODEL: 'kimi-k3',
    QWEN_API_KEY: 'q',
    MOONSHOT_API_KEY: 'm',
    SURFACE: 'shamwari.ai',
  } as unknown as Env;
}

const okBody = JSON.stringify({
  choices: [{ message: { content: 'ok' } }],
  usage: { prompt_tokens: 5, completion_tokens: 1 },
});

/** Records every request so assertions can read headers and bodies. */
function stubFetch(handler: (call: number) => Response) {
  const seen: { url: string; headers: Record<string, string>; body: string }[] = [];
  let call = 0;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    call += 1;
    seen.push({
      url,
      headers: (init.headers ?? {}) as Record<string, string>,
      body: String(init.body ?? ''),
    });
    return handler(call);
  });
  return seen;
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('probe', () => {
  it('exercises all three paths even when the first one succeeds', async () => {
    // The point of the whole file. infer() stops at the first success, so a
    // probe built on infer() would only ever report on the gateway.
    const seen = stubFetch(() => new Response(okBody, { status: 200 }));
    const env = fakeEnv();
    const r = await probe(env);

    expect(r.results.map((x) => x.path)).toEqual(['gateway', 'direct', 'workers-ai']);
    expect(r.allPathsHealthy).toBe(true);
    // Gateway and direct are HTTP; workers-ai goes through the AI binding.
    expect(seen.length).toBe(2);
    expect(env.AI.run).toHaveBeenCalledTimes(1);
  });

  it('skips the AI Gateway cache, or a HIT reports a dead provider as healthy', async () => {
    // The probe prompt is constant, so it is maximally cacheable. Without
    // this header the gateway step would keep answering from cache long
    // after the provider behind it started refusing every request.
    const seen = stubFetch(() => new Response(okBody, { status: 200 }));
    await probe(fakeEnv());
    expect(seen[0]?.headers['cf-aig-skip-cache']).toBe('true');
  });

  it('reports a rotted fallback while the service is still serviceable', async () => {
    // Gateway fine, direct provider broken. A user request would succeed and
    // nothing would look wrong — this is the exact failure the probe exists
    // to surface.
    stubFetch((call) =>
      call === 1 ? new Response(okBody, { status: 200 }) : new Response('nope', { status: 500 }),
    );
    const r = await probe(fakeEnv());

    expect(r.results.find((x) => x.path === 'gateway')?.ok).toBe(true);
    expect(r.results.find((x) => x.path === 'direct')?.ok).toBe(false);
    expect(r.allPathsHealthy).toBe(false);
    expect(r.serviceable).toBe(true);
  });

  it('records a thrown step as a failed step, not a failed probe', async () => {
    stubFetch(() => {
      throw new Error('dns exploded');
    });
    const r = await probe(fakeEnv(false));
    expect(r.results).toHaveLength(3);
    expect(r.serviceable).toBe(false);
    expect(r.results.every((x) => x.ok === false)).toBe(true);
  });

  it('captures an error string for the step that threw', async () => {
    stubFetch(() => new Response(okBody, { status: 200 }));
    const r = await probe(fakeEnv(false));
    const wai = r.results.find((x) => x.path === 'workers-ai');
    expect(wai?.ok).toBe(false);
    expect(wai?.error).toContain('workers ai down');
  });

  it('names what served each healthy path', async () => {
    stubFetch(() => new Response(okBody, { status: 200 }));
    const r = await probe(fakeEnv(), 'standard');
    expect(r.results.find((x) => x.path === 'gateway')?.served).toBe('moonshot/kimi-k3');
    expect(r.results.find((x) => x.path === 'workers-ai')?.served).toBe(
      'workers-ai/@cf/qwen/qwen3-30b-a3b-fp8',
    );
  });

  it('sends nothing personal — it reaches three providers on a schedule', async () => {
    const seen = stubFetch(() => new Response(okBody, { status: 200 }));
    await probe(fakeEnv());
    for (const call of seen) {
      const body = JSON.parse(call.body) as { messages: { content: string }[] };
      expect(body.messages).toHaveLength(1);
      expect(body.messages[0]?.content).toBe('Reply with the single word: ok');
    }
    // And the metadata it tags the log with claims platform scope only.
    const meta = JSON.parse(String(seen[0]?.headers['cf-aig-metadata']));
    expect(meta.scope).toBe('platform');
    expect(meta.owner_entity_id).toBe('__probe__');
  });
});

describe('healthDoc', () => {
  it('writes to platform.serviceHealth with per-path booleans hoisted', async () => {
    stubFetch((call) =>
      call === 1 ? new Response(okBody, { status: 200 }) : new Response('nope', { status: 500 }),
    );
    const doc = healthDoc(await probe(fakeEnv()));

    expect(doc.database).toBe('platform');
    expect(doc.collection).toBe('serviceHealth');
    expect(doc.doc.gatewayOk).toBe(true);
    expect(doc.doc.directOk).toBe(false);
    expect(doc.doc.workersAiOk).toBe(true);
    expect(doc.doc.allPathsHealthy).toBe(false);
    expect(doc.doc.check).toBe('inference-degradation');
  });

  it('carries no message content into the health row', async () => {
    stubFetch(() => new Response(okBody, { status: 200 }));
    const doc = healthDoc(await probe(fakeEnv()));
    expect(JSON.stringify(doc.doc)).not.toContain('Reply with');
  });
});
