// WorkOS sign-in: a token is believed only after its signature, issuer, audience,
// client and expiry check out, and what it may ask for is one fixed grant decided in code:
// no permission, role or claim in the token can raise it.
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
import { conversationTrainable } from '../src/index';
import coreMain from '../../core/main.py?raw';
import { FIXED_GRANT, PERSON_ID_PATTERN, resetJwksCache, verifyWorkosToken } from '../src/workos';
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
  personId?: unknown;
  exp?: string | number | null;
  iat?: boolean;
  iatAgo?: number;
  /** Extra claims, merged last: permissions, roles, org_id, whatever a real token might carry. */
  extra?: Record<string, unknown>;
}

async function token(o: TokenOpts = {}): Promise<string> {
  // No permissions claim by default: a token with none must work.
  const claims: Record<string, unknown> = {};
  if (o.personId !== null) claims.person_id = o.personId === undefined ? 'person_abc123' : o.personId;
  if (o.sid !== null) claims.sid = o.sid ?? 'session_1';
  if (o.clientId !== null) claims.client_id = o.clientId ?? CLIENT;
  Object.assign(claims, o.extra);
  const jwt = new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: o.kid ?? 'k1' });
  if (o.iatAgo) jwt.setIssuedAt(Math.floor(Date.now() / 1000) - o.iatAgo);
  else if (o.iat !== false) jwt.setIssuedAt();
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
  it('becomes a per-person context with the fixed grant, from a token that carries no permissions', async () => {
    const r = await verifyWorkosToken(await token(), makeEnv());
    expect(r).toEqual({
      status: 'ok',
      ctx: {
        apiKeyId: 'workos:sid:session_1',
        ownerEntityId: 'person_abc123',
        ownerPersonId: 'person_abc123',
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
      person_id: 'person_abc123',
    })}.`;
    expect(await verify(t)).toBe('invalid');
  });

  it('refuses HS256 signed with the public key as the shared secret', async () => {
    // The classic confusion: a verifier that trusts the header's alg and has only
    // the public key to hand would accept this.
    const secret = new TextEncoder().encode(JSON.stringify(publicJwk));
    const t = await new SignJWT({ sid: 's', client_id: CLIENT, person_id: 'person_abc123' })
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
    ['a session id that is not inert', { sid: 'a b/../c' }],
    ['a lifetime past the ceiling (iat 2h ago, exp still ahead)', { iatAgo: 7200, exp: '1h' }],
  ] as [string, TokenOpts][])('refuses a token with %s', async (_label, opts) => {
    expect(await verify(await token(opts))).toBe('invalid');
  });

  it('refuses garbage that only looks like a token', async () => {
    expect(await verify('aaa.bbb.ccc')).toBe('invalid');
  });
});

describe('a real sign-in that is not provisioned is a 403, not a 401', () => {
  it.each([
    ['no canonical person id (never falls back to sub)', { personId: null }],
    ['an empty person id', { personId: '' }],
    ['a non-string person id', { personId: 42 }],
    ['a person id that is not inert in a URL', { personId: 'p1&owner_entity_id=other' }],
    ['a person id with a path in it', { personId: '../admin' }],
    // Core's owner-id pattern stops at 64, so 65 would pass here and 422 there.
    ['a person id longer than Core accepts', { personId: 'p'.repeat(65) }],
  ] as [string, TokenOpts][])('%s', async (_label, opts) => {
    expect(await verifyWorkosToken(await token(opts), makeEnv())).toEqual({
      status: 'forbidden',
      reason: 'no_person_id',
    });
  });

  it('accepts a person id of exactly Core\'s maximum length', async () => {
    expect(await verify(await token({ personId: 'p'.repeat(64) }))).toBe('ok');
  });

  it('says which gap it is, over HTTP, and does not look like a bad credential', async () => {
    const res = await worker.fetch(
      new Request('https://x/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${await token({ personId: null })}` },
        body: '{}',
      }),
      makeEnv(),
      { waitUntil() {} } as unknown as ExecutionContext,
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'not_provisioned', reason: 'no_person_id' });
  });
});

describe('the person id pattern stays in step with Core', () => {
  it('is exactly the owner-id pattern Core validates', () => {
    const core = /^_ID = r"(.+)"$/m.exec(coreMain)?.[1];
    expect(core).toBeDefined();
    expect(new RegExp(core!).test('p'.repeat(64))).toBe(true);
    expect(new RegExp(core!).test('p'.repeat(65))).toBe(false);
    for (const id of ['p'.repeat(64), 'p'.repeat(65), 'a b', 'a&b', '', 'ok_id.1:2-3']) {
      expect(PERSON_ID_PATTERN.test(id)).toBe(new RegExp(core!).test(id));
    }
  });
});

