import { describe, expect, it } from 'vitest';
import { ChatController, type ChatPorts, type ChatState } from '../src/chat/controller';
import { BUDGET } from '../src/lib/budget';
import type { QueuedAsk } from '../src/lib/queue';
import type { Answer, AskErrorKind, ChatRequest, Result } from '../src/lib/types';
import type { SignInResult } from '../src/auth/session';

const answer = (text: string, over: Partial<Answer> = {}): Result<Answer> => ({
  ok: true,
  value: { id: 'r', text, scope: 'platform', language: null, grounded: true, truncated: false, inferencePath: 'gateway', degraded: false, modelServed: null, citations: [], ...over },
});
const fail = (kind: AskErrorKind, retryAfterSec: number | null = null): Result<Answer> => ({
  ok: false,
  error: { kind, status: null, retryAfterSec, upgradeUrl: null },
});
const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};
/** Let queued promise work finish. The controller's own timers are fake, so this never waits on them. */
const idle = async () => {
  for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0));
};

function make(init: { key?: string | null; queue?: QueuedAsk[]; signedIn?: boolean } = {}) {
  const asks: { req: ChatRequest; key: string | undefined }[] = [];
  let askImpl: (n: number) => Promise<Result<Answer>> | Result<Answer> = () => answer('hi');
  let inFlight = 0;
  let maxInFlight = 0;
  const store = { key: init.key ?? null, queue: init.queue ?? [] };
  const savedQueues: string[][] = [];
  const savedKeys: string[] = [];
  const timers: { fn: () => void; ms: number; cleared: boolean }[] = [];
  const sessionState = { signedIn: init.signedIn ?? false, signOutCalls: 0, signInResult: 'signed_in' as SignInResult, isSignedInThrows: false };
  let signOutGate: Promise<void> | null = null;
  let ids = 0;
  const gates: Partial<Record<'loadKey' | 'signIn' | 'isSignedIn', Promise<void>>> = {};
  const failing = { saveKey: 0, saveQueue: 0 };
  const ports: ChatPorts = {
    ask: async (req, opts) => {
      asks.push({ req, key: opts.idempotencyKey });
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        return await askImpl(asks.length);
      } finally {
        inFlight--;
      }
    },
    session: {
      isSignedIn: async () => {
        if (sessionState.isSignedInThrows) throw new Error('keystore locked');
        const v = sessionState.signedIn; // the answer is read now and delivered after the gate, like a slow keystore
        if (gates.isSignedIn) await gates.isSignedIn;
        return v;
      },
      signIn: async () => {
        if (gates.signIn) await gates.signIn;
        if (sessionState.signInResult === 'signed_in') sessionState.signedIn = true;
        return sessionState.signInResult;
      },
      signOut: async () => {
        sessionState.signOutCalls++;
        sessionState.signedIn = false;
        if (signOutGate) await signOutGate;
      },
    },
    store: {
      loadKey: async () => {
        if (gates.loadKey) await gates.loadKey;
        return store.key;
      },
      saveKey: async (k) => {
        if (failing.saveKey > 0) { failing.saveKey--; throw new Error('keystore locked'); }
        savedKeys.push(k);
        store.key = k || null;
      },
      loadQueue: async () => store.queue,
      saveQueue: async (q) => {
        if (failing.saveQueue > 0) { failing.saveQueue--; throw new Error('storage full'); }
        savedQueues.push(q.map((a) => a.question));
        store.queue = q;
      },
    },
    setTimer: (fn, ms) => {
      timers.push({ fn, ms, cleared: false });
      return timers.length - 1;
    },
    clearTimer: (h) => void (timers[h as number].cleared = true),
    newId: () => `id${++ids}`,
    now: () => 1_700_000_000_000,
  };
  const ctl = new ChatController(ports);
  const live = () => timers.filter((t) => !t.cleared);
  return {
    ctl, asks, store, savedQueues, savedKeys, timers, live, sessionState,
    onAsk: (f: typeof askImpl) => (askImpl = f),
    /** Hold one of the slow operations until release() is called. */
    gate: (name: 'loadKey' | 'signIn' | 'isSignedIn') => {
      const d = deferred<void>();
      gates[name] = d.promise;
      return () => { delete gates[name]; d.resolve(); };
    },
    /** Make the next n calls of a store write fail. */
    failNext: (name: 'saveKey' | 'saveQueue', n: number) => void (failing[name] = n),
    holdSignOut: () => { const d = deferred<void>(); signOutGate = d.promise; return d.resolve; },
    state: (): ChatState => ctl.getState(),
    maxInFlight: () => maxInFlight,
  };
}
const texts = (s: ChatState) => s.items.map((i) => (i.kind === 'q' ? `q:${i.text}${i.pending ? '*' : ''}` : i.kind === 'a' ? `a:${i.answer.text}` : `n:${i.msg}`));

