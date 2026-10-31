// CORS lets the chat web app (a browser on shamwari.ai) call the gateway. These
// tests are about what it must NOT do as much as what it does: no wildcard, no
// reflecting an unlisted origin, no preflight for other endpoints, no credentials,
// and no change to the scope gate or to auth.
import { describe, expect, it } from 'vitest';
import worker from '../src/index';
import { allowedOrigins, corsOrigin } from '../src/cors';
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
    expect(res.headers.get('Access-Control-Expose-Headers')).toBe('Retry-After');
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

describe('configuration', () => {
  it('defaults to the Shamwari sites', () => {
    expect(allowedOrigins({})).toEqual(['https://shamwari.ai', 'https://www.shamwari.ai']);
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
