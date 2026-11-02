import { BUDGET, byteLength, clampBytes } from '../lib/budget';
import { needsPerson, retryable, type MsgKey } from '../lib/messages';
import { dequeue, enqueue, type QueuedAsk } from '../lib/queue';
import type { Answer, ChatRequest, Result } from '../lib/types';
import type { AskOptions } from '../lib/client';
import type { SignInResult } from '../auth/session';

/**
 * Everything the chat screen DECIDES, with none of what it draws.
 *
 * It lives here, not in App.tsx, so it can be driven by tests the way the screen drives it: the queue,
 * the retry backoff, holding questions when the person must act, and the wipe-first sign-out are the
 * parts that hurt people when they are wrong, and a phone is the wrong place to find that out.
 * Every outside thing (network, keystore, timers, ids) is a port, so a test supplies fakes.
 */
export type Item =
  | { kind: 'q'; id: string; text: string; pending: boolean }
  | { kind: 'a'; id: string; answer: Answer }
  | { kind: 'note'; id: string; msg: MsgKey };

export interface ChatState {
  items: Item[];
  /** Questions still waiting to be sent (kept in order). */
  queue: QueuedAsk[];
  status: MsgKey | null;
  signedIn: boolean;
  /** A pasted developer key exists. The key itself is deliberately NOT in view state. */
  hasKey: boolean;
  showSettings: boolean;
}

export interface ChatPorts {
  ask(req: ChatRequest, opts: AskOptions): Promise<Result<Answer>>;
  session: {
    isSignedIn(): Promise<boolean>;
    signIn(): Promise<SignInResult>;
    signOut(): Promise<void>;
  };
  store: {
    loadKey(): Promise<string | null>;
    saveKey(key: string): Promise<void>;
    loadQueue(): Promise<QueuedAsk[]>;
    saveQueue(q: QueuedAsk[]): Promise<void>;
  };
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  newId(): string;
  now(): number;
}

/**
 * Mark a question as no longer waiting and put its reply (an answer, or a note saying why there is none)
 * directly UNDER it. Replies used to be appended at the end, so with two questions typed close together
 * an answer could appear below the wrong question.
 */
export function settle(items: Item[], askId: string, reply: Item): Item[] {
  const out: Item[] = []; // one pass, one allocation: the thread only grows during a session
  let placed = false;
  for (const i of items) {
    if (i.kind === 'q' && i.id === askId) {
      out.push({ ...i, pending: false }, reply);
      placed = true;
    } else out.push(i);
  }
  // Defensive: no path reaches this today (sign-out and dispose drop the reply before it gets here), but if
  // the question were ever missing, showing the reply at the end beats losing it. Pinned by a test.
  return placed ? out : [...items, reply];
}

const RETRY_BASE_MS = 10_000;
const RETRY_MAX_MS = 300_000;

export class ChatController {
  private state: ChatState = { items: [], queue: [], status: null, signedIn: false, hasKey: false, showSettings: false };
  private listeners = new Set<() => void>();
  /** The pasted developer key. Held here and in the keystore only, never in view state. */
  private key: string | null = null;
  private timer: unknown = null;
  private attempts = 0;
  private busy = false;
  /** Bumped by sign-out. A send already in flight sees the change and discards its answer. */
  private generation = 0;
  private started = false;
  private disposed = false;

  constructor(private readonly p: ChatPorts) {}

