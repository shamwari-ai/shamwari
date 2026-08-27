// Rule 1 of CLAUDE.md, as an executable check. The scope gate is described
// there as "a single bug away from a leak" — this is the regression net
// under that claim.
import { describe, expect, it } from 'vitest';
import { decideDestination, parseScope, ScopeRefusal } from '../src/scope';
import type { Env, Scope } from '../src/types';

const env = (mindAvailable: string) => ({ MIND_AVAILABLE: mindAvailable }) as unknown as Env;

describe('parseScope', () => {
  it('accepts the two explicit scopes', () => {
    expect(parseScope('personal')).toBe('personal');
    expect(parseScope('community')).toBe('community');
  });

  it('defaults anything else to platform', () => {
    for (const raw of [undefined, null, '', 'PERSONAL', 'nonsense', 42, {}]) {
      expect(parseScope(raw)).toBe('platform');
    }
  });
});

describe('decideDestination', () => {
  it('routes cloud-safe scopes to cloud', () => {
    for (const scope of ['community', 'platform'] as Scope[]) {
      expect(decideDestination(scope, env('false'))).toEqual({ scope, destination: 'cloud' });
    }
  });

  it('never routes personal scope to cloud', () => {
    expect(() => decideDestination('personal', env('false'))).toThrow(ScopeRefusal);
    expect(decideDestination('personal', env('true')).destination).toBe('mind');
  });

  it('refuses rather than downgrading when Mind is unavailable', () => {
    try {
      decideDestination('personal', env('false'));
      expect.unreachable('expected a ScopeRefusal');
    } catch (e) {
      expect(e).toBeInstanceOf(ScopeRefusal);
      const payload = (e as ScopeRefusal).toPayload();
      expect(payload.error).toBe('scope_requires_local_inference');
      // The refusal reports the scope the caller asked for, not a silently
      // substituted one — a downgrade is the failure mode being guarded.
      expect(payload.scope).toBe('personal');
    }
  });

  it('treats only the exact string "true" as Mind being available', () => {
    for (const flag of ['True', 'TRUE', '1', 'yes', '']) {
      expect(() => decideDestination('personal', env(flag))).toThrow(ScopeRefusal);
    }
  });
});
