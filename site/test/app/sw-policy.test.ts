// @vitest-environment node
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The forced-update policy lives in three places that must agree: the service worker the build writes, the headers it is
// served with, and how the page registers it. Each assertion fails if its piece is removed.
const dist = join(__dirname, '../../dist-app');
const built = (() => {
  try {
    return statSync(join(dist, 'chat/sw.js')).isFile();
  } catch {
    return false; // no build here (the CI job that runs this has just built one)
  }
})();

describe.skipIf(!built)('the built service worker forces the update', () => {
  const sw = built ? readFileSync(join(dist, 'chat/sw.js'), 'utf8') : '';

  it('takes over as soon as the new shell is cached: skipWaiting after the precache, no message needed', () => {
    const install = sw.slice(sw.indexOf("addEventListener('install'"), sw.indexOf("addEventListener('message'"));
    expect(install).toMatch(/\.then\(\(\) => self\.skipWaiting\(\)\)/);
    expect(sw).not.toContain('skip-waiting');
    expect(install).not.toContain('registration.active'); // not only on the first install
  });

  it('on activate it deletes every older cache and claims every open page, unconditionally', () => {
    const activate = sw.slice(sw.indexOf("addEventListener('activate'"), sw.indexOf("addEventListener('fetch'"));
    expect(activate).toContain('caches.delete(k)');
    expect(activate).toContain('self.clients.claim()');
    expect(activate).not.toMatch(/if \(!old\.length\)/);
  });

  it('is served no-cache, so an update check is never answered from a stale copy', () => {
    const headers = readFileSync(join(dist, '_headers'), 'utf8');
    expect(headers).toMatch(/\/chat\/sw\.js\n\s+Cache-Control: no-cache/);
  });
});

// The app moved from /lite/ to /chat/ (docs/chat-app.md, "Moving from /lite/ to /chat/"). A browser that used /lite/ has a worker
// there that answers /lite/ from its cache; its update check fetches /lite/sw.js and gets this retiring worker. Run its handlers
// against a stand-in for the worker global, with an old /lite/ cache and the new /chat/ cache side by side.
describe.skipIf(!built)('the retiring /lite/sw.js', () => {
  const src = built ? readFileSync(join(dist, 'lite/sw.js'), 'utf8') : '';

  async function run() {
    const listeners: Record<string, (e: unknown) => void> = {};
    const stores = new Map<string, Set<string>>([
      ['shamwari-chat-0ld000000000', new Set(['https://shamwari.ai/lite/', 'https://shamwari.ai/lite/_astro/a.js'])],
      ['shamwari-chat-new000000000', new Set(['https://shamwari.ai/chat/', 'https://shamwari.ai/chat/_astro/b.js'])],
      ['someone-else', new Set(['https://shamwari.ai/lite/'])],
    ]);
    const calls: string[] = [];
    const self = {
      addEventListener: (type: string, fn: (e: unknown) => void) => (listeners[type] = fn),
      skipWaiting: () => calls.push('skipWaiting'),
      clients: { claim: async () => void calls.push('claim') },
      registration: { unregister: async () => (calls.push('unregister'), true) },
    };
    const caches = {
      keys: async () => [...stores.keys()],
      open: async (k: string) => ({ match: async (u: string) => (stores.get(k)!.has(new URL(u, 'https://shamwari.ai/lite/sw.js').href) ? {} : undefined) }),
      delete: async (k: string) => (calls.push(`delete:${k}`), stores.delete(k)),
    };
    new Function('self', 'caches', src)(self, caches);
    let done: Promise<unknown> = Promise.resolve();
    listeners.install?.({ waitUntil: (p: Promise<unknown>) => (done = p) });
    listeners.activate?.({ waitUntil: (p: Promise<unknown>) => (done = p) });
    await done;
    return { listeners, stores, calls };
  }

  it('takes over at once, deletes only the old /lite/ cache, then claims the pages and unregisters itself', async () => {
    const { stores, calls } = await run();
    expect(calls).toEqual(['skipWaiting', 'delete:shamwari-chat-0ld000000000', 'claim', 'unregister']);
    expect([...stores.keys()]).toEqual(['shamwari-chat-new000000000', 'someone-else']); // the /chat/ app's cache is untouched
  });

  it('answers no request: every /lite/ request goes to the network, where the Worker redirects it to /chat/', async () => {
    const { listeners } = await run();
    expect(listeners.fetch).toBeUndefined();
    expect(src).not.toContain('respondWith');
  });

  it('is served no-cache, so the old page\'s update check always sees it', () => {
    const headers = readFileSync(join(dist, '_headers'), 'utf8');
    expect(headers).toMatch(/\/lite\/sw\.js\n\s+Cache-Control: no-cache/);
  });
});

describe('the page registers and watches the worker', () => {
  const main = readFileSync(join(__dirname, '../../src/chat/main.ts'), 'utf8');

  it("registers with updateViaCache: 'none' so the browser never takes sw.js from its HTTP cache", () => {
    expect(main).toContain("updateViaCache: 'none'");
  });

  it('reloads on controllerchange through the guarded handler and starts the update checks', () => {
    expect(main).toContain("'controllerchange'");
    expect(main).toContain('reloadOnTakeover(');
    expect(main).toContain('startUpdateChecks(');
    expect(main).not.toMatch(/location\.reload\(\);\s*\n\s*\}\);\s*\n\s*const offer/); // the old unguarded reload is gone
  });
});
