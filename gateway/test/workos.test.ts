// WorkOS sign-in: a token is believed only after its signature, issuer, audience,
// client and expiry check out, and what it may ask for comes from its permissions,
// never from the token's say-so about itself.
//
// What these fail on: an unsigned or HS256-forged token being accepted, a token for
// another audience, issuer or app being accepted, a missing `aud` being waved through,
// a JWKS outage being treated as a revoked session (or, worse, as success), a token
// carrying a personal permission reaching personal scope (rule 1), and the two
// credential shapes being tried against each other's verifier.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import type { JWK } from 'jose';
import worker from '../src/index';
import { authenticate } from '../src/auth';
import { permittedScopes } from '../src/keys';
import { resetJwksCache, scopesFromPermissions, verifyWorkosToken } from '../src/workos';
import type { Env } from '../src/types';

const CLIENT = 'client_test';
const ISSUER = 'https://auth.example.test/user_management/client_test';
const AUDIENCE = 'https://api.shamwari.example';
const JWKS_URL = `https://api.workos.com/sso/jwks/${CLIENT}`;

let signing: CryptoKey;
let publicJwk: JWK;
let otherSigning: CryptoKey;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true });
  signing = pair.privateKey as CryptoKey;
  publicJwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  otherSigning = (await generateKeyPair('RS256')).privateKey as CryptoKey;
});

function makeEnv(extra: Record<string, unknown> = {}) {
  return {
    AUTH_CACHE: { get: async () => null, put: async () => {} },
    SINK: { send: async () => {}, sendBatch: async () => {} },
    CORE_URL: 'https://core.example',
    SHAMWARI_CORE_TOKEN: 'core-token',
    AUTH_CACHE_TTL: '60',
    MIND_AVAILABLE: 'false',
    WORKOS_CLIENT_ID: CLIENT,
    WORKOS_ISSUER: ISSUER,
    WORKOS_AUDIENCE: AUDIENCE,
    WORKOS_MONTHLY_TOKEN_CAP: '50000',
    ...extra,
  } as unknown as Env;
}

interface TokenOpts {
  key?: CryptoKey;
  kid?: string;
  iss?: string | null;
  aud?: string | null;
  sub?: string | null;
  sid?: string | null;
  clientId?: string | null;
  exp?: string | number | null;
  iat?: boolean;
  permissions?: unknown;
}

async function token(o: TokenOpts = {}): Promise<string> {
  const claims: Record<string, unknown> = {
    permissions: o.permissions === undefined ? ['shamwari:community', 'shamwari:platform'] : o.permissions,
  };
  if (o.sid !== null) claims.sid = o.sid ?? 'session_1';
  if (o.clientId !== null) claims.client_id = o.clientId ?? CLIENT;
  const jwt = new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: o.kid ?? 'k1' });
  if (o.iat !== false) jwt.setIssuedAt();
  if (o.exp !== null) jwt.setExpirationTime(o.exp ?? '5m');
  if (o.iss !== null) jwt.setIssuer(o.iss ?? ISSUER);
  if (o.aud !== null) jwt.setAudience(o.aud ?? AUDIENCE);
  if (o.sub !== null) jwt.setSubject(o.sub ?? 'user_01');
  return jwt.sign(o.key ?? signing);
}