describe('who is metered', () => {
  it('is the canonical person id, not WorkOS sub, and the same person is one identity across sessions', async () => {
    const a = await verifyWorkosToken(await token({ sub: 'user_A', sid: 's1' }), makeEnv());
    const b = await verifyWorkosToken(await token({ sub: 'user_B', sid: 's2' }), makeEnv());
    if (a.status !== 'ok' || b.status !== 'ok') throw new Error('expected ok');
    expect(a.ctx.ownerEntityId).toBe('person_abc123');
    expect(b.ctx.ownerEntityId).toBe(a.ctx.ownerEntityId); // same person_id, different sub and session
    expect(a.ctx.apiKeyId).not.toBe(b.ctx.apiKeyId);
  });

  it('puts only the validated id into the quota request URL', async () => {
    const t = await token({ personId: 'person_abc123' });
    await worker.fetch(
      new Request('https://x/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${t}` },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
      }),
      makeEnv(),
      { waitUntil() {} } as unknown as ExecutionContext,
    ).catch(() => {});
    const rollup = calls.find((c) => c.startsWith('https://core.example/rollup'));
    expect(rollup).toContain('owner_entity_id=person_abc123&');
  });
});

describe('every signed-in person gets one fixed grant, and nothing in the token can change it', () => {
  const grant = async (extra?: Record<string, unknown>) => {
    const r = await verifyWorkosToken(await token({ extra }), makeEnv());
    if (r.status !== 'ok') throw new Error(`expected ok, got ${r.status}`);
    return r.ctx;
  };

  it('a token with no permissions, roles or org at all still gets community and platform', async () => {
    const ctx = await grant();
    expect(ctx.scopes).toEqual(['community', 'platform']);
    expect(permittedScopes(ctx)).toEqual(['community', 'platform']);
    expect(ctx.tier).toBe('community');
  });

  it.each([
    ['console and data admin permissions', { permissions: ['data:admin', 'data:read', 'console:admin', 'mongodb:access', 'github:access', 'fundi:admin', 'manage-production-app'] }],
    ['a role and roles', { role: 'admin', roles: ['admin', 'owner'] }],
    ['an organisation', { org_id: 'org_01', org: 'nyuchi' }],
    ['every personal-looking permission and scope claim', { permissions: ['shamwari:personal', 'personal', 'scope:personal'], scope: 'personal', scopes: ['personal'] }],
    ['an impersonation actor', { act: { sub: 'someone-else' } }],
    ['the old shamwari permissions', { permissions: ['shamwari:community'] }],
  ])('%s gains nothing: same grant, same tier, same cap, never personal', async (_label, extra) => {
    const plain = await grant();
    const loaded = await grant(extra);
    expect(loaded).toEqual(plain);
    expect(permittedScopes(loaded)).not.toContain('personal');
  });

  it('FIXED_GRANT is exactly community and platform', () => {
    expect([...FIXED_GRANT]).toEqual(['community', 'platform']);
  });

  it('answers a personal-scope request 409 and makes no provider or embedding call (rule 1), even for an admin', async () => {
    const t = await token({ extra: { permissions: ['data:admin', 'shamwari:personal'], role: 'admin' } });
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

  it('is invalid, not unavailable, for a token jose cannot make sense of (no pointless retries)', async () => {
    const good = await token();
    const [h, p, sig] = good.split('.') as [string, string, string];
    const hdr = JSON.parse(atob(h.replace(/-/g, '+').replace(/_/g, '/')));
    const crit = `${b64u({ ...hdr, crit: ['exp'], exp: 1 })}.${p}.${sig}`;
    expect(await verify(crit)).toBe('invalid');
    expect(await verify(`${b64u({ alg: 'RS256', kid: 'k1' })}.${b64u({})}.AAAA`)).toBe('invalid');
  });

  it('is unavailable when the JWKS answer is malformed', async () => {
    jwksBehaviour = () => Response.json({ not: 'a key set' });
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
    ['a non-numeric max token age', { WORKOS_MAX_TOKEN_AGE_SECONDS: 'forever' }],
    ['a zero max token age', { WORKOS_MAX_TOKEN_AGE_SECONDS: '0' }],
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

describe('signed-in people are not Mind training material (nobody asked them)', () => {
  it('keeps a WorkOS caller out of training even for an open_weight community answer', () => {
    expect(conversationTrainable('community', 'open_weight', false, 'shamwari')).toBe(true); // the unchanged baseline
    expect(conversationTrainable('community', 'open_weight', false, 'workos')).toBe(false);
    expect(conversationTrainable('platform', 'open_weight', false, 'workos')).toBe(false);
  });

  it('keeps every earlier way of saying no', () => {
    expect(conversationTrainable('personal', 'open_weight', false, 'shamwari')).toBe(false);
    expect(conversationTrainable('community', 'restricted', false, 'shamwari')).toBe(false);
    expect(conversationTrainable('community', 'open_weight', true, 'shamwari')).toBe(false);
  });
});
