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

/** Everything the app can tell the person besides an answer. Stored as a key, rendered in the current language. */
export type MsgKey = AskErrorKind | 'tooLong' | 'queueFull' | 'readFailed' | 'saveKeyFailed' | 'saveQueueFailed';

type Wording = Parameters<typeof errorMessage>[0] & {
  tooLong: string; queueFull: string; readFailed: string; saveKeyFailed: string; saveQueueFailed: string; savedRetry: string;
};

/** Text for a message in the given language. Transient failures also say the question is saved, so nobody resubmits it. */
export function msgText(str: Wording, key: MsgKey): string {
  switch (key) {
    case 'tooLong': return str.tooLong;
    case 'queueFull': return str.queueFull;
    case 'readFailed': return str.readFailed;
    case 'saveKeyFailed': return str.saveKeyFailed;
    case 'saveQueueFailed': return str.saveQueueFailed;
    default: return retryable(key) ? `${errorMessage(str, key)} ${str.savedRetry}` : errorMessage(str, key);
  }
}

/** Failures that need the person to act (key, plan). The ask stays queued; nothing is discarded. */
export const needsPerson = (k: AskErrorKind): boolean => k === 'unauthorized' || k === 'payment_required' || k === 'forbidden_scope';

/** Failures where the ask should wait in the queue rather than be dropped. */
export const retryable = (k: AskErrorKind): boolean => k === 'offline' || k === 'unavailable' || k === 'busy' || k === 'rate_limited';