describe('asking', () => {
  it('sends the question as platform scope with its id as the idempotency key, then shows the answer', async () => {
    const h = make({ key: 'k' });
    await h.ctl.start();
    expect(h.ctl.send('  What does section 56 say?  ')).toBe(true);
    await idle();
    expect(h.asks).toHaveLength(1);
    expect(h.asks[0].req).toEqual({ messages: [{ role: 'user', content: 'What does section 56 say?' }], scope: 'platform' });
    expect(h.asks[0].key).toBe('id1');
    expect(texts(h.state())).toEqual(['q:What does section 56 say?', 'a:hi']);
    expect(h.state().queue).toEqual([]);
    expect(h.state().status).toBeNull();
  });

  it('never asks for any scope but platform (a personal ask must not even be constructible here)', async () => {
    const h = make({ key: 'k' });
    await h.ctl.start();
    for (const q of ['one', 'two', 'three']) h.ctl.send(q);
    await idle();
    expect(h.asks.length).toBe(3);
    expect(new Set(h.asks.map((a) => a.req.scope))).toEqual(new Set(['platform']));
  });

  it('ignores an empty question', async () => {
    const h = make({ key: 'k' });
    await h.ctl.start();
    expect(h.ctl.send('   ')).toBe(false);
    await idle();
    expect(h.asks).toHaveLength(0);
  });

  it('accepts a question of exactly the byte budget, refuses one byte more, and never truncates', async () => {
    const h = make({ key: 'k' });
    await h.ctl.start();
    expect(h.ctl.send('x'.repeat(BUDGET.maxQuestionBytes))).toBe(true);
    await idle();
    expect(h.ctl.send('x'.repeat(BUDGET.maxQuestionBytes + 1))).toBe(false);
    await idle();
    expect(h.state().status).toBe('tooLong');
    expect(h.asks).toHaveLength(1);
    expect(h.asks[0].req.messages[0].content.length).toBe(BUDGET.maxQuestionBytes);
  });

  it('counts bytes, not characters: a Shona sentence with multi-byte letters can be over budget', async () => {
    const h = make({ key: 'k' });
    await h.ctl.start();
    expect(h.ctl.send('é'.repeat(BUDGET.maxQuestionBytes / 2 + 1))).toBe(false); // 2 bytes each
    expect(h.state().status).toBe('tooLong');
  });

  it('clamps a long answer to the byte budget and says it was shortened', async () => {
    const h = make({ key: 'k' });
    h.onAsk(() => answer('y'.repeat(BUDGET.maxAnswerBytes + 500)));
    await h.ctl.start();
    h.ctl.send('q');
    await idle();
    const a = h.state().items.find((i) => i.kind === 'a');
    expect(a && a.kind === 'a' && a.answer.text.length).toBe(BUDGET.maxAnswerBytes);
    expect(a && a.kind === 'a' && a.answer.truncated).toBe(true);
  });

  it('keeps questions in order and sends them one at a time', async () => {
    const h = make({ key: 'k' });
    h.onAsk(async () => { await new Promise((r) => setTimeout(r, 1)); return answer('ok'); });
    await h.ctl.start();
    h.ctl.send('a'); h.ctl.send('b'); h.ctl.send('c');
    await idle();
    expect(h.asks.map((a) => a.req.messages[0].content)).toEqual(['a', 'b', 'c']);
    expect(h.maxInFlight()).toBe(1);
  });

  it('a question typed while another is in flight is neither lost nor overwritten in the saved queue', async () => {
    const h = make({ key: 'k' });
    const first = deferred<Result<Answer>>();
    h.onAsk((n) => (n === 1 ? first.promise : answer('second')));
    await h.ctl.start();
    h.ctl.send('a');
    await idle();
    h.ctl.send('b'); // typed mid-flush
    first.resolve(answer('first'));
    await idle();
    expect(texts(h.state())).toEqual(['q:a', 'q:b', 'a:first', 'a:second']);
    expect(h.savedQueues).toEqual([[], ['a'], ['a', 'b'], ['b'], []]); // start() saved [], then each step
    expect(h.state().queue).toEqual([]);
  });

  it('refuses the 17th kilobyte: a full queue says so instead of growing', async () => {
    const h = make({ key: 'k' });
    h.onAsk(() => fail('offline'));
    await h.ctl.start();
    for (let i = 0; i < BUDGET.maxQueueBytes / BUDGET.maxQuestionBytes; i++) expect(h.ctl.send(String(i).padEnd(BUDGET.maxQuestionBytes, 'x'))).toBe(true);
    await idle();
    expect(h.ctl.send('one more')).toBe(false);
    expect(h.state().items.at(-1)).toMatchObject({ kind: 'note', msg: 'queueFull' });
    expect(h.state().queue).toHaveLength(BUDGET.maxQueueBytes / BUDGET.maxQuestionBytes);
  });
});

