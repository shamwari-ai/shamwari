// A model that returns no text did not answer. It used to travel as an answer:
// the Workers AI step substituted a canned apology, which was then stored as
// the model's output under an open-weight label and flagged trainable. Both
// steps now treat "no text" as a failure so the next rung engages and the
// degradation probe sees it.
import { describe, expect, it, vi, afterEach } from 'vitest';
import { viaGateway, viaWorkersAI } from '../src/gateway';
import type { RequestMetadata } from '../src/gateway';
import type { Env, Message } from '../src/types';
import { targets } from '../src/router';

const messages: Message[] = [{ role: 'user', content: 'What is the VAT rate?' }];
const meta: RequestMetadata = {
  tier: 'economy',
  scope: 'platform',
  ownerEntityId: 'e-1',
  surface: 'shamwari.ai',
  requestId: 'r-1',
};

function env(response: unknown) {
  return {
    AI: { run: vi.fn(async () => response) },
    CF_ACCOUNT_ID: 'a',
    CF_GATEWAY_ID: 'g',
    CF_ROUTE_NAME: 'shamwari',
    CF_AIG_TOKEN: { get: async () => 't' },
    ECONOMY_MODEL: '@cf/zai-org/glm-5.3-flash',
    STANDARD_MODEL: '@cf/zai-org/glm-5.3',
  } as unknown as Env;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('no text is a failure, not an answer', () => {
  it('the gateway step returns null for a 200 with no content', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', async () =>
      Response.json({ choices: [{ message: { content: '  ' } }] }),
    );
    const e = env({});
    expect(await viaGateway(e, targets(e).economy, messages, meta)).toBeNull();
  });

  it('the gateway step still returns a real answer', async () => {
    vi.stubGlobal('fetch', async () =>
      Response.json({ choices: [{ message: { content: 'ok' } }] }),
    );
    const e = env({});
    expect((await viaGateway(e, targets(e).economy, messages, meta))?.text).toBe('ok');
  });

  it('the Workers AI step throws rather than substituting an apology', async () => {
    const e = env({});
    await expect(viaWorkersAI(e, targets(e).economy, messages)).rejects.toThrow(/no text/);
  });

  it('the Workers AI step still returns a real answer', async () => {
    const e = env({ response: 'ok' });
    expect((await viaWorkersAI(e, targets(e).economy, messages)).text).toBe('ok');
  });
});
