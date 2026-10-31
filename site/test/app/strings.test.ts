import { describe, expect, it } from 'vitest';
import { LANGUAGES, en, nd, pickLanguage, sn } from '../../src/chat/strings';

const keys = (o: object, p = ''): string[] =>
  Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' ? keys(v, `${p}${k}.`) : [`${p}${k}`]));

describe('strings', () => {
  it('has every English key in Shona and Ndebele, and no extras', () => {
    expect(keys(sn).sort()).toEqual(keys(en).sort());
    expect(keys(nd).sort()).toEqual(keys(en).sort());
  });

  it('marks Shona and Ndebele as needing native review, and English as not', () => {
    expect(LANGUAGES.sn.needsNativeReview).toBe(true);
    expect(LANGUAGES.nd.needsNativeReview).toBe(true);
    expect(LANGUAGES.en.needsNativeReview).toBe(false);
  });

  it('keeps the product names untranslated', () => {
    for (const s of [en, sn, nd]) {
      expect(s.shamwari).toBe('Shamwari');
      expect(s.ground).toBe('Ground');
    }
  });

  it('never claims verification, sovereignty or residency for Cloud', () => {
    const all = JSON.stringify([en, sn, nd]);
    expect(all).not.toMatch(/stays in africa|sovereign|ubuntu ai|open source model/i);
  });

  it('picks the first supported browser language', () => {
    expect(pickLanguage(['fr-FR', 'sn-ZW', 'en'])).toBe('sn');
    expect(pickLanguage(['nr'])).toBe('nd');
    expect(pickLanguage(['de'])).toBe('en');
  });
});
