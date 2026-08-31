import type { Env, Scope } from './types';

/**
 * THE LOAD-BEARING RULE
 *
 * Personal-layer content never reaches a third-party inference provider.
 * Not Kimi, not Qwen, not Claude. That is what makes "sovereign AI
 * companion" a technical fact rather than a marketing line.
 *
 * Enforced twice on purpose. Here, so the request fails fast without
 * burning a Core round trip. And again in Core's resolve_scope, which is
 * authoritative and which the Worker cannot override. Defence in depth,
 * because a single check is a single bug away from a leak.
 */
const CLOUD_SAFE: ReadonlySet<Scope> = new Set<Scope>(['community', 'platform']);

export function parseScope(raw: unknown): Scope {
  return raw === 'personal' || raw === 'community' ? raw : 'platform';
}

export interface ScopeDecision {
  scope: Scope;
  destination: 'cloud' | 'mind';
}

export function decideDestination(scope: Scope, env: Env): ScopeDecision {
  if (CLOUD_SAFE.has(scope)) return { scope, destination: 'cloud' };
  if (env.MIND_AVAILABLE === 'true') return { scope, destination: 'mind' };

  // Refuse rather than silently downgrade to platform scope. A downgrade
  // would answer confidently while withholding the user's own data, with
  // no signal that anything was missing — worse than an error.
  throw new ScopeRefusal(scope);
}

export class ScopeRefusal extends Error {
  constructor(readonly scope: Scope) {
    super('scope_requires_local_inference');
  }

  toPayload() {
    return {
      error: 'scope_requires_local_inference',
      scope: this.scope,
      message:
        'Personal-layer data cannot be sent to an external inference provider. ' +
        'Shamwari Mind is required for this request and is not yet deployed on ' +
        'this surface.',
      docs: 'https://platform.shamwari.ai/docs/scopes',
    };
  }
}
