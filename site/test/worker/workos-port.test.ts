import { describe, expect, it, vi } from 'vitest';
import type { WorkOS } from '@workos-inc/node';
import { makePort, secret } from '../../worker/workos-port';
import { jwt } from './helpers';

const PASSWORD = 'p'.repeat(40);
const env = {
  WORKOS_CLIENT_ID: 'client_01M68PCT0T5ECHKDYH45ECT0GV',
  WORKOS_REDIRECT_URI: 'https://shamwari.ai/lite/callback',
  WORKOS_API_KEY: 'sk_test_x',
  COOKIE_PASSWORD: PASSWORD,
};

/** Only the surface the port touches. */
function fakeWorkos(over: Record<string, unknown> = {}) {
  const seen: Record<string, unknown[]> = {};
  const rec = (n: string, v: unknown) => ((seen[n] ??= []).push(v), v);
  const session = {
    authenticate: async () => ({
      authenticated: true,
      accessToken: 'AT',
      sessionId: 'sid1',
    }),
    refresh: async () => ({
      authenticated: true,
      sealedSession: 'S2',
      session: { accessToken: 'AT2' },
    }),
  };
  const um = {
    getAuthorizationUrl: (o: unknown) => (rec('url', o), 'https://auth/x'),
    authenticateWithCode: async (o: unknown) => (rec('code', o), { sealedSession: 'SEAL' }),
    loadSealedSession: (o: unknown) => (rec('load', o), session),
    getSessionFromCookie: async () => ({
      accessToken: jwt({ sid: 'sid-from-cookie' }),
    }),
    revokeSession: async (o: unknown) => void rec('revoke', o),
    ...over,
  };
  return { w: { userManagement: um } as unknown as WorkOS, seen, session };
}

describe('failures are logged, safely', () => {
  it('a failed exchange logs the error name, status and WorkOS code, never the code, key or cookie password', async () => {
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void logs.push(a.join(' ')));
    const err = Object.assign(new Error('The code has expired or has already been used.'), {
      name: 'OauthException',
      status: 400,
      error: 'invalid_grant',
    });
    const p = await makePort(
      { ...env, WORKOS_API_KEY: 'sk_test_SECRETKEY' },
      fakeWorkos({
        authenticateWithCode: async () => {
          throw err;
        },
      }).w,
    );
    expect(await p.exchangeCode('SECRETCODE')).toBeNull();
    spy.mockRestore();
    const line = logs.join('\n');
    for (const want of ['OauthException', 'status 400', 'invalid_grant']) expect(line).toContain(want);
    for (const secret of ['SECRETCODE', 'SECRETKEY', PASSWORD]) expect(line).not.toContain(secret);
  });

  it('a refresh that throws is logged too and stays a retry', async () => {
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void logs.push(a.join(' ')));
    const f = fakeWorkos();
    f.session.refresh = async () => {
      throw new Error('boom');
    };
    expect(await (await makePort(env, f.w)).refresh('SEALED-COOKIE')).toEqual({ status: 'retry' });
    spy.mockRestore();
    expect(logs.join('\n')).toContain('boom');
    expect(logs.join('\n')).not.toContain('SEALED-COOKIE');
  });
});

describe('makePort configuration', () => {
  it.each(['WORKOS_CLIENT_ID', 'WORKOS_REDIRECT_URI', 'WORKOS_API_KEY', 'COOKIE_PASSWORD'] as const)(
    'refuses to start without %s (an error, not a silent sign-out)',
    async (k) => {
      await expect(makePort({ ...env, [k]: undefined })).rejects.toThrow('not configured');
    },
  );
  it('refuses a short cookie password', async () => {
    await expect(makePort({ ...env, COOKIE_PASSWORD: 'short' })).rejects.toThrow('32');
  });
  it('reads Secrets Store bindings (get()) and plain strings alike', async () => {
    expect(await secret({ get: async () => 'v' })).toBe('v');
    expect(await secret('plain')).toBe('plain');
    expect(await secret(undefined)).toBeUndefined();
    const p = await makePort(
      {
        ...env,
        WORKOS_API_KEY: { get: async () => 'k' },
        COOKIE_PASSWORD: { get: async () => PASSWORD },
      },
      fakeWorkos().w,
    );
    expect(typeof p.check).toBe('function');
  });
});