  // ---- view plumbing -------------------------------------------------------------------------
  getState = (): ChatState => this.state;
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };
  /** The fallback credential, read at request time by the HTTP client. */
  devKey = (): string | null => this.key;
  /**
   * Stop everything this controller has in motion. Safe to call and then start() again: React runs
   * effect cleanup and setup back to back in development, and a disposed controller must come back.
   */
  dispose(): void {
    this.disposed = true;
    this.generation++; // work in flight belongs to the old run: its answers are dropped and it arms nothing
    this.clearRetry();
    this.listeners.clear();
    this.started = false;
  }

  private set(patch: Partial<ChatState>): void {
    const keys = Object.keys(patch) as (keyof ChatState)[];
    // A patch that changes nothing must not re-render the screen (a low-end phone redraws the whole list).
    if (keys.every((k) => Object.is(this.state[k], patch[k]))) return;
    this.state = { ...this.state, ...patch };
    for (const l of [...this.listeners]) l();
  }
  private setItems(f: (items: Item[]) => Item[]): void {
    this.set({ items: f(this.state.items) });
  }
  private clearRetry(): void {
    if (this.timer !== null) this.p.clearTimer(this.timer);
    this.timer = null;
  }
  /** The queue's single source of truth: flush() runs across awaits and must never write back a stale snapshot. */
  private persist(q: QueuedAsk[]): void {
    this.set({ queue: q });
    this.p.store.saveQueue(q).catch(() => this.set({ status: 'saveQueueFailed' }));
  }

  // ---- lifecycle -----------------------------------------------------------------------------
  async start(): Promise<void> {
    if (this.started) return; // two start() calls at once are one
    this.started = true;
    this.disposed = false;
    const gen = this.generation;
    try {
      const [k, q] = await Promise.all([this.p.store.loadKey(), this.p.store.loadQueue()]);
      // Signed out (or disposed) while the stores were being read: what was just loaded is exactly what
      // sign-out wiped. Restoring it would bring the last person's key and questions back.
      if (gen !== this.generation) return;
      this.key = k;
      this.set({ hasKey: k !== null });
      this.persist(q);
      this.set({ items: q.map((a): Item => ({ kind: 'q', id: a.id, text: a.question, pending: true })) });
      // A keystore error here must not stop the saved key and queue from loading.
      const signed = await this.p.session.isSignedIn().catch(() => false);
      if (gen !== this.generation) return;
      this.set({ signedIn: signed });
      if (!k && !signed) this.set({ showSettings: true });
      else if (q.length) void this.flush();
    } catch {
      // Secure storage can fail (locked keystore, restore from backup). Start empty, let the person re-enter a key.
      if (gen === this.generation) this.set({ status: 'readFailed', showSettings: true });
    }
  }

  /** Back in the foreground is the nearest thing to "network returned" without a native module. */
  foreground(): void {
    void this.flush();
  }

  setShowSettings(v: boolean): void {
    this.set({ showSettings: v });
  }

  // ---- asking --------------------------------------------------------------------------------
  /** true when the question was accepted (the view then clears its text box). */
  send(raw: string): boolean {
    const q = raw.trim();
    if (!q) return false;
    // Never cut a question short silently: a cut Shona sentence is a different question.
    if (byteLength(q) > BUDGET.maxQuestionBytes) {
      this.set({ status: 'tooLong' });
      return false;
    }
    this.set({ status: null });
    const ask: QueuedAsk = { id: this.p.newId(), question: q, createdAt: this.p.now() };
    // Scope is always 'platform': the app has no on-device Mind yet, and a personal-scope ask must
    // never be queued (queue.ts refuses it).
    const r = enqueue(this.state.queue, ask, 'platform');
    if (!r.ok) {
      // Refused before it was ever queued, so there is no question on screen to sit under: the one place a
      // note legitimately goes at the end. (Everything that does have a question goes through settle().)
      this.setItems((p) => [...p, { kind: 'note', id: ask.id + ':e', msg: r.reason === 'queue_full' ? 'queueFull' : 'tooLong' }]);
      return false;
    }
    this.setItems((p) => [...p, { kind: 'q', id: ask.id, text: q, pending: true }]);
    this.persist(r.queue);
    void this.flush();
    return true;
  }

  async flush(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const gen = this.generation;
    try {
      // Re-read the queue each round so a question typed mid-flush is sent too, and is never overwritten.
      for (;;) {
        const ask = this.state.queue[0];
        if (!ask) break;
        // Same id every retry: the gateway replays instead of metering twice.
        const r = await this.p.ask({ messages: [{ role: 'user', content: ask.question }], scope: 'platform' }, { idempotencyKey: ask.id });
        // Signed out while this was in flight: the answer belongs to the person who left. Drop it.
        if (gen !== this.generation) break;
        if (r.ok) {
          const text = clampBytes(r.value.text, BUDGET.maxAnswerBytes);
          this.attempts = 0;
          this.set({ status: null });
          this.persist(dequeue(this.state.queue, ask.id));
          this.setItems((p) =>
            settle(p, ask.id, { kind: 'a', id: ask.id + ':a', answer: { ...r.value, text: text.text, truncated: r.value.truncated || text.clipped } }),
          );
        } else if (retryable(r.error.kind)) {
          // Keep everything queued, in order, say why, and try again on a backoff (or the server's
          // Retry-After) instead of waiting for the app to be reopened.
          this.set({ status: r.error.kind });
          const wait = Math.max((r.error.retryAfterSec ?? 0) * 1000, Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** this.attempts++));
          this.clearRetry();
          this.timer = this.p.setTimer(() => {
            this.timer = null;
            void this.flush();
          }, wait);
          break;
        } else if (needsPerson(r.error.kind)) {
          // A bad key or a used-up plan is not the question's fault: keep every saved question, say
          // what to do, and resume when the person has done it.
          this.set({ status: r.error.kind });
          // The session may have just ended (a terminal refusal): make the screen say so.
          this.p.session.isSignedIn().then((s) => void (gen === this.generation && this.set({ signedIn: s })), () => undefined);
          if (r.error.kind === 'unauthorized') this.set({ showSettings: true });
          break;
        } else {
          // A question the service cannot answer is dropped: tell the person, and stop calling it "waiting".
          this.persist(dequeue(this.state.queue, ask.id));
          this.setItems((p) => settle(p, ask.id, { kind: 'note', id: ask.id + ':e', msg: r.error.kind }));
        }
      }
    } finally {
      this.busy = false;
      // Signed out mid-request, and someone has already asked something new: the old loop could not
      // send it (it was busy), so start again now rather than leave it waiting for the next nudge.
      if (gen !== this.generation && !this.disposed && this.state.queue.length > 0) void this.flush();
    }
  }

  // ---- credentials ---------------------------------------------------------------------------
  async signIn(): Promise<void> {
    this.set({ status: null });
    const gen = this.generation;
    const r = await this.p.session.signIn(); // never throws: a keystore or browser fault is 'failed'
    // Signed out while the browser was open: that sign-in is superseded and must not mark the phone signed in.
    if (gen !== this.generation) return;
    if (r === 'signed_in') {
      this.set({ signedIn: true, showSettings: false });
      void this.flush();
    } else if (r === 'failed') this.set({ status: 'signInFailed' });
  }

  async signOut(): Promise<void> {
    // Wipe this phone's copy of the person FIRST, before the browser opens: if the app is killed or the
    // browser hangs, the next person must still find nothing of theirs and nothing able to send as them.
    this.generation++;
    this.clearRetry();
    this.attempts = 0;
    this.key = null;
    this.set({ queue: [], items: [], hasKey: false, signedIn: false, status: 'signedOut' });
    // The screen is clear. Now make the STORAGE match, and say so if it does not: a locked or flaky
    // keystore must never leave the last person's key or questions behind while the screen says they are gone.
    // (Called directly, not through persist(), so a failure here cannot overwrite this message.)
    const wipe = () => Promise.allSettled([this.p.store.saveKey(''), this.p.store.saveQueue([])]);
    let results = await wipe();
    if (results.some((r) => r.status === 'rejected')) results = await wipe(); // one more try
    if (results.some((r) => r.status === 'rejected')) this.set({ status: 'wipeFailed' });
    await this.p.session.signOut().catch(() => undefined);
  }

  /** Save a pasted developer key. An empty box only closes Settings: it must never delete a saved key. */
  saveDevKey(raw: string): void {
    const k = raw.trim();
    this.set({ showSettings: false });
    if (!k) return;
    this.key = k;
    this.set({ hasKey: true, status: null });
    void this.p.store.saveKey(k).catch(() => this.set({ status: 'saveKeyFailed' }));
    void this.flush();
  }

  removeDevKey(): void {
    this.key = null;
    this.set({ hasKey: false });
    void this.p.store.saveKey('').catch(() => undefined);
  }
}
