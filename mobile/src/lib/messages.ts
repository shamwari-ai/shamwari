import type { AskErrorKind } from './types';

/**
 * Wording for a failure, in the person's language. The 409 is the product
 * working, not breaking, so it gets the full explanation, not a generic error.
 */
export function errorMessage(
  str: { scopePersonalTitle: string; scopePersonalBody: string; errors: Record<string, string> },
  kind: AskErrorKind,
): string {
  if (kind === 'scope_requires_local_inference') return `${str.scopePersonalTitle}. ${str.scopePersonalBody}`;
  return str.errors[kind] ?? str.errors.unknown ?? '';
}

/** Failures that need the person to act (key, plan). The ask stays queued; nothing is discarded. */
export const needsPerson = (k: AskErrorKind): boolean => k === 'unauthorized' || k === 'payment_required' || k === 'forbidden_scope';

/** Failures where the ask should wait in the queue rather than be dropped. */
export const retryable = (k: AskErrorKind): boolean => k === 'offline' || k === 'unavailable' || k === 'busy' || k === 'rate_limited';
