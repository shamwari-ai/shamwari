/**
 * "Is the person in the middle of something?" A new release reloads the page; it must never do that while a question
 * is on its way or an answer is arriving, or while a draft sits in the question box. Each reason sets and clears its
 * own flag; whoever wants to reload asks `whenIdle`, which runs now if nothing is busy and otherwise once the last
 * reason clears.
 */
const reasons = new Set<string>();
let waiting: Array<() => void> = [];

export const isBusy = (): boolean => reasons.size > 0;

export function setBusy(reason: string, on: boolean): void {
  if (on) reasons.add(reason);
  else reasons.delete(reason);
  if (reasons.size === 0 && waiting.length) {
    const run = waiting;
    waiting = [];
    for (const fn of run) fn();
  }
}

export function whenIdle(fn: () => void): void {
  if (isBusy()) waiting.push(fn);
  else fn();
}

/** For tests: forget every reason and every waiter. */
export function resetBusy(): void {
  reasons.clear();
  waiting = [];
}
