// CORS lets the chat web app (a browser on shamwari.ai) call the gateway. These
// tests are about what it must NOT do as much as what it does: no wildcard, no
// reflecting an unlisted origin, no preflight for other endpoints, no credentials,
// and no change to the scope gate or to auth.
import { describe, expect, it } from 'vitest';
import worker from '../src/index';
import { allowedOrigins, corsOrigin, withCors } from '../src/cors';
import type { Env } from '../src/types';

const env = { AUTH_CACHE_TTL: '60' } as unknown as Env;
const ctx = { waitUntil: () => {} } as unknown as ExecutionContext;
const SITE = 'https://shamwari.ai';

const preflight = (origin: string | null, path = '/v1/chat/completions', e: Env = env) =>
  worker.fetch(
    new Request(`https://gw.example${path}`, {
      method: 'OPTIONS',
      headers: {
        ...(origin ? { Origin: origin } : {}),
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization, content-type, idempotency-key, x-shamwari-channel',
      },
    }),
    e,
    ctx,
  );

describe('preflight', () => {
  it('lets the Shamwari sites send the headers the chat app sends', async () => {
    for (const origin of ['https://shamwari.ai', 'https://www.shamwari.ai']) {
      const res = await preflight(origin);
      expect(res.status).toBe(204);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe(origin);
      expect(res.headers.get('Access-Control-Allow-Methods')).toBe('POST, OPTIONS');
      const allowed = res.headers.get('Access-Control-Allow-Headers')!.split(', ');
      expect(allowed).toEqual(expect.arrayContaining(['authorization', 'content-type', 'idempotency-key', 'x-shamwari-channel']));
      expect(res.headers.get('Vary')).toContain('Origin');
    }
  });

  it('gives an unlisted origin nothing, so the browser blocks the real request', async () => {
    for (const origin of ['https://evil.example', 'https://shamwari.ai.evil.example', 'http://shamwari.ai', 'null']) {
      const res = await preflight(origin);
      expect(res.status).toBe(204);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
      expect(res.headers.get('Access-Control-Allow-Headers')).toBeNull();
    }
  });

  it('is never a wildcard and never allows credentials', async () => {
    const res = await preflight(SITE);
    expect(res.headers.get('Access-Control-Allow-Origin')).not.toBe('*');
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBeNull();
  });

  it('only answers for the chat endpoint: any other preflight fails, so a browser cannot call it', async () => {
    // (/health answers any method with a public status; it never needed a preflight.)
    for (const path of ['/v1/ground/context', '/v1/channels/sms', '/v1/channels/ussd']) {
      const res = await preflight(SITE, path);
      // A preflight needs a 2xx and the allow headers; these get neither.
      expect(res.ok).toBe(false);
      expect(res.headers.get('Access-Control-Allow-Methods')).toBeNull();
      expect(res.headers.get('Access-Control-Allow-Headers')).toBeNull();
    }
  });
});

describe('responses', () => {
  const post = (origin: string | null, e: Env = env) =>
    worker.fetch(
      new Request('https://gw.example/v1/chat/completions', {
        method: 'POST',
        headers: { ...(origin ? { Origin: origin } : {}), 'Content-Type': 'application/json' },
        body: '{}',
      }),
      e,
      ctx,
    );

  it('carry the allowed origin and expose Retry-After, on errors too', async () => {
    const res = await post(SITE); // no key: a 401, which a browser must still be able to read
    expect(res.status).toBe(401);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(SITE);
    expect(res.headers.get('Access-Control-Expose-Headers')).toBe('Retry-After, Idempotent-Replayed');
    expect(res.headers.get('Vary')).toContain('Origin');
  });

  it('carry nothing for an unlisted origin, or for no origin at all', async () => {
    for (const origin of ['https://evil.example', null]) {
      const res = await post(origin);
      expect(res.status).toBe(401);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    }
  });

  it('do not change auth: CORS is not a credential', async () => {
    const res = await post(SITE);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
    expect(res.status).toBe(401);
  });
});

