import { describe, expect, it } from 'vitest';
import { plainText } from '../../src/chat/render';

describe('plainText: an answer is shown without markdown marks', () => {
  it('keeps the words and drops the marks', () => {
    expect(plainText('## Your rights\n\n**Section 49** says _personal liberty_ and `section 50`.')).toBe('Your rights\n\nSection 49 says personal liberty and section 50.');
  });
  it('turns links into their text, and a bare link into its address', () => {
    expect(plainText('See [the Constitution](https://www.parlzim.gov.zw/) now.')).toBe('See the Constitution (https://www.parlzim.gov.zw/) now.'); // the address is the pointer to the source
    expect(plainText('[https://x.org](https://x.org)')).toBe('https://x.org');
    expect(plainText('[](https://example.org/x)')).toBe('https://example.org/x');
  });
  it('makes list items plain dashes and keeps their lines', () => {
    expect(plainText('* one\n+ two\n- three')).toBe('- one\n- two\n- three');
  });
  it('drops quotes, rules, strikethrough and code fences but keeps what is inside', () => {
    expect(plainText('> Keep calm.\n\n---\n\n~~old~~ new\n\n```\nlet x = 1\n```')).toBe('Keep calm.\n\nold new\n\nlet x = 1');
  });
  it('leaves ordinary text alone: sentences, numbers, underscores in words, single asterisks that are not emphasis', () => {
    expect(plainText('Section 56 (1) applies. snake_case_word and 2 * 3 = 6.')).toBe('Section 56 (1) applies. snake_case_word and 2 * 3 = 6.');
  });
  it('keeps the blank line before a list and after a quote (paragraphs stay paragraphs)', () => {
    expect(plainText('Intro.\n\n* one\n* two\n\n> Keep calm.')).toBe('Intro.\n\n- one\n- two\n\nKeep calm.');
  });
  it('leaves marks inside a word alone (ref__2024__A, snake_case), and turns a table into plain lines', () => {
    expect(plainText('the file ref__2024__A and snake_case_word')).toBe('the file ref__2024__A and snake_case_word');
    expect(plainText('| Right | Section |\n|---|---|\n| Liberty | 49 |')).toBe('Right · Section\n\nLiberty · 49');
  });
  it('collapses long runs of blank lines', () => {
    expect(plainText('a\n\n\n\n\nb')).toBe('a\n\nb');
  });
});
