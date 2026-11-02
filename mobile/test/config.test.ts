import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** app.config.ts reads the environment when it loads, so each case loads a fresh copy. */
async function load(env: Record<string, string | undefined> = {}) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return (await import('../app.config')).default;
}
const ID = '3edfc139-4592-48ad-84a3-aacd0f0a9e72';

// The shell, CI or an EAS workflow may already set these (EAS_PROJECT_ID is a documented override). Each test
// starts from a clean slate and the original values come back afterwards, so results never depend on the
// environment or on test order.
const VARS = ['EAS_PROJECT_ID', 'EXPO_PUBLIC_SHAMWARI_API', 'EXPO_PUBLIC_WORKOS_CLIENT_ID'] as const;
const saved: Partial<Record<(typeof VARS)[number], string | undefined>> = {};
beforeEach(() => {
  for (const v of VARS) {
    saved[v] = process.env[v];
    delete process.env[v];
  }
});
afterEach(() => {
  for (const v of VARS) {
    if (saved[v] === undefined) delete process.env[v];
    else process.env[v] = saved[v];
  }
});

describe('app config', () => {
  it('points at the Shamwari EAS project: updates URL, project id, runtime policy and owner agree', async () => {
    const c = await load();
    expect(c.extra?.eas).toEqual({ projectId: ID });
    expect(c.updates?.url).toBe(`https://u.expo.dev/${ID}`);
    expect(c.runtimeVersion).toEqual({ policy: 'appVersion' }); // an update only reaches a build that can run it
    expect(c.owner).toBe('nyuchi-web-services');
    expect(c.slug).toBe('shamwari');
  });

  it('EAS_PROJECT_ID overrides the default, and an empty value turns updates off', async () => {
    const other = '00000000-0000-0000-0000-000000000000';
    const o = await load({ EAS_PROJECT_ID: other });
    expect(o.extra?.eas).toEqual({ projectId: other });
    expect(o.updates?.url).toBe(`https://u.expo.dev/${other}`);
    const off = await load({ EAS_PROJECT_ID: '' });
    expect(off.updates).toBeUndefined();
    expect(off.extra?.eas).toBeUndefined();
  });

  it('uses the app\'s own id as the redirect scheme and bundle id (a generic scheme can be claimed by another app)', async () => {
    const c = await load();
    expect(c.scheme).toBe('ai.shamwari.app');
    expect(c.ios?.bundleIdentifier).toBe('ai.shamwari.app');
    expect(c.android?.package).toBe('ai.shamwari.app');
  });

  it('ships only the known public keys in extra: adding one is a deliberate edit to this list', async () => {
    // Everything in the app config is readable by anyone who downloads the app. This list is a tripwire that
    // makes a new key a conscious decision. It is NOT a secret scanner: gitleaks in CI is the control for that.
    const c = await load();
    expect(Object.keys(c.extra ?? {}).sort()).toEqual(['apiBaseUrl', 'eas', 'workosClientId']);
    expect(JSON.stringify(c)).not.toMatch(/client_secret|sk_[a-z]+_/i);
  });

  it('is not affected by variables already set in the environment', async () => {
    process.env.EAS_PROJECT_ID = 'ambient';
    process.env.EXPO_PUBLIC_WORKOS_CLIENT_ID = 'client_ambient';
    expect((await load({ EAS_PROJECT_ID: undefined, EXPO_PUBLIC_WORKOS_CLIENT_ID: undefined })).extra?.eas).toEqual({ projectId: ID });
  });

  it('declares the plugins the native modules need', async () => {
    const c = await load();
    for (const p of ['expo-secure-store', 'expo-localization', 'expo-web-browser', 'expo-updates']) expect(c.plugins).toContain(p);
  });
});
