// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { authModeOf } from '../../src/chat/auth-mode';
import { authModeProblem, builtAuthMode } from '../../check-auth-mode.mjs';

describe('authModeOf: Mukoko sign-in is the default', () => {
  it.each([undefined, null, '', 'mukoko', 'Mukoko', 'developer_key', 'devkey', 'true', 'off', 'anything else'])('%j is Mukoko', (v) => {
    expect(authModeOf(v as string | undefined | null)).toBe('mukoko');
  });
  it('only the exact name "developer-key" gives the developer-key screen', () => {
    expect(authModeOf('developer-key')).toBe('developer-key');
  });
});

describe('check.mjs refuses a build that is not in the mode it was asked for', () => {
  const page = (mode: string) => `<html><head><meta name="shamwari-auth" content="${mode}" /></head></html>`;

  it('a build with no setting must be Mukoko; a developer-key page fails', () => {
    expect(authModeProblem(page('mukoko'), {})).toBeNull();
    expect(authModeProblem(page('developer-key'), {})).toMatch(/"developer-key" mode, expected "mukoko"/);
    expect(authModeProblem(page('developer-key'), {})).toMatch(/coming soon/);
  });

  it('a build with the wrong setting fails too, and a missing meta tag fails', () => {
    expect(authModeProblem(page('developer-key'), { PUBLIC_CHAT_AUTH: 'mukoko' })).not.toBeNull();
    expect(authModeProblem('<html><head></head></html>', {})).toMatch(/no <meta name="shamwari-auth">/);
  });

  it('asking for the developer-key screen by name is allowed, for local work, and must really produce it', () => {
    expect(authModeProblem(page('developer-key'), { PUBLIC_CHAT_AUTH: 'developer-key' })).toBeNull();
    expect(authModeProblem(page('mukoko'), { PUBLIC_CHAT_AUTH: 'developer-key' })).not.toBeNull();
  });

  it('reads the mode out of a real attribute order', () => {
    expect(builtAuthMode(page('mukoko'))).toBe('mukoko');
    expect(builtAuthMode('<meta name="shamwari-auth" content="">')).toBe('');
  });
});

describe('post-build refuses a build in the wrong mode, whichever way the app was built', () => {
  it('node scripts/post-build.mjs on a developer-key page with no setting throws, so the Workers Build and deploy:app fail too', () => {
    const out = mkdtempSync(join(tmpdir(), 'shamwari-pb-'));
    try {
      const e = { ...process.env };
      delete e.PUBLIC_CHAT_AUTH;
      const b = spawnSync('npx', ['astro', 'build', '--config', 'astro.app.config.mjs', '--outDir', out], {
        cwd: join(__dirname, '../..'),
        env: { ...e, PUBLIC_CHAT_AUTH: 'developer-key' },
        encoding: 'utf8',
      });
      expect(b.status, b.stderr).toBe(0);
      const refused = spawnSync('node', ['scripts/post-build.mjs', out], { cwd: join(__dirname, '../..'), env: e, encoding: 'utf8' });
      expect(refused.status).not.toBe(0);
      expect(refused.stderr).toMatch(/"developer-key" mode, expected "mukoko"/);
      const allowed = spawnSync('node', ['scripts/post-build.mjs', out], { cwd: join(__dirname, '../..'), env: { ...e, PUBLIC_CHAT_AUTH: 'developer-key' }, encoding: 'utf8' });
      expect(allowed.status, allowed.stderr).toBe(0);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 180_000);
});

describe('the real build', () => {
  const build = (env: Record<string, string | undefined>) => {
    const out = mkdtempSync(join(tmpdir(), 'shamwari-auth-'));
    try {
      const e = { ...process.env, ...env };
      for (const [k, v] of Object.entries(env)) if (v === undefined) delete e[k];
      const r = spawnSync('npx', ['astro', 'build', '--config', 'astro.app.config.mjs', '--outDir', out], {
        cwd: join(__dirname, '../..'),
        env: e,
        encoding: 'utf8',
      });
      expect(r.status, r.stderr).toBe(0);
      return readFileSync(join(out, 'lite/index.html'), 'utf8');
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  };

  it('npm run build:app with NO environment setting produces the Mukoko sign-in page', () => {
    const html = build({ PUBLIC_CHAT_AUTH: undefined });
    expect(builtAuthMode(html)).toBe('mukoko');
    expect(authModeProblem(html, {})).toBeNull();
  }, 180_000);

  it('only PUBLIC_CHAT_AUTH=developer-key produces the developer-key page', () => {
    const html = build({ PUBLIC_CHAT_AUTH: 'developer-key' });
    expect(builtAuthMode(html)).toBe('developer-key');
    expect(authModeProblem(html, {})).not.toBeNull(); // and CI (no setting) would refuse it
  }, 180_000);
});
