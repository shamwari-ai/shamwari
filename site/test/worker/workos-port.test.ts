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
      refreshToken: 'RT',
    }),
    authenticateWithRefreshToken: async (o: unknown) => (rec('refresh', o), { accessToken: 'AT2', refreshToken: 'RT2' }),
    sealSessionDataFromAuthenticationResponse: async (o: unknown) => (rec('seal', o), 'SEAL'),
    revokeSession: async (o: unknown) => void rec('revoke', o),
    ...over,
  };
  const pkce = { generate: async () => ({ codeVerifier: 'VERIF', codeChallenge: 'CHAL', codeChallengeMethod: 'S256' }) };
  return { w: { userManagement: um, pkce } as unknown as WorkOS, seen, session };
}

/** The real SDK with its HTTP layer replaced, so what would go to WorkOS can be inspected. */
async function realSdk(bodies: Record<string, unknown>[], apiKey?: string): Promise<WorkOS> {
  const real = await import('@workos-inc/node');
  const w = new real.WorkOS({ ...(apiKey ? { apiKey } : {}), clientId: env.WORKOS_CLIENT_ID });
  const user = { object: 'user', id: 'u', email: 'a@b.c', first_name: null, last_name: null, email_verified: true, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' };
  (w as unknown as { post: unknown }).post = async (_path: string, body: Record<string, unknown>) => (
    bodies.push(body),
    { data: { user, access_token: jwt({ sid: 's', exp: 9e9 }), refresh_token: 'r', organization_id: null } }
  );
  return w;
}

describe('keyless (public client) sign-in', () => {
  it('with NO API key the code exchange carries the verifier and no client secret; with a bound key it is passed through', async () => {
    const keyless: Record<string, unknown>[] = [];
    const p = await makePort({ ...env, WORKOS_API_KEY: undefined }, await realSdk(keyless));
    expect(await p.exchangeCode('CODE', 'VERIF')).not.toBeNull();
    expect(keyless[0]).toMatchObject({ code: 'CODE', code_verifier: 'VERIF', client_id: env.WORKOS_CLIENT_ID });
    expect(JSON.stringify(keyless[0])).not.toContain('client_secret');

    const keyed: Record<string, unknown>[] = [];
    const p2 = await makePort(env, await realSdk(keyed, 'sk_test_x'));
    await p2.exchangeCode('CODE', 'VERIF');
    expect(keyed[0]).toMatchObject({ code_verifier: 'VERIF', client_secret: 'sk_test_x' });
  });

  it('refreshing a session works keyless too: refresh_token grant, no client secret', async () => {
    const bodies: Record<string, unknown>[] = [];
    const p = await makePort({ ...env, WORKOS_API_KEY: undefined }, await realSdk(bodies));
    const first = await p.exchangeCode('CODE', 'VERIF');
    const r = await p.refresh(first!.sealed);
    expect(r.status).toBe('ok');
    const grant = bodies.find((b) => b.grant_type === 'refresh_token')!;
    expect(grant).toMatchObject({ refresh_token: 'r', client_id: env.WORKOS_CLIENT_ID });
    expect(JSON.stringify(grant)).not.toContain('client_secret');
  });

  it('sign-out without a key revokes nothing (it cannot) and does not throw', async () => {
    const f = fakeWorkos();
    const p = await makePort({ ...env, WORKOS_API_KEY: undefined }, f.w);
    await expect(p.revoke('s')).resolves.toBeUndefined();
    expect(f.seen.revoke).toBeUndefined();
    const p2 = await makePort(env, fakeWorkos().w);
    await expect(p2.revoke('s')).resolves.toBeUndefined();
  });

  it('a failed exchange logs the reason (name, status, code) and never the code, verifier, state or a key', async () => {
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
    expect(await p.exchangeCode('SECRETCODE', 'SECRETVERIFIER')).toBeNull();
    spy.mockRestore();
    const line = logs.join('\n');
    expect(line).toContain('OauthException');
    expect(line).toContain('status 400');
    expect(line).toContain('invalid_grant');
    for (const secret of ['SECRETCODE', 'SECRETVERIFIER', 'SECRETKEY', PASSWORD]) expect(line).not.toContain(secret);
  });
});

describe('makePort configuration', () => {
  it.each(['WORKOS_CLIENT_ID', 'WORKOS_REDIRECT_URI', 'COOKIE_PASSWORD'] as const)(
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
  it('builds an AuthKit URL for the Shamwari Chat client with the exact redirect URI, our state and a PKCE S256 challenge', async () => {
    const { w, seen } = fakeWorkos();
    const p = await makePort(env, w);
    const r = await p.authorizationUrl('ST');
    expect(seen.url![0]).toEqual({
      provider: 'authkit',
      clientId: 'client_01M68PCT0T5ECHKDYH45ECT0GV',
      redirectUri: 'https://shamwari.ai/lite/callback',
      state: 'ST',
      codeChallenge: 'CHAL',
      codeChallengeMethod: 'S256',
    });
    expect(r).toEqual({ url: 'https://auth/x', verifier: 'VERIF' });
  });

  it('exchanges the code with the verifier and seals the session with our password', async () => {
    const { w, seen } = fakeWorkos();
    const p = await makePort(env, w);
    expect(await p.exchangeCode('abc', 'VERIF')).toEqual({ sealed: 'SEAL' });
    // No `session.sealSession` (the SDK refuses that without an API key); the Worker seals with our password.
    expect(seen.code![0]).toEqual({ clientId: env.WORKOS_CLIENT_ID, code: 'abc', codeVerifier: 'VERIF' });
    expect(seen.seal![0]).toMatchObject({ cookiePassword: PASSWORD });
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
    expect(await p1.exchangeCode('x', 'v')).toBeNull();
    const p2 = await makePort(env, fakeWorkos({ authenticateWithCode: async () => ({}) }).w);
    expect(await p2.exchangeCode('x', 'v')).toBeNull();
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

  it('refresh maps the outcomes: success, terminal, retryable (with Retry-After), thrown, tokens missing', async () => {
    const f = fakeWorkos();
    const p = await makePort(env, f.w);
    expect(await p.refresh('s')).toEqual({ status: 'ok', sealed: 'SEAL', accessToken: 'AT2' });
    expect(f.seen.refresh![0]).toEqual({ clientId: env.WORKOS_CLIENT_ID, refreshToken: 'RT' });

    const failing = (e: Record<string, unknown>) =>
      makePort(
        env,
        fakeWorkos({
          authenticateWithRefreshToken: async () => {
            throw Object.assign(new Error('x'), e);
          },
        }).w,
      );
    expect(await (await failing({ error: 'invalid_grant' })).refresh('s')).toEqual({ status: 'denied' });
    expect(await (await failing({ code: 'sso_required' })).refresh('s')).toEqual({ status: 'denied' });
    expect(await (await failing({ name: 'RateLimitExceededException', retryAfter: 9 })).refresh('s')).toEqual({
      status: 'retry',
      retryAfter: 9,
    });
    expect(await (await failing({})).refresh('s')).toEqual({ status: 'retry', retryAfter: undefined });

    // A cookie with no refresh token can never refresh: the session is over, not "try again".
    const none = await makePort(env, fakeWorkos({ getSessionFromCookie: async () => ({}) }).w);
    expect(await none.refresh('s')).toEqual({ status: 'denied' });
    // A success without tokens is not guessed at.
    const empty = await makePort(env, fakeWorkos({ authenticateWithRefreshToken: async () => ({}) }).w);
    expect(await empty.refresh('s')).toEqual({ status: 'retry' });
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
