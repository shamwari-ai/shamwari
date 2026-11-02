import { BUDGET, byteLength } from './budget';
import type { ChatRequest } from './types';

/**
 * Offline queue (docs/tiered-access-design.md, rung 5). Two rules:
 *
 * - Rule 1: a personal-scope ask is NEVER stored. A stored ask is delivered to
 *   Cloud later, so queueing it would send personal data to a provider.
 *   `enqueue` refuses it; the caller shows the local-inference explanation.
 * - One idempotency key per message, kept across retries, so a retry after a
 *   dropped link is replayed by the gateway instead of metered twice.
 */
export interface QueuedAsk {
  id: string; // also the Idempotency-Key
  question: string;
  createdAt: number;
}

export type EnqueueResult =
  | { ok: true; queue: QueuedAsk[] }
  | { ok: false; reason: 'personal_scope' | 'queue_full' | 'too_long' };

const size = (q: QueuedAsk[]) => q.reduce((n, a) => n + byteLength(a.question), 0);

export function enqueue(
  queue: QueuedAsk[],
  ask: QueuedAsk,
  scope: ChatRequest['scope'] = 'platform',
): EnqueueResult {
  if (scope === 'personal') return { ok: false, reason: 'personal_scope' };
  const bytes = byteLength(ask.question);
  if (bytes > BUDGET.maxQuestionBytes) return { ok: false, reason: 'too_long' };
  if (size(queue) + bytes > BUDGET.maxQueueBytes) return { ok: false, reason: 'queue_full' };
  return { ok: true, queue: [...queue, ask] };
}

export const dequeue = (queue: QueuedAsk[], id: string): QueuedAsk[] =>
  queue.filter((a) => a.id !== id);

/** Parse persisted JSON defensively; a corrupt store must not crash startup. */
export function parseQueue(raw: string | null): QueuedAsk[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.filter(
      (a): a is QueuedAsk =>
        !!a && typeof a.id === 'string' && typeof a.question === 'string' && typeof a.createdAt === 'number',
    );
  } catch {
    return [];
  }
}
