// The policy file is bundled into the Worker, so a bad edit is caught at
// deploy time at the earliest. These tests move that to CI: the shipped
// file is validated here, and every rejection path is exercised so the
// validator itself cannot rot into a no-op.
import { describe, expect, it } from 'vitest';
import { PolicyError, policy, validatePolicy } from '../src/router';
import shipped from '../routing-policy.json';

const valid = () => JSON.parse(JSON.stringify(shipped)) as Record<string, unknown>;

describe('the shipped routing-policy.json', () => {
  it('validates', () => {
    expect(() => validatePolicy(shipped)).not.toThrow();
  });

  it('is what the router actually loaded', () => {
    expect(policy.default_tier).toBe('economy');
    expect(policy.escalation.tier).toBe('standard');
    expect(policy.escalation.max_total_chars).toBe(6000);
    expect(policy.escalation.max_messages).toBe(12);
  });

  it('maps both public model names', () => {
    expect(policy.model_aliases).toEqual({
      'shamwari-economy': 'economy',
      'shamwari-standard': 'standard',
    });
  });

  it('carries no provenance fields — those belong in router.ts', () => {
    const keys = (v: unknown): string[] =>
      typeof v !== 'object' || v === null
        ? []
        : Array.isArray(v)
          ? v.flatMap(keys)
          : Object.entries(v).flatMap(([k, child]) => [k.toLowerCase(), ...keys(child)]);

    const present = new Set(keys(shipped));
    // Key names, not raw text — the notes field explains why these are
    // absent, so a substring scan would match its own prose.
    for (const forbidden of [
      'licenseclass',
      'license_class',
      'provider',
      'direct_url',
      'directurl',
      'api_key',
      'apikey',
    ]) {
      expect(present).not.toContain(forbidden);
    }
  });

  it('keeps a keyword bucket per language, so gaps are visible', () => {
    expect(Object.keys(policy.escalation.keywords).sort()).toEqual(['en', 'nd', 'sn']);
    // Ndebele is empty today. That is a known gap, not an oversight — this
    // assertion is here to fail loudly if someone fills it and forgets to
    // check the escalation tests still make sense.
    expect(policy.escalation.keywords.nd).toEqual([]);
    expect(policy.escalation.keywords.sn).toContain('tsanangura');
  });
});

describe('validatePolicy rejects', () => {
  it('a non-object', () => {
    for (const bad of [null, undefined, 'policy', 42, []]) {
      expect(() => validatePolicy(bad)).toThrow(PolicyError);
    }
  });

  it('an unsupported version', () => {
    expect(() => validatePolicy({ ...valid(), version: 2 })).toThrow(/unsupported version/);
    expect(() => validatePolicy({ ...valid(), version: undefined })).toThrow(/unsupported version/);
  });

  it('a tier name that does not exist in code', () => {
    expect(() => validatePolicy({ ...valid(), default_tier: 'cheap' })).toThrow(
      /unknown default_tier/,
    );
    const p = valid();
    p.escalation = { ...(p.escalation as object), tier: 'deluxe' };
    expect(() => validatePolicy(p)).toThrow(/escalation\.tier names unknown tier/);
  });

  it('an alias pointing at a tier that does not exist', () => {
    expect(() =>
      validatePolicy({ ...valid(), model_aliases: { 'shamwari-turbo': 'turbo' } }),
    ).toThrow(/names unknown tier/);
  });

  it('a threshold that is zero, negative or fractional', () => {
    for (const bad of [0, -1, 1.5, '6000', null]) {
      const p = valid();
      p.escalation = { ...(p.escalation as object), max_total_chars: bad };
      expect(() => validatePolicy(p)).toThrow(/max_total_chars must be a positive integer/);
    }
  });

  it('an uppercase keyword, which the lowercased match could never fire on', () => {
    const p = valid();
    p.escalation = {
      ...(p.escalation as object),
      keywords: { en: ['Calculate'] },
    };
    expect(() => validatePolicy(p)).toThrow(/must be lowercase/);
  });

  it('an empty or non-string keyword', () => {
    for (const bad of ['', 42, null]) {
      const p = valid();
      p.escalation = { ...(p.escalation as object), keywords: { en: [bad] } };
      expect(() => validatePolicy(p)).toThrow(/non-string or empty entry/);
    }
  });

  it('keywords that are not grouped into arrays', () => {
    const p = valid();
    p.escalation = { ...(p.escalation as object), keywords: { en: 'calculate' } };
    expect(() => validatePolicy(p)).toThrow(/must be an array/);
  });
});
