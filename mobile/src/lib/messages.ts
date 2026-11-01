import type { AskErrorKind } from './types';

/** Plain, kind wording per failure. The 409 is the product working, not breaking. */
export const errorText: Record<AskErrorKind, string> = {
  scope_requires_local_inference:
    'This question is about your own data. That never leaves your phone, so I cannot answer it in the cloud. Personal answers arrive with Shamwari Mind on your device.',
  unauthorized: 'Add your Shamwari key in Settings to ask questions.',
  payment_required: 'Your plan is used up for now.',
  forbidden_scope: 'This key cannot ask that kind of question.',
  rate_limited: 'Lots of questions right now. Try again in a moment.',
  unavailable: 'Shamwari is having trouble. Your question is saved and will be sent again.',
  busy: 'Still answering that one. One moment.',
  offline: 'No connection. Your question is saved and will be sent when you are back online.',
  bad_request: 'That question could not be sent. Try rephrasing it.',
  unknown: 'Something went wrong. Please try again.',
};

/** Failures where the ask should wait in the queue rather than be dropped. */
export const retryable = (k: AskErrorKind): boolean => k === 'offline' || k === 'unavailable' || k === 'busy' || k === 'rate_limited';