describe('scope of the change', () => {
  const call = (path: string, method: string, origin = SITE, e: Env = env) =>
    worker.fetch(new Request(`https://gw.example${path}`, { method, headers: { Origin: origin }, body: method === 'POST' ? '{}' : undefined }), e, ctx);

  it('puts no CORS header on any other endpoint, so a page cannot read their responses', async () => {
    for (const [path, method] of [['/health', 'GET'], ['/v1/ground/context', 'POST'], ['/v1/channels/sms', 'POST'], ['/v1/channels/ussd', 'POST']] as const) {
      const res = await call(path, method);
      expect(res.headers.get('Access-Control-Allow-Origin'), `${method} ${path}`).toBeNull();
    }
  });

  it('answers an OPTIONS that is not a CORS preflight exactly as before', async () => {
    const res = await worker.fetch(new Request('https://gw.example/v1/chat/completions', { method: 'OPTIONS' }), env, ctx);
    expect(res.status).toBe(404);
  });

  it('turns an unexpected exception into a readable 500, not an opaque network failure', async () => {
    // A key store that throws is the kind of fault that used to escape the handler.
    const boom = { ...env, AUTH_CACHE: { get: () => { throw new Error('kv down'); }, put: async () => {} } } as unknown as Env;
    const res = await worker.fetch(
      new Request('https://gw.example/v1/chat/completions', {
        method: 'POST',
        headers: { Origin: SITE, Authorization: 'Bearer sk_shamwari_x', 'Content-Type': 'application/json' },
        body: '{}',
      }),
      boom,
      ctx,
    );
    expect(res.status).toBe(500);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(SITE);
    expect(await res.json()).toEqual({ error: 'internal_error' });
  });

  it('keeps status, body and headers when it adds CORS, and always varies on Origin', async () => {
    const req = new Request('https://gw.example/v1/chat/completions', { method: 'POST', headers: { Origin: SITE } });
    const inner = new Response('{"error":"quota_exceeded"}', { status: 429, headers: { 'Retry-After': '30', 'Content-Type': 'application/json' } });
    const out = withCors(req, env, inner);
    expect(out.status).toBe(429);
    expect(out.headers.get('Retry-After')).toBe('30');
    expect(await out.text()).toBe('{"error":"quota_exceeded"}');

    const other = withCors(new Request('https://gw.example/v1/chat/completions', { method: 'POST' }), env, new Response('x'));
    expect(other.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(other.headers.get('Vary')).toContain('Origin');
  });
});

describe('configuration', () => {
  it('an origin set in the environment is honoured through the real handler', async () => {
    const e = { ...env, CORS_ORIGINS: 'https://preview.example' } as unknown as Env;
    const res = await worker.fetch(new Request('https://gw.example/v1/chat/completions', { method: 'POST', headers: { Origin: 'https://preview.example' }, body: '{}' }), e, ctx);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://preview.example');
    const blocked = await worker.fetch(new Request('https://gw.example/v1/chat/completions', { method: 'POST', headers: { Origin: SITE }, body: '{}' }), e, ctx);
    expect(blocked.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('set but empty switches CORS off; only unset means the defaults', () => {
    expect(allowedOrigins({ CORS_ORIGINS: '' })).toEqual([]);
    expect(allowedOrigins({ CORS_ORIGINS: '  ,  ' })).toEqual([]);
    expect(allowedOrigins({})).toEqual(['https://shamwari.ai', 'https://www.shamwari.ai']);
  });

  it('never allows the null origin, even if configured', () => {
    expect(allowedOrigins({ CORS_ORIGINS: 'null,https://a.example' })).toEqual(['https://a.example']);
    const req = new Request('https://gw.example/', { headers: { Origin: 'null' } });
    expect(corsOrigin(req, { CORS_ORIGINS: 'null' })).toBeNull();
  });

  it('forgives a trailing slash in the configured origin', () => {
    expect(allowedOrigins({ CORS_ORIGINS: 'https://shamwari.ai/' })).toEqual(['https://shamwari.ai']);
  });

  it('can be set, and trims and ignores blanks', () => {
    expect(allowedOrigins({ CORS_ORIGINS: ' https://a.example , ,https://b.example ' })).toEqual([
      'https://a.example',
      'https://b.example',
    ]);
  });

  it('refuses a wildcard even if one is configured', () => {
    const req = new Request('https://gw.example/', { headers: { Origin: 'https://anything.example' } });
    expect(corsOrigin(req, { CORS_ORIGINS: '*' })).toBeNull();
    const star = new Request('https://gw.example/', { headers: { Origin: '*' } });
    expect(corsOrigin(star, { CORS_ORIGINS: '*' })).toBeNull();
  });
});
