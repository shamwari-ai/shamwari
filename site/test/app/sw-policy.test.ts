// @vitest-environment node
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The forced-update policy lives in three places that must agree: the service worker the build writes, the headers it is
// served with, and how the page registers it. Each assertion fails if its piece is removed.
const dist = join(__dirname, '../../dist-app');
const built = (() => {
  try {
    return statSync(join(dist, 'lite/sw.js')).isFile();
  } catch {
    return false; // no build here (the CI job that runs this has just built one)
  }
})();

describe.skipIf(!built)('the built service worker forces the update', () => {
  const sw = built ? readFileSync(join(dist, 'lite/sw.js'), 'utf8') : '';

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