describe('the WorkOS port', () => {
  it('builds an AuthKit URL for the Shamwari Chat client with the exact redirect URI and our state', async () => {
    const { w, seen } = fakeWorkos();
    const p = await makePort(env, w);
    p.authorizationUrl('ST');
    expect(seen.url![0]).toEqual({
      provider: 'authkit',
      clientId: 'client_01M68PCT0T5ECHKDYH45ECT0GV',
      redirectUri: 'https://shamwari.ai/lite/callback',
      state: 'ST',
    });
  });

  it('exchanges the code asking the SDK to seal the session with our password', async () => {
    const { w, seen } = fakeWorkos();
    const p = await makePort(env, w);
    expect(await p.exchangeCode('abc')).toEqual({ sealed: 'SEAL' });
    expect(seen.code![0]).toMatchObject({
      code: 'abc',
      session: { sealSession: true, cookiePassword: PASSWORD },
    });
  });

  it('a refused code, or a thrown error, is null and never throws', async () => {
    const p1 = await makePort(
      env,
      fakeWorkos({
        authenticateWithCode: async () => {
          throw new Error('bad');
        },
      }).w,
    );
    expect(await p1.exchangeCode('x')).toBeNull();
    const p2 = await makePort(env, fakeWorkos({ authenticateWithCode: async () => ({}) }).w);
    expect(await p2.exchangeCode('x')).toBeNull();
  });

  it('check: a verifying token is valid; an expired one is expired with the sid from the cookie', async () => {
    const p = await makePort(env, fakeWorkos().w);
    expect(await p.check('s')).toEqual({
      status: 'valid',
      accessToken: 'AT',
      sid: 'sid1',
    });

    const exp = fakeWorkos();
    exp.session.authenticate = async () => ({ authenticated: false, reason: 'invalid_jwt' }) as never;
    const p2 = await makePort(env, exp.w);
    expect(await p2.check('s')).toEqual({
      status: 'expired',
      sid: 'sid-from-cookie',
    });
  });

  it('check: no cookie or an unreadable cookie is an invalid session; an unexpected throw is "unavailable", never a sign-out', async () => {
    for (const reason of ['invalid_session_cookie', 'no_session_cookie_provided']) {
      const f = fakeWorkos();
      f.session.authenticate = async () => ({ authenticated: false, reason }) as never;
      expect(await (await makePort(env, f.w)).check('s')).toEqual({
        status: 'invalid',
      });
    }
    const f = fakeWorkos();
    f.session.authenticate = async () => {
      throw new Error('unseal failed');
    };
    expect(await (await makePort(env, f.w)).check('s')).toEqual({
      status: 'unavailable',
    });
  });

  it('refresh maps the SDK outcomes: success, terminal, retryable (with Retry-After), thrown', async () => {
    const f = fakeWorkos();
    const p = await makePort(env, f.w);
    expect(await p.refresh('s')).toEqual({
      status: 'ok',
      sealed: 'S2',
      accessToken: 'AT2',
    });

    f.session.refresh = async () =>
      ({
        authenticated: false,
        reason: 'invalid_grant',
        retryable: false,
      }) as never;
    expect(await p.refresh('s')).toEqual({ status: 'denied' });

    f.session.refresh = async () =>
      ({
        authenticated: false,
        reason: 'rate_limit_exceeded',
        retryable: true,
        retryAfter: 9,
      }) as never;
    expect(await p.refresh('s')).toEqual({ status: 'retry', retryAfter: 9 });

    f.session.refresh = async () => {
      throw new Error('boom');
    };
    expect(await p.refresh('s')).toEqual({ status: 'retry' });

    f.session.refresh = async () => ({ authenticated: true }) as never; // success without tokens: do not guess
    expect(await p.refresh('s')).toEqual({ status: 'retry' });
  });

  it('revoke ends the WorkOS session even when the access token in the cookie has EXPIRED (the usual case)', async () => {
    const f = fakeWorkos();
    // authenticate() fails for an expired access token; revoke must not depend on it.
    f.session.authenticate = async () => ({ authenticated: false, reason: 'invalid_jwt' }) as never;
    await (await makePort(env, f.w)).revoke('s');
    expect(f.seen.revoke![0]).toEqual({ sessionId: 'sid-from-cookie' });
  });

  it('revoke with an unreadable cookie revokes nothing and does not throw', async () => {
    const f = fakeWorkos({ getSessionFromCookie: async () => undefined });
    await (await makePort(env, f.w)).revoke('s');
    expect(f.seen.revoke).toBeUndefined();
  });
});
