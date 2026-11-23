import { afterEach, describe, expect, it, vi } from 'vitest';
import { core, CoreError, coreDown, CORE_COOLDOWN_MS } from '../src/core';
import type { Env } from '../src/types';

// The breaker: once Core fails to answer, the calls after it skip Core for a while and fail at once, as a 503, instead of each
// waiting out the timeout. A 4xx is Core answering, so it never opens it, and any answer closes it.

const env = { CORE_URL: 'https://core.invalid', SHAMWARI_CORE_TOKEN: 't' } as unknown as Env;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('the Core breaker', () => {
  it('after no connection, the next call fails at once as a 503 without calling Core', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('connection refused');
    });
    vi.stubGlobal('fetch', fetch);
    await expect(core(env, '/ground/search', { method: 'POST', body: {} })).rejects.toThrow('connection refused');
    expect(coreDown()).toBe(true);
    const skipped = await core(env, '/rollup').catch((e: unknown) => e);
    expect(skipped).toBeInstanceOf(CoreError);
    expect((skipped as CoreError).status).toBe(503);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('a 5xx opens it; it closes by itself after the cool-down and Core is asked again', async () => {
    vi.useFakeTimers();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('down', { status: 502 }))
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    await expect(core(env, '/rollup')).rejects.toMatchObject({ status: 502 });
    await expect(core(env, '/rollup')).rejects.toMatchObject({ status: 503 });
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(CORE_COOLDOWN_MS + 1);
    await expect(core(env, '/rollup')).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(coreDown()).toBe(false);
  });

  it('a 4xx (Core refusing a scope, a bad key) never opens it', async () => {
    const fetch = vi.fn(async () => new Response('{"error":"forbidden_scope"}', { status: 403 }));
    vi.stubGlobal('fetch', fetch);
    await expect(core(env, '/ground/search', { method: 'POST', body: {} })).rejects.toMatchObject({ status: 403 });
    expect(coreDown()).toBe(false);
    await expect(core(env, '/ground/search', { method: 'POST', body: {} })).rejects.toMatchObject({ status: 403 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
