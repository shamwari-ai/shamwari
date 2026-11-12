// @vitest-environment node
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The service worker must never answer a sign-in request from its cache or a "shell": sign-in is a server round trip. The
// sign-in is at the ROOT now (/auth/*, /callback) and the old /lite/ addresses live on for a release. This runs the real
// generated worker's fetch handler against each address.
const sw = join(__dirname, '../../dist-app/lite/sw.js');
const built = (() => {
  try {
    return statSync(sw).isFile();
  } catch {
    return false; // no build here (the CI job that runs this has just built one)
  }
})();

function load() {
  const listeners: Record<string, (e: unknown) => void> = {};
  const self = {
    location: { origin: 'https://shamwari.ai' },
    registration: { active: null },
    addEventListener: (type: string, fn: (e: unknown) => void) => void (listeners[type] = fn),
    skipWaiting: () => Promise.resolve(),
    clients: { claim: () => Promise.resolve() },
  };
  new Function('self', 'caches', 'Request', 'fetch', readFileSync(sw, 'utf8'))(self, { match: () => Promise.resolve(undefined), open: () => Promise.resolve({}), keys: () => Promise.resolve([]) }, class {}, () => Promise.resolve(new Response('net')));
  return listeners.fetch!;
}

/** Did the worker take this request over (call respondWith)? */
function handled(path: string, mode: 'navigate' | 'cors' = 'navigate', method = 'GET'): boolean {
  let took = false;
  load()({
    request: { method, url: `https://shamwari.ai${path}`, mode },
    respondWith: () => void (took = true),
  });
  return took;
}

describe.skipIf(!built)('the built service worker leaves every sign-in address to the network', () => {
  it.each(['/auth/login', '/auth/token', '/auth/logout', '/callback', '/callback?code=c&state=s'])('%s is never taken over', (path) => {
    expect(handled(path)).toBe(false);
    expect(handled(path, 'cors')).toBe(false);
  });

  it.each(['/lite/auth/login', '/lite/auth/token', '/lite/auth/logout', '/lite/callback'])('the old address %s is never taken over either', (path) => {
    expect(handled(path)).toBe(false);
    expect(handled(path, 'cors')).toBe(false);
  });

  it('but the app shell and its files still are (the check can tell them apart)', () => {
    expect(handled('/lite/')).toBe(true);
    expect(handled('/lite/_astro/anything.js', 'cors')).toBe(true);
  });
});
