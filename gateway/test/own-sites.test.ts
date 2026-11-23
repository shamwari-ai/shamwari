import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OWN_SITE_TIMEOUT_MS, ownSiteDown, OWN_SITES, parseHits, plain, resetOwnSiteBreakers, searchOwnSites, terms } from '../src/own-sites';
import { ground } from '../src/ground';
import type { Env } from '../src/types';

const HIT = [
  'Title: When is the best time to visit Zimbabwe?',
  'Link: https://www.travel-info.co.zw/faq#when-is-the-best-time-to-visit-zimbabwe',
  'Page: faq',
  'Content: ## Climate\n\n<Accordion title="When is the best time to visit Zimbabwe?">\n  Victoria Falls is at high water from about February to May. See [weather by month](/essentials/weather-by-month).\n</Accordion>',
].join('\n');
const OFF_TOPIC = 'Title: Packing guide\nLink: https://www.travel-info.co.zw/essentials/packing-guide\nPage: x\nContent: Bring a hat.';

const sse = (texts: string[]) =>
  new Response(`event: message\ndata: ${JSON.stringify({ result: { content: texts.map((text) => ({ type: 'text', text })) } })}\n\n`, {
    headers: { 'Content-Type': 'text/event-stream' },
  });

const env = (over: Partial<Env> = {}) =>
  ({
    OWN_SITES: 'on',
    CORE_URL: 'https://core.invalid',
    SHAMWARI_CORE_TOKEN: 't',
    GROUND_TOP_K: '6',
    EMBEDDING_MODEL: '@cf/baai/bge-m3',
    AI: { run: async () => ({ data: [[0.5, 0.25]] }) },
    ...over,
  }) as unknown as Env;

const cloud = { scope: 'platform', destination: 'cloud', grants: ['platform'], withoutOwnInformation: false } as never;

beforeEach(() => resetOwnSiteBreakers());
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('reading our own sites', () => {
  it('turns the MDX a site returns into plain text with the link text kept', () => {
    const h = parseHits([HIT])[0]!;
    expect(h.title).toBe('When is the best time to visit Zimbabwe?');
    expect(h.link).toBe('https://www.travel-info.co.zw/faq#when-is-the-best-time-to-visit-zimbabwe');
    expect(h.content).toContain('Victoria Falls is at high water');
    expect(h.content).toContain('weather by month');
    expect(h.content).not.toMatch(/<Accordion|\]\(/);
    expect(plain('<Card title="Hwange">\nBig park\n</Card>')).toBe('Hwange\n\nBig park');
  });

  it('keeps only passages that share a word with the question (the site always returns something)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sse([HIT, OFF_TOPIC])));
    const out = await searchOwnSites('When does Victoria Falls have the most water?');
    expect(out.map((c) => c.title)).toEqual(['When is the best time to visit Zimbabwe?']);
    expect(out[0]!).toMatchObject({ authority: 'Zimbabwe Travel Information', scope: 'platform', source_url: expect.stringMatching(/^https:\/\//) });
    expect(terms('hello there')).toEqual(new Set(['hello']));
  });

  it('asks the site its own search tool, with the question', async () => {
    const fetch = vi.fn(async () => sse([HIT]));
    vi.stubGlobal('fetch', fetch);
    await searchOwnSites('Victoria Falls water');
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(OWN_SITES[0]!.mcp);
    expect(JSON.parse(String(init.body))).toMatchObject({ method: 'tools/call', params: { name: OWN_SITES[0]!.tool, arguments: { query: 'Victoria Falls water' } } });
  });

  it('a failing site adds nothing, never throws, and is skipped for a while', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetch = vi.fn(async () => new Response('down', { status: 502 }));
    vi.stubGlobal('fetch', fetch);
    expect(await searchOwnSites('Victoria Falls')).toEqual([]);
    expect(ownSiteDown(OWN_SITES[0]!)).toBe(true);
    expect(await searchOwnSites('Victoria Falls')).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(OWN_SITE_TIMEOUT_MS).toBeLessThanOrEqual(1500);
  });

  it('a slow site misses this answer only: the breaker stays shut', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((r) => setTimeout(() => r(sse([HIT])), 200))));
    expect(await searchOwnSites('Victoria Falls', OWN_SITES, 20)).toEqual([]);
    expect(ownSiteDown(OWN_SITES[0]!)).toBe(false);
  });
});

describe('ground() and our own sites', () => {
  it('cites the page with its link beside whatever Ground found', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (new URL(url).hostname === 'core.invalid') return new Response('down', { status: 503 });
        return sse([HIT]);
      }),
    );
    const r = await ground(env(), [{ role: 'user', content: 'When is Victoria Falls fullest?' }], 'e-1', cloud, 'en');
    expect(r.hit).toBe(true);
    expect(r.systemPrompt).toContain('Zimbabwe Travel Information');
    expect(r.systemPrompt).toContain('Link: https://www.travel-info.co.zw/faq');
  });

  it('RULE 1: a question that needs the person\'s own information never reaches a site', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetch = vi.fn(async (url: string) => {
      if (new URL(url).hostname !== 'core.invalid') throw new Error('a site must not be asked');
      return Response.json({ scope: 'platform', hit: false, chunks: [] });
    });
    vi.stubGlobal('fetch', fetch);
    const personal = { scope: 'platform', destination: 'cloud', grants: ['platform'], withoutOwnInformation: true } as never;
    await ground(env(), [{ role: 'user', content: 'What is my tax at Victoria Falls?' }], 'e-1', personal, 'en');
    expect((fetch.mock.calls as unknown as [string][]).every(([u]) => new URL(u).hostname === 'core.invalid')).toBe(true);
  });

  it('RULE 1: a mind destination or a non-platform scope never reaches a site', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetch = vi.fn(async () => Response.json({ scope: 'community', hit: false, chunks: [] }));
    vi.stubGlobal('fetch', fetch);
    const mind = { scope: 'platform', destination: 'mind', grants: ['platform'], withoutOwnInformation: false } as never;
    const community = { scope: 'community', destination: 'cloud', grants: ['community'], withoutOwnInformation: false } as never;
    await ground(env(), [{ role: 'user', content: 'Victoria Falls' }], 'e-1', mind, 'en');
    await ground(env(), [{ role: 'user', content: 'Victoria Falls' }], 'e-1', community, 'en');
    expect((fetch.mock.calls as unknown as [string][]).every(([u]) => new URL(u).hostname === 'core.invalid')).toBe(true);
  });

  it('is off unless the setting says on', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetch = vi.fn(async () => Response.json({ scope: 'platform', hit: false, chunks: [] }));
    vi.stubGlobal('fetch', fetch);
    await ground(env({ OWN_SITES: undefined }), [{ role: 'user', content: 'Victoria Falls' }], 'e-1', cloud, 'en');
    expect((fetch.mock.calls as unknown as [string][]).every(([u]) => new URL(u).hostname === 'core.invalid')).toBe(true);
  });
});
