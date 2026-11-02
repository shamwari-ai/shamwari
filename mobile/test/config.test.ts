import { afterEach, describe, expect, it, vi } from 'vitest';

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

afterEach(() => {
  delete process.env.EAS_PROJECT_ID;
  delete process.env.EXPO_PUBLIC_SHAMWARI_API;
  delete process.env.EXPO_PUBLIC_WORKOS_CLIENT_ID;
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

  it('puts nothing secret-looking in the public config (everything here ships inside the app)', async () => {
    const c = await load();
    const flat = JSON.stringify(c);
    expect(flat).not.toMatch(/client_secret|api[_-]?key|password|sk_[a-z]+_|private[_-]?key/i);
    const extra = Object.keys(c.extra ?? {});
    expect(extra.sort()).toEqual(['apiBaseUrl', 'eas', 'workosClientId']);
  });

  it('declares the plugins the native modules need', async () => {
    const c = await load();
    for (const p of ['expo-secure-store', 'expo-localization', 'expo-web-browser', 'expo-updates']) expect(c.plugins).toContain(p);
  });
});
