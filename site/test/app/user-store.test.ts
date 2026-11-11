import { describe, expect, it } from 'vitest';
import { memoryStore } from '../../src/chat/store';
import { subjectOf, userKeyOf } from '../../src/chat/user';

const jwtWith = (claims: object) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;

describe('who a token names', () => {
  it('reads sub, and only sub, and is null for anything else', () => {
    expect(subjectOf(jwtWith({ sub: 'user_01ABC', email: 'a@b.c' }))).toBe('user_01ABC');
    expect(subjectOf(jwtWith({ email: 'a@b.c' }))).toBeNull();
    expect(subjectOf(jwtWith({ sub: '' }))).toBeNull();
    expect(subjectOf('not-a-jwt')).toBeNull();
    expect(subjectOf('a.%%%.c')).toBeNull();
    expect(subjectOf(null)).toBeNull();
    expect(subjectOf(undefined)).toBeNull();
  });
});

describe('the name of a person\'s store', () => {
  it('is 24 hex characters, stable for a person, different between people, and does not contain the sub', async () => {
    const a = await userKeyOf('user_01ABC');
    expect(a).toMatch(/^[0-9a-f]{24}$/);
    expect(await userKeyOf('user_01ABC')).toBe(a);
    expect(await userKeyOf('user_01ABD')).not.toBe(a);
    expect(a).not.toContain('01ABC');
  });
});

describe('the in-memory store used when IndexedDB is unavailable', () => {
  it('keeps what was put in and forgets it on clear', async () => {
    const s = memoryStore();
    await s.put({ id: 't1', title: 'x', updatedAt: 1, messages: [] });
    expect((await s.list()).map((t) => t.id)).toEqual(['t1']);
    await s.clear();
    expect(await s.list()).toEqual([]);
  });
});