describe('when the network or service is down', () => {
  it('keeps the question queued, says why, and retries on a doubling backoff capped at five minutes', async () => {
    const h = make({ key: 'k' });
    h.onAsk(() => fail('offline'));
    await h.ctl.start();
    h.ctl.send('q');
    await idle();
    expect(h.state().status).toBe('offline');
    expect(h.state().queue.map((a) => a.question)).toEqual(['q']);
    const waits: number[] = [h.live()[0].ms];
    for (let i = 0; i < 7; i++) {
      h.live()[0].fn();
      await idle();
      waits.push(h.live().at(-1)!.ms);
    }
    expect(waits).toEqual([10_000, 20_000, 40_000, 80_000, 160_000, 300_000, 300_000, 300_000]);
    expect(h.state().queue).toHaveLength(1);
  });

  it('honours Retry-After when it is longer than the backoff', async () => {
    const h = make({ key: 'k' });
    h.onAsk(() => fail('rate_limited', 120));
    await h.ctl.start();
    h.ctl.send('q');
    await idle();
    expect(h.live()[0].ms).toBe(120_000);
  });

  it('resends with the SAME idempotency key so the gateway replays instead of metering twice', async () => {
    const h = make({ key: 'k' });
    h.onAsk((n) => (n === 1 ? fail('unavailable') : answer('now')));
    await h.ctl.start();
    h.ctl.send('q');
    await idle();
    h.live()[0].fn();
    await idle();
    expect(h.asks.map((a) => a.key)).toEqual(['id1', 'id1']);
    expect(texts(h.state())).toEqual(['q:q', 'a:now']);
    expect(h.state().status).toBeNull();
  });

  it('a success resets the backoff', async () => {
    const h = make({ key: 'k' });
    let mode: 'fail' | 'ok' = 'fail';
    h.onAsk(() => (mode === 'fail' ? fail('offline') : answer('ok')));
    await h.ctl.start();
    h.ctl.send('a');
    await idle();
    h.live()[0].fn(); await idle(); // 20 s armed now
    mode = 'ok';
    h.live().at(-1)!.fn(); await idle();
    mode = 'fail';
    h.ctl.send('b');
    await idle();
    expect(h.live().at(-1)!.ms).toBe(10_000);
  });

  it('coming back to the foreground retries without waiting for the timer', async () => {
    const h = make({ key: 'k' });
    h.onAsk((n) => (n === 1 ? fail('offline') : answer('back')));
    await h.ctl.start();
    h.ctl.send('q');
    await idle();
    h.ctl.foreground();
    await idle();
    expect(texts(h.state())).toEqual(['q:q', 'a:back']);
  });

  it('dispose cancels the pending retry', async () => {
    const h = make({ key: 'k' });
    h.onAsk(() => fail('offline'));
    await h.ctl.start();
    h.ctl.send('q');
    await idle();
    h.ctl.dispose();
    expect(h.live()).toHaveLength(0);
  });
});

