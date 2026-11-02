import type { RefreshResult } from './session';

/**
 * Serialises refreshes for ONE session. WorkOS refresh tokens are single-use, so two
 * tabs renewing at the same moment would otherwise spend the same token twice and
 * one of them would be told the session is over. The first caller refreshes; a
 * second caller holding the SAME cookie gets the first caller's result instead of
 * making a second call.
 *
 * Instances live inside a Durable Object keyed by session id (refresh-do.ts), so
 * "one at a time" holds across isolates and regions, not just inside one.
 */
export interface CoordinatorSnapshot {
  from: string;
  at: number;
  result: RefreshResult;
}

export class RefreshCoordinator {
  private tail: Promise<unknown> = Promise.resolve();
  private last: CoordinatorSnapshot | null = null;

  constructor(
    private readonly now: () => number = Date.now,
    /** How long a finished refresh answers a second caller still holding the old cookie. */
    private readonly reuseMs = 30_000,
  ) {}

  /** What a restarted coordinator needs to answer a second caller that still holds the old cookie. */
  snapshot(): CoordinatorSnapshot | null {
    return this.last ? { from: this.last.from, at: this.last.at, result: this.last.result } : null;
  }
  restore(s: CoordinatorSnapshot | null | undefined): void {
    if (s && !this.last) this.last = s;
  }

  /** `key` identifies the cookie being refreshed (a hash of it in production, never the cookie itself at rest). */
  run(key: string, refresh: () => Promise<RefreshResult>): Promise<RefreshResult> {
    const next = this.tail.then(async () => {
      const l = this.last;
      if (l && l.from === key && l.result.status === 'ok' && this.now() - l.at < this.reuseMs) return l.result;
      const result = await refresh();
      // Only a success is reused. A retryable failure must be retried, and a denial is final anyway.
      this.last = { from: key, at: this.now(), result };
      return result;
    });
    this.tail = next.catch(() => undefined);
    return next;
  }
}
