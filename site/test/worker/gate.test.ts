import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import worker from '../../worker/index';
import { PUBLIC_EXACT, gate, isGated, isPublic, type GateDeps } from '../../worker/gate';
import { COOKIE_PATH, SESSION_COOKIE, type CheckResult } from '../../worker/session';

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
const ROUTES = ['/chat/', '/chat/index.html', '/chat/_astro/index.astro_astro_type_script_index_0_lang.Abc123.js', '/chat/anything', '/chat/auth/other'];

describe('the gate: no session, no app', () => {
  it('sends an unauthenticated page request straight to the hosted sign-in, and serves nothing', async () => {
    for (const path of ['/chat/', '/chat/index.html']) {
      const { d, log } = deps();
      const res = await gate(req(path), d);
      expect(res.status, path).toBe(302);
      expect(res.headers.get('Location'), path).toBe('/auth/login');
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

  it('with an old /lite/ cookie and a new one both sent, the first copy that is a session decides: a spent old copy never turns away a good new one', async () => {
    const log: string[] = [];
    const d: GateDeps = {
      async check(sealed) {
        log.push(`check:${sealed}`);
        return sealed === 'OLD' ? { status: 'invalid' } : { status: 'valid', accessToken: 'a', sid: 's' };
      },
      async asset() {
        return new Response('APP-CONTENT', { status: 200 });
      },
    };
    const both = new Request(`${HOST}/chat/`, { headers: { Cookie: `${SESSION_COOKIE}=OLD; ${SESSION_COOKIE}=NEW` } });
    const res = await gate(both, d);
    expect(res.status).toBe(200);
    expect(log).toEqual(['check:OLD', 'check:NEW']);
    // When every copy is invalid, nothing is served and both places are cleared.
    const none = await gate(
      new Request(`${HOST}/chat/`, { headers: { Cookie: `${SESSION_COOKIE}=A; ${SESSION_COOKIE}=B` } }),
      deps({ status: 'invalid' }).d,
    );
    expect(none.status).toBe(302);
  });

  it('refuses a cookie that is not a session, clears it, and still serves nothing', async () => {
    const { d, log } = deps({ status: 'invalid' });
    const res = await gate(req('/chat/', 'FORGED'), d);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/auth/login');
    expect(res.headers.get('Set-Cookie')).toContain('Max-Age=0');
    // Cleared at the root and at the old /lite/ path, so no copy of the session is left behind.
    const cleared = res.headers.getSetCookie();
    expect(cleared.some((c) => c.includes('Path=/;'))).toBe(true);
    expect(cleared.some((c) => c.includes('Path=/lite/;'))).toBe(true);
    expect(log).toEqual(['check:FORGED']);
  });

  it('serves the app only when the cookie is a session, valid or merely expired, and never lets a shared cache keep it', async () => {
    for (const status of ['valid', 'expired'] as const) {
      const { d, log } = deps({ status, accessToken: 't', sid: 's' } as CheckResult);
      const res = await gate(req('/chat/', 'GOOD'), d);
      expect(res.status, status).toBe(200);
      expect(await res.text()).toBe('APP-CONTENT');
      expect(res.headers.get('Cache-Control')).toBe('private, no-cache');
      expect(res.headers.get('Vary')).toContain('Cookie');
      expect(log).toEqual(['check:GOOD', 'asset:/chat/']);
    }
  });

  it('lets the browser keep a hashed script for good, but never a shared cache, and revalidates the page every time', async () => {
    const session = { status: 'valid', accessToken: 't', sid: 's' } as CheckResult;
    const script = await gate(req('/chat/_astro/index.astro_astro_type_script_index_0_lang.BwXFjztz.js', 'GOOD'), deps(session).d);
    expect(script.headers.get('Cache-Control')).toBe('private, max-age=31536000, immutable');
    const page = await gate(req('/chat/', 'GOOD'), deps(session).d);
    expect(page.headers.get('Cache-Control')).toBe('private, no-cache');
  });

  it('fails closed when it cannot tell: a 503, never the page', async () => {
    for (const result of [{ status: 'unavailable' } as CheckResult, 'throws' as const]) {
      const { d, log } = deps(result);
      const res = await gate(req('/chat/', 'GOOD'), d);
      expect(res.status).toBe(503);
      expect(res.headers.get('Retry-After')).toBeTruthy();
      expect(await res.text()).not.toContain('APP-CONTENT');
      expect(log.filter((l) => l.startsWith('asset'))).toEqual([]);
    }
  });

  it('does not loop on a failed sign-in: it shows a plain page instead of sending the person back to sign-in', async () => {
    const { d } = deps();
    const res = await gate(req('/chat/?signin=failed'), d);
    expect(res.status).toBe(401);
    expect(res.headers.get('Location')).toBeNull();
    const body = await res.text();
    expect(body).toContain('We could not sign you in');
    expect(body).not.toContain('APP-CONTENT');
    // It is not served by the static assets, so it carries its own policy: it loads and runs nothing.
    expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
    // ... except its own icons: it names them, and the policy lets only same-origin images through.
    expect(body).toContain('rel="icon" href="/favicon.ico"');
    expect(body).toContain('rel="apple-touch-icon" href="/apple-touch-icon.png"');
    expect(res.headers.get('Content-Security-Policy')).toContain("img-src 'self'");
    expect(res.headers.get('Content-Security-Policy')).not.toMatch(/script-src|connect-src|style-src/);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('refuses anything but GET and HEAD', async () => {
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const { d, log } = deps({ status: 'valid', accessToken: 't', sid: 's' });
      const res = await gate(req('/chat/', 'GOOD', method), d);
      expect(res.status, method).toBe(405);
      expect(log).toEqual([]);
    }
  });
});

describe('what is public', () => {
  it('is exactly the privacy page, the manifest, the install icons, the service worker and the stylesheets, and nothing else', () => {
    expect([...PUBLIC_EXACT].sort()).toEqual(
      [
        '/chat/disclaimer',
        '/chat/disclaimer/',
        '/chat/manifest.webmanifest',
        '/chat/sw.js',
        '/chat/icons/icon-192.png',
        '/chat/icons/icon-512.png',
        '/chat/icons/maskable-512.png',
      ].sort(),
    );
    expect(isPublic('/chat/_astro/index.D2XOePsR.css')).toBe(true);
    for (const p of ['/chat/', '/chat/index.html', '/chat/_astro/app.Abc.js', '/chat/_astro/x.css.map', '/chat/_astro/sub/x.css', '/_astro/index.D2XOePsR.css', '/chat/disclaimer/extra', '/chat/icons/', '/chat/auth/token']) {
      expect(isPublic(p), p).toBe(false);
    }
  });

  it('is served without a session and without asking for one', async () => {
    for (const path of [...PUBLIC_EXACT, '/chat/_astro/index.D2XOePsR.css']) {
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
    // The retiring /lite/sw.js is outside the gate on purpose: the Worker serves it by name (worker/index.ts, OLD_SW).
    const outside = new Set(['/favicon.ico', '/favicon.png', '/apple-touch-icon.png', '/_headers', '/_redirects', '/lite/sw.js']);
    for (const f of walk(dist)) {
      const url = f.slice(dist.length).replace(/\/index\.html$/, '/');
      if (outside.has(url)) continue;
      // A file is served either way; the point is that it is deliberately one or the other.
      expect(isGated(url) || isPublic(url), url).toBe(true);
    }
    // The app's own script is gated, the privacy page is not.
    const scripts = walk(dist).filter((f) => f.endsWith('.js')).map((f) => f.slice(dist!.length)).filter((u) => u !== '/chat/sw.js' && u !== '/lite/sw.js');
    expect(scripts.length).toBeGreaterThan(0);
    for (const s of scripts) expect(isPublic(s), s).toBe(false);
  });
});

/** RFC 6265 5.1.4: would a browser send a cookie with this Path on a request for this path? */
const cookieSentTo = (cookiePath: string, requestPath: string) =>
  requestPath === cookiePath || (requestPath.startsWith(cookiePath) && (cookiePath.endsWith('/') || requestPath[cookiePath.length] === '/'));

describe('the session cookie reaches everything the gate protects (the production bug: scripts at /_astro/ were gated but outside the cookie Path)', () => {
  it('every gated path starts with the cookie Path, so the browser sends the cookie on it', () => {
    for (const p of [...ROUTES, '/chat/_astro/x.Abc123.js', '/chat/_astro/y.Abc123.css', '/chat/icons/x.png']) {
      if (!isGated(p)) continue;
      expect(cookieSentTo(COOKIE_PATH, p), p).toBe(true);
    }
    // And nothing outside the cookie Path is gated: a gated path the cookie cannot reach is a page that never loads.
    for (const p of ['/_astro/index.Abc123.js', '/assets/x.js', '/index.html', '/favicon.ico']) expect(isGated(p), p).toBe(false);
  });

  it('with the cookie a browser would really hold (Path=/), the real build loads: the page and every script and stylesheet it names answer 200', async () => {
    let dist: string;
    try {
      dist = join(__dirname, '../../dist-app');
      statSync(dist);
    } catch {
      return; // no build here (the CI job that runs this has just built one)
    }
    const html = readFileSync(join(dist, 'chat/index.html'), 'utf8');
    const refs = [...html.matchAll(/(?:src|href)="(\/chat\/_astro\/[^"]+)"/g)].map((m) => m[1]!);
    expect(refs.some((r) => r.endsWith('.js')), 'the page names a script under /chat/_astro/').toBe(true);
    // Every script and stylesheet the page names, wherever it is: if any is outside the cookie Path, the page breaks.
    const named = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"|<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"/g)].map((m) => (m[1] ?? m[2])!);
    expect(named.length).toBeGreaterThan(0);
    const session = { status: 'valid', accessToken: 't', sid: 's' } as CheckResult;
    for (const path of ['/chat/', ...named]) {
      const sent = cookieSentTo(COOKIE_PATH, path);
      expect(sent, `${path} is inside the session cookie's Path`).toBe(true);
      const { d } = deps(session);
      const res = await gate(req(path, sent ? 'GOOD' : undefined), d);
      expect(res.status, path).toBe(200);
    }
  });
});

describe('the Worker in front of the gate', () => {
  const ctx = { waitUntil: () => {} };
  const assets = { fetch: async (r: Request) => new Response('APP-CONTENT:' + new URL(r.url).pathname) };

  it('fails closed with the sign-in secrets unbound: the page is a 503, the public pages still work', async () => {
    const env = { ASSETS: assets };
    expect((await worker.fetch(req('/chat/', 'COOKIE'), env, ctx)).status).toBe(503);
    expect((await worker.fetch(req('/chat/'), env, ctx)).status).toBe(302); // no cookie: to sign-in, nothing served
    const privacy = await worker.fetch(req('/chat/disclaimer/'), env, ctx);
    expect(privacy.status).toBe(200);
    expect(await privacy.text()).toBe('APP-CONTENT:/chat/disclaimer/');
    expect((await worker.fetch(req('/chat/manifest.webmanifest'), env, ctx)).status).toBe(200);
  });

  it('sends /chat (no slash) to /chat/ with its query, and does not guess other paths', async () => {
    const res = await worker.fetch(req('/chat?x=1'), { ASSETS: assets }, ctx);
    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe('/chat/?x=1');
    expect((await worker.fetch(req('/_astro'), { ASSETS: assets }, ctx)).status).toBe(404);
    // The old build-output paths are not the app's any more: nothing is served there.
    expect((await worker.fetch(req('/_astro/index.Abc123.js'), { ASSETS: assets }, ctx)).status).toBe(404);
  });

  it('serves the retiring /lite/sw.js to anyone, from the assets, never redirected and never gated', async () => {
    const env = { ASSETS: assets };
    for (const method of ['GET', 'HEAD']) {
      const res = await worker.fetch(req('/lite/sw.js', undefined, method), env, ctx);
      expect(res.status, method).toBe(200);
      expect(res.headers.get('Location'), method).toBeNull();
    }
    expect(await (await worker.fetch(req('/lite/sw.js'), env, ctx)).text()).toBe('APP-CONTENT:/lite/sw.js');
    expect((await worker.fetch(req('/lite/sw.js', undefined, 'POST'), env, ctx)).status).toBe(405);
    expect((await worker.fetch(req('/lite/sw.js'), {}, ctx)).status).toBe(503); // no assets binding: nothing to serve
  });

  it('serves nothing at all if the assets binding is missing', async () => {
    for (const path of ['/chat/', '/chat/disclaimer/']) {
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
    expect(text).toContain('"run_worker_first": ["/", "/auth/*", "/callback", "/chat", "/chat/*", "/lite", "/lite/*"]');
  });
});