describe('when the person must act', () => {
  it('holds every question on a rejected key: nothing is discarded and no retry timer burns requests', async () => {
    const h = make({ key: 'bad' });
    h.onAsk(() => fail('unauthorized'));
    await h.ctl.start();
    h.ctl.send('a'); h.ctl.send('b');
    await idle();
    expect(h.state().queue.map((a) => a.question)).toEqual(['a', 'b']);
    expect(h.state().status).toBe('unauthorized');
    expect(h.state().showSettings).toBe(true);
    expect(h.live()).toHaveLength(0);
    expect(h.asks).toHaveLength(1); // stopped at the first rejection
  });

  it('asks the session again so the screen shows signed-out after a terminal refusal', async () => {
    const h = make({ signedIn: true });
    h.onAsk(() => { h.sessionState.signedIn = false; return fail('unauthorized'); });
    await h.ctl.start();
    expect(h.state().signedIn).toBe(true);
    h.ctl.send('q');
    await idle();
    expect(h.state().signedIn).toBe(false);
  });

  it('a used-up plan holds the queue without throwing the person into Settings', async () => {
    const h = make({ key: 'k' });
    h.onAsk(() => fail('payment_required'));
    await h.ctl.start();
    h.ctl.send('q');
    await idle();
    expect(h.state().queue).toHaveLength(1);
    expect(h.state().status).toBe('payment_required');
    expect(h.state().showSettings).toBe(false);
    expect(h.live()).toHaveLength(0);
  });

  it('resumes the held questions once a key is saved', async () => {
    const h = make({ key: 'bad' });
    let good = false;
    h.onAsk(() => (good ? answer('fine') : fail('unauthorized')));
    await h.ctl.start();
    h.ctl.send('q');
    await idle();
    good = true;
    h.ctl.saveDevKey('  newkey  ');
    await idle();
    expect(h.savedKeys).toEqual(['newkey']);
    expect(texts(h.state())).toEqual(['q:q', 'a:fine']);
    expect(h.state().showSettings).toBe(false);
  });

  it('drops only a question the service cannot read, tells the person, and carries on with the rest', async () => {
    const h = make({ key: 'k' });
    h.onAsk((n) => (n === 1 ? fail('bad_request') : answer('b-ok')));
    await h.ctl.start();
    h.ctl.send('a'); h.ctl.send('b');
    await idle();
    expect(texts(h.state())).toEqual(['q:a', 'q:b', 'n:bad_request', 'a:b-ok']); // no stuck "waiting" star on the dropped one
    expect(h.state().queue).toEqual([]);
  });

  it('shows the Rule 1 refusal as an explanation and does not retry it', async () => {
    const h = make({ key: 'k' });
    h.onAsk(() => fail('scope_requires_local_inference'));
    await h.ctl.start();
    h.ctl.send('q');
    await idle();
    expect(h.state().items.at(-1)).toMatchObject({ kind: 'note', msg: 'scope_requires_local_inference' });
    expect(h.live()).toHaveLength(0);
    expect(h.asks).toHaveLength(1);
  });
});

