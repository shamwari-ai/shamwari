// The extractive rung answers from Ground alone. The property that matters is
// that nothing in the answer is written by the gateway beyond a fixed label:
// every word is a field of a chunk Ground returned, so it cannot invent a
// citation, a section number or a rate.
import { describe, expect, it } from 'vitest';
import { extractiveAnswer, EXTRACTIVE_MAX_CHARS } from '../src/extractive';
import type { GroundChunk } from '../src/types';

const chunk = (over: Partial<GroundChunk> = {}): GroundChunk => ({
  content: 'Every person has the right to life.',
  heading: 'Section 48 — Right to life',
  title: 'Constitution of Zimbabwe Amendment (No. 20) Act 2013',
  authority: 'Parliament of Zimbabwe',
  resource_type: 'legislation',
  source_url: 'https://example.invalid/constitution',
  effective_from: '2013-05-22',
  scope: 'platform',
  ...over,
});

describe('extractiveAnswer', () => {
  it('returns nothing when Ground returned nothing, rather than an answer with no source', () => {
    expect(extractiveAnswer([])).toBeNull();
  });

  it('is the passage plus its citation, built from the chunk and nothing else', () => {
    const a = extractiveAnswer([chunk()]);
    expect(a?.text).toBe(
      'Every person has the right to life.\n' +
        'Source: Constitution of Zimbabwe Amendment (No. 20) Act 2013 — Section 48 — Right to life ' +
        '(Parliament of Zimbabwe), effective 2013-05-22',
    );
    expect(a?.used).toHaveLength(1);
  });

  it('never states a section, rate or date that is not in the chunk', () => {
    const bare = chunk({ title: 'Income Tax Act', heading: null, authority: '', effective_from: null });
    const text = extractiveAnswer([bare])?.text ?? '';
    expect(text).not.toMatch(/Section|effective|\(/);
    expect(text).toContain(bare.title);
  });

  it('keeps the first chunk and its citation even when it must be clipped', () => {
    const long = chunk({ content: 'word '.repeat(2000) });
    const a = extractiveAnswer([long]);
    expect(a?.text.length).toBeLessThanOrEqual(EXTRACTIVE_MAX_CHARS);
    expect(a?.text).toContain('Source: ');
    expect(a?.text).toContain('…');
  });

  it('clips on a word boundary, never mid-word', () => {
    const a = extractiveAnswer([chunk({ content: 'alpha beta gamma delta '.repeat(100) })], 120);
    const body = a?.text.split('\n')[0] ?? '';
    expect(body.endsWith('…')).toBe(true);
    expect(body.slice(0, -1).split(' ').pop()).toMatch(/^(alpha|beta|gamma|delta)$/);
  });

  it('adds a further chunk only while it fits, and reports which it used', () => {
    const a = extractiveAnswer(
      [chunk(), chunk({ content: 'Second.' }), chunk({ content: 'Third.' })],
      10_000,
    );
    expect(a?.used).toHaveLength(3);
    const tight = extractiveAnswer([chunk(), chunk({ content: 'Second.' })], 230);
    expect(tight?.used).toHaveLength(1);
    expect(tight?.text).not.toContain('Second.');
  });
});
