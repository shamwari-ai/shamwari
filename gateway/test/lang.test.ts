import { describe, expect, it } from 'vitest';
import { detectLanguage } from '../src/lang';

describe('detectLanguage', () => {
  it('tags single languages', () => {
    expect(detectLanguage('Mhoro, ndinoda rubatsiro')).toBe('sn');
    expect(detectLanguage('Sawubona, ngicela usizo')).toBe('nd');
    expect(detectLanguage('What is the tax rate')).toBe('en');
  });

  it('tags code-switched input, which is the common case', () => {
    expect(detectLanguage('What is the mutero rate?')).toBe('sn-en');
    expect(detectLanguage('How much imali do I need?')).toBe('nd-en');
  });

  it('returns null when nothing matches rather than guessing', () => {
    expect(detectLanguage('zzz 12345')).toBeNull();
    expect(detectLanguage('')).toBeNull();
  });
});
