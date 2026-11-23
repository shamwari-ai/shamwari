import { describe, expect, it } from 'vitest';
import { LANGUAGES, en, loadStrings, pickLanguage } from '../../src/chat/strings';
import { nd } from '../../src/chat/strings-nd';
import { sn } from '../../src/chat/strings-sn';

const keys = (o: object, p = ''): string[] =>
  Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' ? keys(v, `${p}${k}.`) : [`${p}${k}`]));

describe('strings', () => {
  it('has every English key in Shona and Ndebele, and no extras', () => {
    expect(keys(sn).sort()).toEqual(keys(en).sort());
    expect(keys(nd).sort()).toEqual(keys(en).sort());
  });

  it('loads Shona and Ndebele on demand: English until then, the real words after', async () => {
    expect(LANGUAGES.en.strings).toBe(en);
    expect(await loadStrings('sn')).toBe(sn);
    expect(await loadStrings('nd')).toBe(nd);
    expect(LANGUAGES.sn.strings).toBe(sn);
    expect(LANGUAGES.nd.strings).toBe(nd);
    expect(await loadStrings('en')).toBe(en);
  });

  it('marks Shona and Ndebele as needing native review, and English as not', () => {
    expect(LANGUAGES.sn.needsNativeReview).toBe(true);
    expect(LANGUAGES.nd.needsNativeReview).toBe(true);
    expect(LANGUAGES.en.needsNativeReview).toBe(false);
  });

  it('keeps the product names untranslated', () => {
    for (const s of [en, sn, nd]) {
      expect(s.shamwari).toBe('Shamwari');
      expect(s.ground).not.toBe('Ground'); // plain words, not jargon (#244 row 5)
      expect(s.scopeLabel).not.toMatch(/asking about|mubvunzo wekuti|ngokuthi/i);
    }
  });

  it('never claims verification, sovereignty or residency for Cloud', () => {
    const all = JSON.stringify([en, sn, nd]);
    expect(all).not.toMatch(/stays in africa|sovereign|ubuntu ai|open source model/i);
  });

  it('leads with agriculture, weather, news and places, and never calls Shamwari a legal or government tool (#267)', () => {
    for (const s of [en, sn, nd]) {
      for (const text of [s.tagline, s.example1, s.example2, s.example3, s.footer]) {
        expect(text).not.toMatch(/constitution|legal|bumbiro|mutemo|simiso|mthetho|law\b/i);
      }
    }
    expect(en.tagline).toMatch(/farming/i);
    expect(en.example1).toMatch(/plant|rain/i); // agriculture first
    expect(en.example2).toMatch(/price|news|weather/i);
    expect(en.example3).toMatch(/where|nearest/i); // a place
  });

  it('picks the first supported browser language', () => {
    expect(pickLanguage(['fr-FR', 'sn-ZW', 'en'])).toBe('sn');
    expect(pickLanguage(['nr'])).toBe('nd');
    expect(pickLanguage(['de'])).toBe('en');
  });
});
