import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CheckResult } from '../../worker/session';
import { SESSION_COOKIE } from '../../worker/session';

// The root asks the session check about a cookie it is shown. The real check needs WorkOS, so it is replaced here.
let result: CheckResult | Error = { status: 'invalid' };
vi.mock('../../worker/workos-port', () => ({
  makePort: async () => ({
    authorizationUrl: () => 'https://auth.example/authorize',
    exchangeCode: async () => null,
    check: async () => {
      if (result instanceof Error) throw result;
      return result;
    },
    revoke: async () => undefined,
    refresh: async () => ({ status: 'denied' }),
  }),
}));

const { default: worker } = await import('../../worker/index');

const at = (cookie?: string, headers: Record<string, string> = {}) =>
  new Request('https://shamwari.ai/', { headers: { ...(cookie ? { Cookie: cookie } : {}), ...headers } });
const ctx = { waitUntil: () => {} };
const env = { CHAT_LIVE: 'true' };
const FAST = { ECT: '4g', Downlink: '10', RTT: '30' };

describe('the root and the session', () => {
  beforeEach(() => {
    result = { status: 'invalid' };
  });

  it('a signed-out visitor goes to sign-in, whatever the connection', async () => {
    const res = await worker.fetch(at(undefined, FAST), env, ctx);
    expect([res.status, res.headers.get('Location')]).toEqual([302, '/auth/login']);
    expect(res.headers.get('Set-Cookie')).toBeNull();
  });

  it('a cookie that is not a session goes to sign-in and is cleared (root and the old /lite/ path)', async () => {
    const res = await worker.fetch(at(`${SESSION_COOKIE}=forged`, FAST), env, ctx);
    expect([res.status, res.headers.get('Location')]).toEqual([302, '/auth/login']);
    const cleared = res.headers.getSetCookie();
    expect(cleared.some((c) => c.includes('Path=/;') && c.includes('Max-Age=0'))).toBe(true);
    expect(cleared.some((c) => c.includes('Path=/lite/;') && c.includes('Max-Age=0'))).toBe(true);
  });

  it('a signed-in visitor at the root is sent to the app: the main chat on a fast link, the light chat otherwise', async () => {
    result = { status: 'valid', accessToken: 'a', sid: 's' };
    expect((await worker.fetch(at(`${SESSION_COOKIE}=ok`, FAST), env, ctx)).headers.get('Location')).toBe('/chat/');
    expect((await worker.fetch(at(`${SESSION_COOKIE}=ok`, { ...FAST, 'Save-Data': 'on' }), env, ctx)).headers.get('Location')).toBe('/lite/');
    expect((await worker.fetch(at(`${SESSION_COOKIE}=ok`), { CHAT_LIVE: 'false' }, ctx)).headers.get('Location')).toBe('/lite/');
  });

  it('an expired access token is still a session (it is renewed by /auth/token), so the visitor goes to the app', async () => {
    result = { status: 'expired', sid: 's' };
    expect((await worker.fetch(at(`${SESSION_COOKIE}=ok`), env, ctx)).headers.get('Location')).toBe('/lite/');
  });

  it('when the session cannot be checked the visitor is sent on to the app, whose own gate fails closed; the cookie is left alone', async () => {
    for (const r of [{ status: 'unavailable' } as CheckResult, new Error('workos down')]) {
      result = r;
      const res = await worker.fetch(at(`${SESSION_COOKIE}=ok`), env, ctx);
      expect(res.headers.get('Location')).toBe('/lite/');
      expect(res.headers.get('Set-Cookie')).toBeNull();
    }
  });
});
