// ground() calls env.AI.run to embed the user's question. Embedding is
// inference, and env.AI is a Cloudflare-hosted model, so this is a rule-1
// surface even though it never looks like one — nothing here is named
// "provider" or "completion".
//
// The fake Env below counts AI.run calls. That count is the test.
import { describe, expect, it, vi } from 'vitest';
import { ground } from '../src/ground';
import type { Env, Message } from '../src/types';

const messages: Message[] = [{ role: 'user', content: 'Ndinobhadhara marii PAYE?' }];

function fakeEnv() {
  const run = vi.fn(async () => ({ data: [Array.from({ length: 1024 }, () => 0.1)] }));
  const fetch = vi.fn(async () => new Response(JSON.stringify({ chunks: [], hit: false })));
  return {
    env: {
      AI: { run },
      EMBEDDING_MODEL: '@cf/baai/bge-m3',
      GROUND_TOP_K: '6',
      CORE_URL: 'https://core.example',
      SHAMWARI_CORE_TOKEN: 't',
      fetch,
    } as unknown as Env,
    run,
    fetch,
  };
}

// Core is reached through core(), which uses global fetch. Stub it and
// return the request body so the assertions can read what was sent.
function stubFetch() {
  const seen: unknown[] = [];
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    seen.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify({ chunks: [], hit: false }), {
      headers: { 'Content-Type': 'application/json' },
    });
  });
  return seen;
}

describe('ground() and the edge embedding', () => {
  it('embeds on Cloudflare for a cloud destination', async () => {
    const seen = stubFetch();
    const { env, run } = fakeEnv();
    await ground(env, messages, 'e1', 'platform', 'cloud', 'sn');
    expect(run).toHaveBeenCalledTimes(1);
    expect((seen[0] as { embedding?: number[] }).embedding).toHaveLength(1024);
  });

  // THE REGRESSION. This ran unconditionally, so the moment
  // MIND_AVAILABLE=true stopped decideDestination throwing, every
  // personal-scope question was embedded by a third-party model — upstream
  // of Core's authoritative check, which is the one place designed to catch
  // it. docs/scaling-and-memory.md recorded this as fixed while it was not.
  it('never embeds on Cloudflare for a mind destination', async () => {
    const seen = stubFetch();
    const { env, run } = fakeEnv();
    await ground(env, messages, 'e1', 'personal', 'mind', 'sn');
    expect(run).not.toHaveBeenCalled();
    expect(seen[0]).not.toHaveProperty('embedding');
  });

  it('still sends the query text to Core, which is first-party', async () => {
    const seen = stubFetch();
    const { env } = fakeEnv();
    await ground(env, messages, 'e1', 'personal', 'mind', 'sn');
    expect((seen[0] as { query: string }).query).toBe(messages[0]?.content);
  });

  it('degrades to ungrounded rather than failing when Core is down', async () => {
    vi.stubGlobal('fetch', async () => new Response('boom', { status: 500 }));
    const { env } = fakeEnv();
    const r = await ground(env, messages, 'e1', 'personal', 'mind', 'sn');
    expect(r.hit).toBe(false);
    expect(r.systemPrompt).toContain('Shamwari');
  });
});