describe('sign-out on a shared phone', () => {
  it('wipes the phone BEFORE the sign-out page finishes, so a killed app or hung browser leaves nothing', async () => {
    const h = make({ key: 'devkey', signedIn: true });
    h.onAsk(() => fail('offline'));
    await h.ctl.start();
    h.ctl.send('my private question');
    await idle();
    expect(h.live()).toHaveLength(1);
    const release = h.holdSignOut();
    const done = h.ctl.signOut(); // the browser is still open
    await idle();
    const s = h.state();
    expect(s.items).toEqual([]);
    expect(s.queue).toEqual([]);
    expect(s.signedIn).toBe(false);
    expect(s.hasKey).toBe(false);
    expect(s.status).toBe('signedOut');
    expect(h.ctl.devKey()).toBeNull();
    expect(h.store.key).toBeNull();
    expect(h.store.queue).toEqual([]);
    expect(h.live()).toHaveLength(0); // the retry timer is gone: nothing can send as them
    expect(h.sessionState.signOutCalls).toBe(1);
    release();
    await done;
  });

  it('an answer that arrives after sign-out is dropped, not shown to the next person', async () => {
    const h = make({ key: 'k', signedIn: true });
    const inflight = deferred<Result<Answer>>();
    h.onAsk(() => inflight.promise);
    await h.ctl.start();
    h.ctl.send('secret');
    await idle();
    await h.ctl.signOut();
    inflight.resolve(answer('the previous person answer'));
    await idle();
    expect(h.state().items).toEqual([]);
    expect(h.state().queue).toEqual([]);
    expect(h.store.queue).toEqual([]);
  });

  it('a retryable failure that arrives after sign-out does not arm a timer or set a status', async () => {
    const h = make({ key: 'k', signedIn: true });
    const inflight = deferred<Result<Answer>>();
    h.onAsk(() => inflight.promise);
    await h.ctl.start();
    h.ctl.send('secret');
    await idle();
    await h.ctl.signOut();
    inflight.resolve(fail('offline'));
    await idle();
    expect(h.live()).toHaveLength(0);
    expect(h.state().status).toBe('signedOut');
  });

  it('asking something new straight after sign-out still gets sent once the old request ends', async () => {
    const h = make({ key: 'k', signedIn: true });
    const inflight = deferred<Result<Answer>>();
    h.onAsk((n) => (n === 1 ? inflight.promise : answer('fresh')));
    await h.ctl.start();
    h.ctl.send('old');
    await idle();
    await h.ctl.signOut();
    h.ctl.saveDevKey('newperson'); // the next person pastes a key and asks at once
    h.ctl.send('new');
    await idle();
    inflight.resolve(answer('stale'));
    await idle();
    expect(texts(h.state())).toEqual(['q:new', 'a:fresh']);
    expect(h.state().queue).toEqual([]);
  });

  it('removing the pasted key only removes the key', async () => {
    const h = make({ key: 'k' });
    await h.ctl.start();
    expect(h.state().hasKey).toBe(true);
    h.ctl.removeDevKey();
    expect(h.state().hasKey).toBe(false);
    expect(h.store.key).toBeNull();
  });
});

