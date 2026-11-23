import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GROUND_COOLDOWN_MS,
  GROUND_TIMEOUT_MS,
  GroundStoreError,
  groundSearch,
  groundStoreConfigured,
  groundStoreDown,
  resetGroundStoreBreaker,
} from '../src/ground-store';
import { ground } from '../src/ground';
import type { Env } from '../src/types';

const env = (over: Partial<Env> = {}) =>
  ({
    NYUCHI_API_URL: 'https://api.example.com/',
    NYUCHI_SHAMWARI_API_KEY: { get: async () => 'nyk_test.secret' },
    CORE_URL: 'https://core.invalid',
    SHAMWARI_CORE_TOKEN: 't',
    GROUND_TOP_K: '6',
    EMBEDDING_MODEL: '@cf/baai/bge-m3',
    AI: { run: async () => ({ data: [[0.5, 0.25]] }) },
    ...over,
  }) as unknown as Env;

const q = {
  query: 'What does section 56 say?',
  embedding: [0.5, 0.25],
  owner_entity_id: 'e-1',
  scope: 'platform',
  destination: 'cloud',
  language: 'en',
  top_k: 6,
};

const SECTION_56 = {
  title: 'Constitution of Zimbabwe',
  heading: 'Section 56 — Equality and non-discrimination',
  authority: 'Parliament of Zimbabwe',
  resource_type: 'constitution',
  source_url: null,
  effective_from: '2013-05-22',
  content: 'All persons are equal before the law.',
  scope: 'platform',
};

beforeEach(() => resetGroundStoreBreaker());
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('Ground in Mongo through the Nyuchi API: the call', () => {
  it("calls the API's ground search with Shamwari's service key and only the fields the API accepts", async () => {
    const fetch = vi.fn(async () => Response.json({ scope: 'platform', hit: true, chunks: [SECTION_56], needs_own_information: false }));
    vi.stubGlobal('fetch', fetch);
    const out = await groundSearch(env(), q);
    expect(out.hit).toBe(true);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example.com/v1/shamwari/ground/search');
    const headers = init.headers as Record<string, string>;
    expect(headers['X-API-Key']).toBe('nyk_test.secret');
    expect(JSON.parse(String(init.body))).toEqual({
      query: 'What does section 56 say?',
      embedding: [0.5, 0.25],
      owner_entity_id: 'e-1',
      scope: 'platform',
      destination: 'cloud',
      language: 'en',
      top_k: 6,
    });
  });

  it('sends no vector at all when there is none (keyword search only)', async () => {
    const fetch = vi.fn(async () => Response.json({ scope: 'platform', hit: false, chunks: [] }));
    vi.stubGlobal('fetch', fetch);
    await groundSearch(env(), { ...q, embedding: undefined });
    const body = JSON.parse(String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body).not.toHaveProperty('embedding');
  });

  it("never sends the API Core's extra fields (it refuses unknown ones)", async () => {
    const fetch = vi.fn(async () => Response.json({ scope: 'platform', hit: false, chunks: [] }));
    vi.stubGlobal('fetch', fetch);
    await groundSearch(env(), { ...q, granted_scopes: ['platform'], needs_own_information: false } as never);
    const body = JSON.parse(String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body).not.toHaveProperty('granted_scopes');
    expect(body).not.toHaveProperty('needs_own_information');
  });

  it("is used only when it is configured; otherwise Ground is asked of Core, as before", () => {
    expect(groundStoreConfigured(env())).toBe(true);
    expect(groundStoreConfigured(env({ NYUCHI_API_URL: undefined }))).toBe(false);
    expect(groundStoreConfigured(env({ NYUCHI_SHAMWARI_API_KEY: undefined }))).toBe(false);
  });
});

describe('Ground in Mongo: a refusal is the API answering, an outage is skipped fast', () => {
  it('a Rule 1 refusal (409) comes back as itself and does NOT open the breaker', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ detail: { error: 'edge_embedding_forbidden' } }, { status: 409 })));
    const e = await groundSearch(env(), q).catch((x) => x);
    expect(e).toBeInstanceOf(GroundStoreError);
    expect(e.status).toBe(409);
    expect(e.code).toBe('edge_embedding_forbidden');
    expect(groundStoreDown()).toBe(false);
  });

  it('a 5xx opens the breaker; the next search fails at once without a network call, and it closes after the cooldown', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const fetch = vi.fn(async () => new Response('bad gateway', { status: 502 }));
    vi.stubGlobal('fetch', fetch);
    await expect(groundSearch(env(), q)).rejects.toMatchObject({ status: 502 });
    expect(groundStoreDown()).toBe(true);
    await expect(groundSearch(env(), q)).rejects.toMatchObject({ status: 503 });
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + GROUND_COOLDOWN_MS + 1);
    expect(groundStoreDown()).toBe(false);
  });

  it('a key that cannot be read (the secret not created yet) is an outage, never a crash, and makes no call', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const e = await groundSearch(env({ NYUCHI_SHAMWARI_API_KEY: { get: async () => { throw new Error('secret not found'); } } } as never), q).catch((x) => x);
    expect(e).toBeInstanceOf(GroundStoreError);
    expect(e.status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('a network failure or the time limit counts as down, and the limit is short (routing never waits on it)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new DOMException('The operation timed out.', 'TimeoutError'); }));
    await expect(groundSearch(env(), q)).rejects.toMatchObject({ status: 503 });
    expect(groundStoreDown()).toBe(true);
    expect(GROUND_TIMEOUT_MS).toBeLessThanOrEqual(1500);
  });
});

describe('ground() with Ground in Mongo configured', () => {
  it('cites what the API found and never asks Core', async () => {
    const fetch = vi.fn(async (url: string) => {
      if (new URL(url).hostname === 'core.invalid') throw new Error('Core must not be asked');
      return Response.json({ scope: 'platform', hit: true, chunks: [SECTION_56], needs_own_information: false });
    });
    vi.stubGlobal('fetch', fetch);
    const r = await ground(env(), [{ role: 'user', content: 'Is everyone equal?' }], 'e-1', { scope: 'platform', destination: 'cloud', grants: ['platform'], withoutOwnInformation: false } as never, 'en');
    expect(r.hit).toBe(true);
    expect(r.unavailable).toBe(false);
    expect(r.systemPrompt).toContain('--- SOURCES ---');
    expect(r.systemPrompt).toContain('Section 56');
    expect(fetch.mock.calls.every(([u]) => new URL(String(u)).hostname === 'api.example.com')).toBe(true);
  });

  it('an API outage leaves the answer to go on without sources, said honestly (unavailable, not "nothing found")', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 503 })));
    const r = await ground(env(), [{ role: 'user', content: 'Is everyone equal?' }], 'e-1', { scope: 'platform', destination: 'cloud', grants: ['platform'], withoutOwnInformation: false } as never, 'en');
    expect(r.hit).toBe(false);
    expect(r.unavailable).toBe(true);
  });
});