const b64u = (v: unknown) => btoa(JSON.stringify(v)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

let calls: string[];
let jwksBehaviour: () => Response;

beforeEach(() => {
  resetJwksCache();
  calls = [];
  jwksBehaviour = () => Response.json({ keys: [publicJwk] });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      calls.push(url);
      if (url === JWKS_URL) return jwksBehaviour();
      if (url.startsWith('https://core.example/rollup')) return Response.json({ total_tokens: 0 });
      throw new Error(`unexpected outbound call: ${url}`);
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const verify = async (t: string, env = makeEnv()) => (await verifyWorkosToken(t, env)).status;

describe('a good token', () => {
  it('becomes a per-person context with the scopes its permissions grant', async () => {
    const r = await verifyWorkosToken(await token(), makeEnv());
    expect(r).toEqual({
      status: 'ok',
      ctx: {
        apiKeyId: 'workos:sid:session_1',
        ownerEntityId: 'workos:user_01',
        ownerPersonId: 'user_01',
        keyType: 'workos',
        tier: 'community',
        monthlyTokenCap: 50000,
        scopes: ['community', 'platform'],
      },
    });
  });

  it('is accepted through authenticate, and the key service is never asked about it', async () => {
    const req = new Request('https://x/', { headers: { Authorization: `Bearer ${await token()}` } });
    const r = await authenticate(req, makeEnv());
    expect(r.ok).toBe(true);
    expect(calls).toEqual([JWKS_URL]); // no Core /auth/verify, no Servers API
  });

  it('fetches the JWKS once for many tokens', async () => {
    const env = makeEnv();
    for (let i = 0; i < 3; i++) expect(await verify(await token(), env)).toBe('ok');
    expect(calls.filter((c) => c === JWKS_URL)).toHaveLength(1);
  });
});

describe('a token that is not what it says', () => {
  it('refuses alg none', async () => {
    const t = `${b64u({ alg: 'none', typ: 'JWT' })}.${b64u({
      sub: 'user_01',
      iss: ISSUER,
      aud: AUDIENCE,
      sid: 's',
      client_id: CLIENT,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 300,
      permissions: ['shamwari:community'],
    })}.`;
    expect(await verify(t)).toBe('invalid');
  });

  it('refuses HS256 signed with the public key as the shared secret', async () => {
    // The classic confusion: a verifier that trusts the header's alg and has only
    // the public key to hand would accept this.
    const secret = new TextEncoder().encode(JSON.stringify(publicJwk));
    const t = await new SignJWT({ sid: 's', client_id: CLIENT, permissions: ['shamwari:community'] })
      .setProtectedHeader({ alg: 'HS256', kid: 'k1' })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setSubject('user_01')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(secret);
    expect(await verify(t)).toBe('invalid');
  });

  it('refuses a token signed by a key that is not in the JWKS', async () => {
    expect(await verify(await token({ key: otherSigning }))).toBe('invalid');
  });

  it('refuses an unknown kid, and does not hammer the JWKS endpoint to find it', async () => {
    const env = makeEnv();
    for (let i = 0; i < 4; i++) expect(await verify(await token({ kid: `forged-${i}` }), env)).toBe('invalid');
    // One fetch to learn the keys, and at most one more after the cooldown; never one per forged kid.
    expect(calls.filter((c) => c === JWKS_URL).length).toBeLessThanOrEqual(2);
  });

  it.each([
    ['wrong audience', { aud: 'https://other.example' }],
    ['no audience at all', { aud: null }],
    ['wrong issuer', { iss: 'https://evil.example' }],
    ['no issuer at all', { iss: null }],
    ['no expiry (would be valid forever)', { exp: null }],
    ['no issued-at', { iat: false }],
    ['expired', { exp: Math.floor(Date.now() / 1000) - 60 }],
    ['another WorkOS app', { clientId: 'client_other' }],
    ['no client id', { clientId: null }],
    ['no subject', { sub: null }],
    ['no session id (cannot be revoked)', { sid: null }],
  ] as [string, TokenOpts][])('refuses a token with %s', async (_label, opts) => {
    expect(await verify(await token(opts))).toBe('invalid');
  });

  it('refuses garbage that only looks like a token', async () => {
    expect(await verify('aaa.bbb.ccc')).toBe('invalid');
  });
});

describe('scope comes from permissions and defaults to nothing', () => {
  it('refuses a valid token with no shamwari permission', async () => {
    expect(await verify(await token({ permissions: ['billing:read'] }))).toBe('invalid');
    expect(await verify(await token({ permissions: [] }))).toBe('invalid');
    expect(await verify(await token({ permissions: 'shamwari:community' }))).toBe('invalid');
  });

  it('grants exactly the scopes held, and ignores a personal permission', async () => {
    expect(scopesFromPermissions(['shamwari:community'])).toEqual(['community']);
    expect(scopesFromPermissions(['shamwari:personal', 'shamwari:community', 'personal'])).toEqual(['community']);
    expect(scopesFromPermissions([1, null, { a: 1 }, 'shamwari:platform'])).toEqual(['platform']);
  });

  it('refuses a token whose only shamwari permission is personal', async () => {
    expect(await verify(await token({ permissions: ['shamwari:personal'] }))).toBe('invalid');
  });

  it('never lets personal into the permitted scopes, whatever the token carries', async () => {
    const r = await verifyWorkosToken(
      await token({ permissions: ['shamwari:personal', 'shamwari:community', 'scope:personal'] }),
      makeEnv(),
    );
    expect(r.status).toBe('ok');
    if (r.status === 'ok') expect(permittedScopes(r.ctx)).toEqual(['community']);
  });

  it('answers a personal-scope request 409 and makes no provider or embedding call (rule 1)', async () => {
    const t = await token({ permissions: ['shamwari:personal', 'shamwari:community'] });
    const res = await worker.fetch(
      new Request('https://x/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'personal', messages: [{ role: 'user', content: 'my payslip' }] }),
      }),
      makeEnv(),
      { waitUntil() {} } as unknown as ExecutionContext,
    );
    expect(res.status).toBe(409);
    expect((await res.json()) as { error: string }).toMatchObject({ error: 'scope_requires_local_inference' });
    // JWKS and the quota rollup are the only calls that may happen.
    expect(calls.filter((c) => c !== JWKS_URL && !c.startsWith('https://core.example/rollup'))).toEqual([]);
  });
});

describe('failing closed', () => {
  it('is unavailable, not invalid and not ok, when the JWKS endpoint is down', async () => {
    jwksBehaviour = () => new Response('boom', { status: 500 });
    expect(await verify(await token())).toBe('unavailable');
  });

  it('is unavailable when the JWKS fetch throws', async () => {
    jwksBehaviour = () => {
      throw new TypeError('network down');
    };
    expect(await verify(await token())).toBe('unavailable');
  });

  it('is a 503 through the handler when the JWKS endpoint is down', async () => {
    jwksBehaviour = () => new Response('boom', { status: 500 });
    const res = await worker.fetch(
      new Request('https://x/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${await token()}` },
        body: '{}',
      }),
      makeEnv(),
      { waitUntil() {} } as unknown as ExecutionContext,
    );
    expect(res.status).toBe(503);
  });

  it.each([
    ['no issuer', { WORKOS_ISSUER: undefined }],
    ['no audience', { WORKOS_AUDIENCE: undefined }],
    ['no cap', { WORKOS_MONTHLY_TOKEN_CAP: undefined }],
    ['a non-numeric cap', { WORKOS_MONTHLY_TOKEN_CAP: 'lots' }],
    ['a zero cap', { WORKOS_MONTHLY_TOKEN_CAP: '0' }],
    ['a non-HTTPS JWKS URL', { WORKOS_JWKS_URL: 'http://api.workos.com/sso/jwks/x' }],
  ])('is unavailable, never permissive, with %s configured', async (_label, extra) => {
    expect(await verify(await token(), makeEnv(extra))).toBe('unavailable');
  });

  it('is off, and says invalid, when WorkOS is not configured at all', async () => {
    expect(await verify(await token(), makeEnv({ WORKOS_CLIENT_ID: undefined }))).toBe('invalid');
    expect(calls).toEqual([]);
  });
});

describe('the two credential shapes stay apart', () => {
  it('does not send an sk_ key to the WorkOS verifier', async () => {
    const req = new Request('https://x/', { headers: { Authorization: 'Bearer sk_shamwari_abcdefghijklmnop' } });
    // Core is not reachable in this test, so the key path ends 'unavailable'; what matters is the JWKS was not touched.
    await authenticate(req, makeEnv());
    expect(calls).not.toContain(JWKS_URL);
  });

  it('refuses a bearer that is neither shape without any outbound call', async () => {
    const req = new Request('https://x/', { headers: { Authorization: 'Bearer not-a-credential' } });
    expect(await authenticate(req, makeEnv())).toEqual({ ok: false, reason: 'invalid' });
    expect(calls).toEqual([]);
  });
});