describe('startup and credentials', () => {
  it('loads the saved key and queue, and sends what was waiting', async () => {
    const h = make({ key: 'k', queue: [{ id: 'old1', question: 'left over', createdAt: 1 }] });
    await h.ctl.start();
    await idle();
    expect(h.asks[0].key).toBe('old1');
    expect(texts(h.state())).toEqual(['q:left over', 'a:hi']);
  });

  it('with no key and no session it opens Settings and sends nothing', async () => {
    const h = make({ queue: [{ id: 'o', question: 'waiting', createdAt: 1 }] });
    await h.ctl.start();
    await idle();
    expect(h.state().showSettings).toBe(true);
    expect(h.asks).toHaveLength(0);
    expect(texts(h.state())).toEqual(['q:waiting*']);
  });

  it('a session keystore error must not stop the saved key and queue from loading', async () => {
    const h = make({ key: 'k', queue: [{ id: 'o', question: 'waiting', createdAt: 1 }] });
    h.sessionState.isSignedInThrows = true;
    await h.ctl.start();
    await idle();
    expect(h.state().hasKey).toBe(true);
    expect(h.asks).toHaveLength(1);
    expect(h.state().status).toBeNull();
  });

  it('if the stored key or queue cannot be read at all it says so and opens Settings', async () => {
    const bad = new ChatController({
      ask: async () => answer('x'),
      session: { isSignedIn: async () => false, signIn: async () => 'failed', signOut: async () => undefined },
      store: { loadKey: async () => { throw new Error('locked'); }, saveKey: async () => undefined, loadQueue: async () => [], saveQueue: async () => undefined },
      setTimer: () => 0, clearTimer: () => undefined, newId: () => 'x', now: () => 0,
    });
    await bad.start();
    expect(bad.getState().status).toBe('readFailed');
    expect(bad.getState().showSettings).toBe(true);
  });

  it('start is idempotent (React runs effects twice in development)', async () => {
    const h = make({ key: 'k', queue: [{ id: 'o', question: 'w', createdAt: 1 }] });
    await Promise.all([h.ctl.start(), h.ctl.start()]);
    await idle();
    expect(h.asks).toHaveLength(1);
  });

  it('saving an EMPTY key box only closes Settings; it never deletes the saved key', async () => {
    const h = make({ key: 'keep' });
    await h.ctl.start();
    h.ctl.setShowSettings(true);
    h.ctl.saveDevKey('   ');
    expect(h.state().showSettings).toBe(false);
    expect(h.state().hasKey).toBe(true);
    expect(h.store.key).toBe('keep');
    expect(h.savedKeys).toEqual([]);
  });

  it('a key that cannot be saved is reported, not silently lost', async () => {
    const h = make();
    await h.ctl.start();
    (h.ctl as unknown as { p: ChatPorts }).p.store.saveKey = async () => { throw new Error('full'); };
    h.ctl.saveDevKey('abc');
    await idle();
    expect(h.state().status).toBe('saveKeyFailed');
  });

  it('a queue that cannot be saved is reported', async () => {
    const h = make({ key: 'k' });
    await h.ctl.start();
    (h.ctl as unknown as { p: ChatPorts }).p.store.saveQueue = async () => { throw new Error('full'); };
    h.ctl.send('q');
    await idle();
    expect(h.state().status).toBe('saveQueueFailed');
  });
});

describe('signing in', () => {
  it('a completed sign-in closes Settings and sends what was waiting', async () => {
    const h = make({ queue: [{ id: 'o', question: 'waiting', createdAt: 1 }] });
    await h.ctl.start();
    expect(h.state().showSettings).toBe(true);
    await h.ctl.signIn();
    await idle();
    expect(h.state().signedIn).toBe(true);
    expect(h.state().showSettings).toBe(false);
    expect(texts(h.state())).toEqual(['q:waiting', 'a:hi']);
  });

  it('a failed sign-in says so; a cancelled one is silent', async () => {
    const h = make();
    await h.ctl.start();
    h.sessionState.signInResult = 'failed';
    await h.ctl.signIn();
    expect(h.state().status).toBe('signInFailed');
    h.sessionState.signInResult = 'cancelled';
    await h.ctl.signIn();
    expect(h.state().status).toBeNull();
    expect(h.state().signedIn).toBe(false);
  });
});

describe('view plumbing', () => {
  it('notifies subscribers on change and stops after unsubscribe; state is never mutated in place', async () => {
    const h = make({ key: 'k' });
    let n = 0;
    const off = h.ctl.subscribe(() => n++);
    const before = h.state();
    await h.ctl.start();
    expect(n).toBeGreaterThan(0);
    expect(h.state()).not.toBe(before);
    expect(before.items).toEqual([]);
    off();
    const at = n;
    h.ctl.setShowSettings(true);
    expect(n).toBe(at);
  });

  it('keeps the developer key out of view state', async () => {
    const h = make({ key: 'sk_very_secret' });
    await h.ctl.start();
    expect(JSON.stringify(h.state())).not.toContain('sk_very_secret');
  });
});

