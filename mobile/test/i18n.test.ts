import { describe, expect, it } from 'vitest';
import { LANGUAGES, pickLanguage } from '../src/i18n/strings';
import { errorMessage } from '../src/lib/messages';
import type { AskErrorKind } from '../src/lib/types';

const flat = (o: unknown, p = ''): Record<string, string> =>
  Object.entries(o as Record<string, unknown>).reduce(
    (acc, [k, v]) => ({ ...acc, ...(typeof v === 'string' ? { [p + k]: v } : flat(v, `${p}${k}.`)) }),
    {},
  );

describe('strings', () => {
  const en = flat(LANGUAGES.en.strings);
  it('every language has every key, none empty', () => {
    for (const l of ['sn', 'nd'] as const) {
      const got = flat(LANGUAGES[l].strings);
      expect(Object.keys(got).sort()).toEqual(Object.keys(en).sort());
      for (const [k, v] of Object.entries(got)) expect(v.trim(), `${l}.${k}`).not.toBe('');
    }
  });
  it('Shona and Ndebele stay flagged for native review until a named reviewer signs off', () => {
    expect(LANGUAGES.en.needsNativeReview).toBe(false);
    expect(LANGUAGES.sn.needsNativeReview).toBe(true);
    expect(LANGUAGES.nd.needsNativeReview).toBe(true);
  });
  it('picks the first supported phone language, else English', () => {
    expect(pickLanguage(['fr-FR', 'sn-ZW', 'en'])).toBe('sn');
    expect(pickLanguage(['nd_ZW'])).toBe('nd');
    expect(pickLanguage(['nr-ZA'])).toBe('nd');
    expect(pickLanguage(['de', 'fr'])).toBe('en');
    expect(pickLanguage([])).toBe('en');
  });
  it('explains the Rule 1 refusal in full, in every language, and covers every failure kind', () => {
    const kinds: AskErrorKind[] = ['unauthorized', 'payment_required', 'forbidden_scope', 'rate_limited', 'unavailable', 'busy', 'offline', 'bad_request', 'unknown'];
    for (const l of ['en', 'sn', 'nd'] as const) {
      const s = LANGUAGES[l].strings;
      expect(errorMessage(s, 'scope_requires_local_inference')).toContain(s.scopePersonalBody);
      for (const k of kinds) expect(errorMessage(s, k), `${l}.${k}`).toBe(s.errors[k as keyof typeof s.errors]);
    }
  });
});
