import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import worker from '../../worker/index';
import { PUBLIC_EXACT, gate, isGated, isPublic, type GateDeps } from '../../worker/gate';
import { SESSION_COOKIE, type CheckResult } from '../../worker/session';

const HOST = 'https://shamwari.ai';
const req = (path: string, cookie?: string, method = 'GET') =>
  new Request(`${HOST}${path}`, { method, headers: cookie ? { Cookie: `${SESSION_COOKIE}=${cookie}` } : {} });

function deps(result: CheckResult | 'throws' = { status: 'invalid' }) {
  const log: string[] = [];
  const d: GateDeps = {
    async check(sealed) {
      log.push(`check:${sealed}`);
      if (result === 'throws') throw new Error('secrets unbound');
      return result;
    },
    async asset(r) {
      log.push(`asset:${new URL(r.url).pathname}`);
      return new Response('APP-CONTENT', { status: 200, headers: { 'Content-Type': 'text/html' } });
    },
  };
  return { d, log };
}

/** Every route the app serves, from the real build if there is one, plus the ones that matter. */
const ROUTES = ['/lite/', '/lite/index.html', '/_astro/index.astro_astro_type_script_index_0_lang.Abc123.js', '/lite/anything', '/lite/auth/other'];

describe('the gate: no session, no app', () => {
  it('sends an unauthenticated page request straight to the hosted sign-in, and serves nothing', async () => {
    for (const path of ['/lite/', '/lite/index.html']) {
      const { d, log } = deps();
      const res = await gate(req(path), d);
      expect(res.status, path).toBe(302);
      expect(res.headers.get('Location'), path).toBe('/lite/auth/login');
      expect(res.headers.get('Cache-Control')).toBe('no-store');
      expect(await res.text()).not.toContain('APP-CONTENT');
      expect(log.filter((l) => l.startsWith('asset')), path).toEqual([]);
    }
  });

  it('refuses every other gated route without a session, without ever reading the asset', async () => {
    for (const path of ROUTES.slice(2)) {
      const { d, log } = deps();
      const res = await gate(req(path), d);
      expect(res.status, path).toBe(401);
      expect(await res.text()).not.toContain('APP-CONTENT');
      expect(log.filter((l) => l.startsWith('asset')), path).toEqual([]);
    }
  });

  it('refuses a cookie that is not a session, clears it, and still serves nothing', async () => {
    const { d, log } = deps({ status: 'invalid' });
    const res = await gate(req('/lite/', 'FORGED'), d);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/lite/auth/login');
    expect(res.headers.get('Set-Cookie')).toContain('Max-Age=0');
    expect(log).toEqual(['check:FORGED']);
  });

  it('serves the app only when the cookie is a session, valid or merely expired, and never lets a shared cache keep it', async () => {
    for (const status of ['valid', 'expired'] as const) {
      const { d, log } = deps({ status, accessToken: 't', sid: 's' } as CheckResult);
      const res = await gate(req('/lite/', 'GOOD'), d);
      expect(res.status, status).toBe(200);
      expect(await res.text()).toBe('APP-CONTENT');
      expect(res.headers.get('Cache-Control')).toBe('private, no-cache');
      expect(res.headers.get('Vary')).toContain('Cookie');
      expect(log).toEqual(['check:GOOD', 'asset:/lite/']);
    }
  });

  it('lets the browser keep a hashed script for good, but never a shared cache, and revalidates the page every time', async () => {
    const session = { status: 'valid', accessToken: 't', sid: 's' } as CheckResult;
    const script = await gate(req('/_astro/index.astro_astro_type_script_index_0_lang.BwXFjztz.js', 'GOOD'), deps(session).d);
    expect(script.headers.get('Cache-Control')).toBe('private, max-age=31536000, immutable');
    const page = await gate(req('/lite/', 'GOOD'), deps(session).d);
    expect(page.headers.get('Cache-Control')).toBe('private, no-cache');
  });

  it('fails closed when it cannot tell: a 503, never the page', async () => {
    for (const result of [{ status: 'unavailable' } as CheckResult, 'throws' as const]) {
      const { d, log } = deps(result);
      const res = await gate(req('/lite/', 'GOOD'), d);
      expect(res.status).toBe(503);
      expect(res.headers.get('Retry-After')).toBeTruthy();
      expect(await res.text()).not.toContain('APP-CONTENT');
      expect(log.filter((l) => l.startsWith('asset'))).toEqual([]);
    }
  });

  it('does not loop on a failed sign-in: it shows a plain page instead of sending the person back to sign-in', async () => {
    const { d } = deps();
    const res = await gate(req('/lite/?signin=failed'), d);
    expect(res.status).toBe(401);
    expect(res.headers.get('Location')).toBeNull();
    const body = await res.text();
    expect(body).toContain('We could not sign you in');
    expect(body).not.toContain('APP-CONTENT');
    // It is not served by the static assets, so it carries its own policy: it loads and runs nothing.
    expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('refuses anything but GET and HEAD', async () => {
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const { d, log } = deps({ status: 'valid', accessToken: 't', sid: 's' });
      const res = await gate(req('/lite/', 'GOOD', method), d);
      expect(res.status, method).toBe(405);
      expect(log).toEqual([]);
    }
  });
});

describe('what is public', () => {
  it('is exactly the privacy page, the manifest, the install icons, the service worker and the stylesheets, and nothing else', () => {
    expect([...PUBLIC_EXACT].sort()).toEqual(
      [
        '/lite/disclaimer',
        '/lite/disclaimer/',
        '/lite/manifest.webmanifest',
        '/lite/sw.js',
        '/lite/icons/icon-192.png',
        '/lite/icons/icon-512.png',
        '/lite/icons/maskable-512.png',
      ].sort(),
    );
    expect(isPublic('/_astro/index.D2XOePsR.css')).toBe(true);
    for (const p of ['/lite/', '/lite/index.html', '/_astro/app.Abc.js', '/_astro/x.css.map', '/_astro/sub/x.css', '/lite/disclaimer/extra', '/lite/icons/', '/lite/auth/token']) {
      expect(isPublic(p), p).toBe(false);
    }
  });

  it('is served without a session and without asking for one', async () => {
    for (const path of [...PUBLIC_EXACT, '/_astro/index.D2XOePsR.css']) {
      const { d, log } = deps();
      const res = await gate(req(path), d);
      expect(res.status, path).toBe(200);
      expect(log, path).toEqual([`asset:${path}`]);
    }
  });

  it('every file of the real build is either public, gated, or outside this Worker (the two root icons), none unaccounted for', () => {
    let dist: string | null = null;
    try {
      statSync(join(__dirname, '../../dist-app'));
      dist = join(__dirname, '../../dist-app');
    } catch {
      return; // no build here (the CI job that runs this has just built one)
    }
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
    const outside = new Set(['/favicon.png', '/apple-touch-icon.png', '/_headers', '/_redirects']);
    for (const f of walk(dist)) {
      const url = f.slice(dist.length).replace(/\/index\.html$/, '/');
      if (outside.has(url)) continue;
      // A file is served either way; the point is that it is deliberately one or the other.
      expect(isGated(url) || isPublic(url), url).toBe(true);
    }
    // The app's own script is gated, the privacy page is not.
    const scripts = walk(dist).filter((f) => f.endsWith('.js')).map((f) => f.slice(dist!.length)).filter((u) => u !== '/lite/sw.js');
    expect(scripts.length).toBeGreaterThan(0);
    for (const s of scripts) expect(isPublic(s), s).toBe(false);
  });
});

describe('the Worker in front of the gate', () => {
  const ctx = { waitUntil: () => {} };
  const assets = { fetch: async (r: Request) => new Response('APP-CONTENT:' + new URL(r.url).pathname) };

  it('fails closed with the sign-in secrets unbound: the page is a 503, the public pages still work', async () => {
    const env = { ASSETS: assets };
    expect((await worker.fetch(req('/lite/', 'COOKIE'), env, ctx)).status).toBe(503);
    expect((await worker.fetch(req('/lite/'), env, ctx)).status).toBe(302); // no cookie: to sign-in, nothing served
    const privacy = await worker.fetch(req('/lite/disclaimer/'), env, ctx);
    expect(privacy.status).toBe(200);
    expect(await privacy.text()).toBe('APP-CONTENT:/lite/disclaimer/');
    expect((await worker.fetch(req('/lite/manifest.webmanifest'), env, ctx)).status).toBe(200);
  });

  it('still sends /lite (no slash) to /lite/, as the static assets did, and does not guess other paths', async () => {
    const res = await worker.fetch(req('/lite'), { ASSETS: assets }, ctx);
    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe('https://shamwari.ai/lite/');
    expect((await worker.fetch(req('/_astro'), { ASSETS: assets }, ctx)).status).toBe(404);
  });

  it('serves nothing at all if the assets binding is missing', async () => {
    for (const path of ['/lite/', '/lite/disclaimer/']) {
      expect((await worker.fetch(req(path, 'COOKIE'), {}, ctx)).status, path).toBe(503);
    }
  });

  it('never reaches the app for any route without a session', async () => {
    const env = { ASSETS: assets };
    for (const path of ROUTES) {
      const res = await worker.fetch(req(path), env, ctx);
      expect([302, 401], path).toContain(res.status);
      expect(await res.text(), path).not.toContain('APP-CONTENT');
    }
  });

  it('keeps app/wrangler.jsonc routing the gated area to the Worker', () => {
    const text = readFileSync(join(__dirname, '../../app/wrangler.jsonc'), 'utf8');
    expect(text).toContain('"run_worker_first": ["/", "/lite/*", "/_astro/*"]');
  });
});