describe('sign-out when storage misbehaves, and races at the edges', () => {
  it('retries a failed wipe once, and a wipe that works on the retry is a clean sign-out', async () => {
    const h = make({ key: 'devkey', signedIn: true, queue: [{ id: 'o', question: 'private', createdAt: 1 }] });
    h.onAsk(() => fail('offline'));
    await h.ctl.start();
    await idle();
    h.failNext('saveKey', 1);
    await h.ctl.signOut();
    expect(h.store.key).toBeNull();
    expect(h.store.queue).toEqual([]);
    expect(h.state().status).toBe('signedOut');
    expect(h.sessionState.signOutCalls).toBe(1);
  });

  it('a wipe that keeps failing is SAID: the screen is clear, the status is wipeFailed, and sign-out still completes', async () => {
    const h = make({ key: 'devkey', signedIn: true, queue: [{ id: 'o', question: 'private', createdAt: 1 }] });
    h.onAsk(() => fail('offline'));
    await h.ctl.start();
    await idle();
    h.failNext('saveKey', 5);
    h.failNext('saveQueue', 5);
    await h.ctl.signOut();
    expect(h.state().status).toBe('wipeFailed'); // not hidden, and not overwritten by a queue-save error
    expect(h.state()).toMatchObject({ items: [], queue: [], hasKey: false, signedIn: false });
    expect(h.ctl.devKey()).toBeNull();
    expect(h.sessionState.signOutCalls).toBe(1);
  });

  it('start() that is still reading the stores when the person signs out does not bring the wiped data back', async () => {
    const h = make({ key: 'lastperson', queue: [{ id: 'o', question: 'theirs', createdAt: 1 }] });
    const release = h.gate('loadKey');
    const starting = h.ctl.start();
    await idle();
    await h.ctl.signOut();
    release();
    await starting;
    await idle();
    expect(h.state()).toMatchObject({ items: [], queue: [], hasKey: false });
    expect(h.ctl.devKey()).toBeNull();
    expect(h.asks).toHaveLength(0);
  });

  it('a sign-in that completes after sign-out cannot mark the phone signed in or send anything', async () => {
    const h = make({ queue: [] });
    await h.ctl.start();
    const release = h.gate('signIn');
    const signing = h.ctl.signIn();
    await idle();
    await h.ctl.signOut();
    release();
    await signing;
    await idle();
    expect(h.state().signedIn).toBe(false);
    expect(h.state().status).toBe('signedOut');
    expect(h.asks).toHaveLength(0);
  });

  it('a late "still signed in" answer after a rejection cannot undo a sign-out', async () => {
    const h = make({ key: 'k', signedIn: true });
    h.onAsk(() => fail('unauthorized'));
    await h.ctl.start();
    const release = h.gate('isSignedIn');
    h.ctl.send('q');
    await idle(); // rejected; the controller is waiting on the session
    await h.ctl.signOut();
    release();
    await idle();
    expect(h.state().signedIn).toBe(false);
  });

  it('dispose stops work in flight: nothing is shown, no retry is armed, and start() brings the controller back', async () => {
    const h = make({ key: 'k' });
    const inflight = deferred<Result<Answer>>();
    h.onAsk((n) => (n === 1 ? inflight.promise : answer('after remount')));
    await h.ctl.start();
    h.ctl.send('q');
    await idle();
    h.ctl.dispose(); // what React does between two development mounts
    inflight.resolve(fail('offline'));
    await idle();
    expect(h.live()).toHaveLength(0); // the old run armed nothing
    await h.ctl.start(); // the second mount
    await idle();
    expect(texts(h.state())).toEqual(['q:q', 'a:after remount']);
    expect(h.state().queue).toEqual([]);
  });

  it('a patch that changes nothing does not re-render the screen', async () => {
    const h = make({ key: 'k' });
    await h.ctl.start();
    let n = 0;
    h.ctl.subscribe(() => n++);
    h.ctl.setShowSettings(false);
    h.ctl.setShowSettings(false);
    expect(n).toBe(0);
    h.ctl.setShowSettings(true);
    expect(n).toBe(1);
  });
});
