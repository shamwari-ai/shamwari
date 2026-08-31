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
  it('routes cloud-safe scopes to cloud on both capabilities', () => {
    for (const scope of ['community', 'platform'] as Scope[]) {
      expect(decideDestination(scope, env('false'))).toEqual({ scope, destination: 'cloud' });
      expect(decideDestination(scope, env('true'), 'retrieval_only')).toEqual({
        scope,
        destination: 'cloud',
      });
    }
  });

  it('never routes personal scope to cloud', () => {
    expect(() => decideDestination('personal', env('false'))).toThrow(ScopeRefusal);
    expect(() => decideDestination('personal', env('true'))).toThrow(ScopeRefusal);
  });

  // THE REGRESSION. MIND_AVAILABLE=true used to return destination 'mind'
  // from the completion endpoint's gate, and neither ground() nor infer()
  // looked at the destination — so the flag flipped a config value into a
  // leak of both the embedding and the prompt. Mind runs on the device;
  // there is no value of a Worker variable that makes a Cloud completion of
  // a personal-scope prompt permissible.
  it('does not let MIND_AVAILABLE unlock cloud inference for personal scope', () => {
    for (const flag of ['true', 'false', 'True', '1', '']) {
      expect(() => decideDestination('personal', env(flag), 'cloud_inference')).toThrow(
        ScopeRefusal,
      );
    }
  });

  it('lets Mind retrieve context, which reaches no provider', () => {
    expect(decideDestination('personal', env('true'), 'retrieval_only')).toEqual({
      scope: 'personal',
      destination: 'mind',
    });
  });

  it('refuses rather than downgrading when Mind is unavailable', () => {
    try {
      decideDestination('personal', env('false'), 'retrieval_only');
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

  it('says which capability refused, so the caller knows where to go next', () => {
    const cloud = (() => {
      try {
        decideDestination('personal', env('true'), 'cloud_inference');
      } catch (e) {
        return (e as ScopeRefusal).toPayload();
      }
      return null;
    })();
    expect(cloud?.capability).toBe('cloud_inference');
    expect(cloud?.message).toContain('/v1/ground/context');
  });

  it('treats only the exact string "true" as Mind being available', () => {
    for (const flag of ['True', 'TRUE', '1', 'yes', '']) {
      expect(() => decideDestination('personal', env(flag), 'retrieval_only')).toThrow(
        ScopeRefusal,
      );
    }
  });
});
