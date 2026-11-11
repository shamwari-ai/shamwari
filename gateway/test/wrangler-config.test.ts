// The production vars live in wrangler.jsonc because `wrangler deploy` replaces dashboard
// vars. These fail on the mistakes that would silently break or weaken sign-in at deploy time.
import { describe, expect, it } from 'vitest';
import raw from '../wrangler.jsonc?raw';

// jsonc: drop // line comments (none of our values contain "//" outside a URL's "://"), trailing commas.
const config = JSON.parse(
  raw
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/,(\s*[}\]])/g, '$1'),
) as { vars: Record<string, string>; routes?: { pattern: string; custom_domain?: boolean }[] };

describe('wrangler.jsonc production vars', () => {
  const v = config.vars;

  it('enables WorkOS with a complete, well-formed configuration', () => {
    const ids = (v.WORKOS_CLIENT_ID ?? '').split(',');
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(id).toMatch(/^client_[0-9A-Z]{26}$/);
    for (const iss of (v.WORKOS_ISSUER ?? '').split(',')) expect(iss).toMatch(/^https:\/\/accounts\.mukoko\.com(\/\S+)?$/);
    expect(Number.isInteger(Number(v.WORKOS_MONTHLY_TOKEN_CAP))).toBe(true);
    expect(Number(v.WORKOS_MONTHLY_TOKEN_CAP)).toBeGreaterThan(0);
  });

  it('leaves the audience unset rather than blank (blank is a configuration error)', () => {
    expect('WORKOS_AUDIENCE' in v ? v.WORKOS_AUDIENCE.trim() : 'unset').not.toBe('');
  });

  it('never sets a secret as a plain var', () => {
    for (const name of Object.keys(v)) {
      expect(name).not.toMatch(/TOKEN$|SECRET|PASSWORD|KEY$/);
    }
  });

  it('keeps Mind off and Core on https', () => {
    expect(v.MIND_AVAILABLE).toBe('false');
    expect(v.CORE_URL).toMatch(/^https:\/\//);
  });

  it('puts the gateway on api.shamwari.ai as a custom domain', () => {
    expect(config.routes).toContainEqual({ pattern: 'api.shamwari.ai', custom_domain: true });
  });
});
