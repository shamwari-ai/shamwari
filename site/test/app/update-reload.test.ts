// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isBusy, resetBusy, setBusy, whenIdle } from '../../src/chat/busy';
import { RELOAD_GUARD_MS, RELOAD_KEY, UPDATE_CHECK_EVERY_MS, reloadOnTakeover, startUpdateChecks } from '../../src/chat/update-reload';

const store = (initial: Record<string, string> = {}) => {
  const m = new Map(Object.entries(initial));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};

describe('forced update: the page reloads once when a new worker takes over', () => {
  beforeEach(() => resetBusy());

  const make = (over: Partial<Parameters<typeof reloadOnTakeover>[1]> = {}, hadController = true) => {
    const reload = vi.fn();
    const storage = store();
    const timers: Array<{ fn: () => void; ms: number }> = [];
    const handler = reloadOnTakeover(hadController, { reload, now: () => 1_000_000, storage, whenIdle, setTimeout: (fn, ms) => void timers.push({ fn, ms }), ...over });
    return { reload, storage, handler, timers };
  };

  it('reloads on a takeover when the page already had a worker', () => {
    const { reload, handler } = make();
    handler();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload on the very first install (the worker only claimed a page that had none)', () => {
    const { reload, handler } = make({}, false);
    handler();
    expect(reload).not.toHaveBeenCalled();
  });

  it('but a page first claimed by the first install does reload for the NEXT release (it has a worker by then)', () => {
    const { reload, handler } = make({}, false);
    handler(); // the first install claims the page
    handler(); // a later release takes over
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads once per page even if controllerchange fires again', () => {
    const { reload, handler } = make();
    handler();
    handler();
    handler();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('LOOP GUARD: a takeover shortly after an update reload does not reload at once; it waits out the rest of the window, then reloads', () => {
    const storage = store({ [RELOAD_KEY]: String(1_000_000 - 20_000) });
    const { reload, handler, timers } = make({ storage });
    handler();
    expect(reload).not.toHaveBeenCalled();
    expect(timers).toHaveLength(1);
    expect(timers[0]!.ms).toBe(RELOAD_GUARD_MS - 20_000);
    timers[0]!.fn();
    expect(reload).toHaveBeenCalledTimes(1); // one reload, after the window: a hotfix still arrives, a flapping worker cannot spin
  });

  it('LOOP GUARD: repeated takeovers inside the window schedule ONE reload', () => {
    const storage = store({ [RELOAD_KEY]: String(1_000_000 - 1000) });
    const { reload, handler, timers } = make({ storage });
    handler();
    handler();
    handler();
    expect(timers).toHaveLength(1);
    timers[0]!.fn();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('LOOP GUARD: a clock set back never waits longer than the guard', () => {
    const storage = store({ [RELOAD_KEY]: String(1_000_000 + 5_000_000) });
    const { handler, timers } = make({ storage });
    handler();
    expect(timers[0]!.ms).toBe(RELOAD_GUARD_MS);
  });

  it('LOOP GUARD: once the guard time has passed, the next release reloads at once', () => {
    const storage = store({ [RELOAD_KEY]: String(1_000_000 - RELOAD_GUARD_MS) });
    const { reload, handler, timers } = make({ storage });
    handler();
    expect(timers).toHaveLength(0);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('writes the time of the reload before reloading, so the next page load knows', () => {
    const { storage, handler, reload } = make();
    reload.mockImplementation(() => expect(storage.m.get(RELOAD_KEY)).toBe('1000000'));
    handler();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('still reloads once when storage is blocked', () => {
    const throwing = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    const reload = vi.fn();
    const handler = reloadOnTakeover(true, { reload, now: () => 1_000_000, storage: throwing, whenIdle, setTimeout: () => {} });
    handler();
    handler();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('NEVER MID-SEND: while a question is on its way the reload waits, and happens right after it settles', () => {
    const { reload, handler } = make();
    setBusy('send', true);
    handler();
    expect(reload).not.toHaveBeenCalled();
    setBusy('send', false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('NEVER MID-DRAFT: text in the question box holds the reload until it is sent or cleared', () => {
    const { reload, handler } = make();
    setBusy('draft', true);
    handler();
    expect(reload).not.toHaveBeenCalled();
    setBusy('draft', false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('waits for every reason, not just the first to clear', () => {
    const { reload, handler } = make();
    setBusy('send', true);
    setBusy('draft', true);
    handler();
    setBusy('send', false);
    expect(reload).not.toHaveBeenCalled();
    expect(isBusy()).toBe(true);
    setBusy('draft', false);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe('forced update: the page asks for a newer worker', () => {
  it('checks on load, whenever the tab becomes visible again, and every hour', () => {
    const update = vi.fn(() => Promise.resolve());
    let onVisible: (() => void) | undefined;
    const doc = { visibilityState: 'hidden' as DocumentVisibilityState, addEventListener: (_: string, fn: () => void) => void (onVisible = fn) } as unknown as Document;
    const timers: Array<{ fn: () => void; ms: number }> = [];
    startUpdateChecks({ update }, { document: doc, setInterval: (fn, ms) => void timers.push({ fn, ms }) });
    expect(update).toHaveBeenCalledTimes(1); // on load
    onVisible!(); // still hidden: no check
    expect(update).toHaveBeenCalledTimes(1);
    (doc as { visibilityState: string }).visibilityState = 'visible';
    onVisible!();
    expect(update).toHaveBeenCalledTimes(2);
    expect(timers).toHaveLength(1);
    expect(timers[0]!.ms).toBe(UPDATE_CHECK_EVERY_MS);
    expect(UPDATE_CHECK_EVERY_MS).toBe(3_600_000);
    timers[0]!.fn();
    expect(update).toHaveBeenCalledTimes(3);
  });

  it('a failed check (offline, signed out) is swallowed', async () => {
    const update = vi.fn(() => Promise.reject(new Error('offline')));
    const doc = { visibilityState: 'visible', addEventListener: () => {} } as unknown as Document;
    expect(() => startUpdateChecks({ update }, { document: doc, setInterval: () => {} })).not.toThrow();
    await Promise.resolve();
  });
});
