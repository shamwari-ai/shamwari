import type { GroundChunk } from './types';

/**
 * Our own sites, read live at question time (owner, 2026-11-23: "travel info gets pulled from the site directly;
 * we own the site, so don't duplicate").
 *
 * Nothing is copied into Ground. Each site's own search (the MCP endpoint its docs host serves) is asked the
 * question, and the passages it returns are cited with a link to the page, so an answer is always as current
 * as the site. The search sees the question text, so `ground()` calls this only where a cloud provider may see
 * it: platform scope, a cloud destination, and a question that does not need the person's own information.
 *
 * Getting to an answer never waits on a site: one short limit for all of them. A slow site only misses that
 * one answer (slow is not down); an error opens that site's breaker. What a site returns is kept in the edge
 * cache for an hour, keyed on the question, so a repeat question is answered at once and stays current.
 */

export interface OwnSite {
  /** Shown as the source's authority, and used in the citation. */
  name: string;
  /** The site's MCP endpoint. */
  mcp: string;
  /** Its search tool. */
  tool: string;
}

export const OWN_SITES: readonly OwnSite[] = [
  { name: 'Zimbabwe Travel Information', mcp: 'https://www.travel-info.co.zw/mcp', tool: 'search_zimbabwe_travel_information' },
];

/** The site answers in about 0.8 s; past this the answer goes on without it. */
export const OWN_SITE_TIMEOUT_MS = 1500;
export const OWN_SITE_COOLDOWN_MS = 30_000;
/** How long the edge keeps a site's answer to one question. */
export const OWN_SITE_CACHE_SECONDS = 3600;
/** At most this many passages per site, each cut to this many characters. */
export const OWN_SITE_TOP_K = 3;
export const OWN_SITE_MAX_CHARS = 1500;

const downUntil = new Map<string, number>();

export function resetOwnSiteBreakers(): void {
  downUntil.clear();
}

export const ownSiteDown = (site: OwnSite, now = Date.now()): boolean => now < (downUntil.get(site.mcp) ?? 0);

const STOP = new Set(
  'what when where which who whom whose why how does do did is are was were the and for with from that this there their about into your have has had can could would should will shall may might must tell me please much many some any best good'.split(
    ' ',
  ),
);

/** Words of four letters or more that carry meaning: used to drop passages that share nothing with the question. */
export function terms(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of text.toLowerCase().normalize('NFKD').split(/[^\p{L}\p{N}]+/u)) {
    if (w.length >= 4 && !STOP.has(w)) out.add(w);
  }
  return out;
}

/** MDX to readable text: keep a component's title, drop tags, keep link text. */
export function plain(md: string): string {
  let s = md.replace(/<[A-Z][A-Za-z]{0,40}\b[^>]{0,300}?\btitle="([^"]{1,200})"[^>]{0,300}>/g, '\n$1\n');
  s = s.replace(/<\/?[A-Z][A-Za-z]{0,40}\b[^>]{0,500}>/g, '');
  s = s.replace(/!\[[^\]]{0,300}\]\([^)]{0,500}\)/g, '');
  s = s.replace(/\[([^\]]{1,300})\]\([^)]{0,500}\)/g, '$1');
  s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

interface Hit {
  title: string;
  link: string | null;
  content: string;
}

/** The search tool answers with one text item per hit: "Title: ...\nLink: ...\nPage: ...\nContent: ...". */
export function parseHits(texts: string[]): Hit[] {
  const hits: Hit[] = [];
  for (const t of texts) {
    const title = /^Title: (.*)$/m.exec(t)?.[1]?.trim();
    const link = /^Link: (https:\/\/\S+)$/m.exec(t)?.[1] ?? null;
    const i = t.indexOf('\nContent: ');
    if (!title || i < 0) continue;
    hits.push({ title, link, content: plain(t.slice(i + '\nContent: '.length)) });
  }
  return hits;
}

/** An MCP reply arrives as JSON or as one server-sent event; either way, the tool result's text items. */
function texts(body: string): string[] {
  const json = body.trimStart().startsWith('{')
    ? body
    : body
        .split('\n')
        .filter((l) => l.startsWith('data: '))
        .map((l) => l.slice(6))
        .join('');
  const j = JSON.parse(json) as { result?: { content?: { type?: string; text?: string }[] } };
  return (j.result?.content ?? []).filter((c) => c.type === 'text' && typeof c.text === 'string').map((c) => c.text!);
}

const cacheKey = (site: OwnSite, query: string) =>
  `${site.mcp}?q=${encodeURIComponent([...terms(query)].sort().join(' ') || query.trim().toLowerCase())}`;

/** The Workers edge cache, where there is one (not in tests or Node). */
const edgeCache = (): Cache | null =>
  typeof caches !== 'undefined' && 'default' in caches ? (caches as unknown as { default: Cache }).default : null;

async function fetchHits(site: OwnSite, query: string): Promise<Hit[]> {
  const cache = edgeCache();
  const key = cacheKey(site, query);
  const cached = await cache?.match(key).catch(() => undefined);
  if (cached) return (await cached.json()) as Hit[];
  const res = await fetch(site.mcp, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: site.tool, arguments: { query } } }),
  });
  if (!res.ok) throw new Error(`http_${res.status}`);
  const hits = parseHits(texts(await res.text()));
  await cache
    ?.put(key, Response.json(hits, { headers: { 'Cache-Control': `public, max-age=${OWN_SITE_CACHE_SECONDS}` } }))
    .catch(() => undefined);
  return hits;
}

const SLOW = Symbol('slow');

async function searchSite(site: OwnSite, query: string, deadline: Promise<typeof SLOW>): Promise<GroundChunk[]> {
  if (ownSiteDown(site)) return [];
  const want = terms(query);
  try {
    const got = await Promise.race([fetchHits(site, query), deadline]);
    // Slow is not down: this answer goes on without the site, and the breaker stays shut.
    if (got === SLOW) return [];
    downUntil.delete(site.mcp);
    return (
      got
        // The site's search always returns something; keep only passages that share a word with the question.
        .filter((h) => [...terms(`${h.title} ${h.content}`)].some((w) => want.has(w)))
        .slice(0, OWN_SITE_TOP_K)
        .map((h) => ({
          content: h.content.slice(0, OWN_SITE_MAX_CHARS),
          heading: null,
          title: h.title,
          authority: site.name,
          resource_type: 'web page',
          source_url: h.link,
          effective_from: null,
          scope: 'platform',
        }))
    );
  } catch (e) {
    downUntil.set(site.mcp, Date.now() + OWN_SITE_COOLDOWN_MS);
    console.warn('own site unavailable', site.name, e instanceof Error ? e.message : 'error');
    return [];
  }
}

/** Ask every site at once, under one limit. A site that fails or is slow adds nothing; this never throws. */
export async function searchOwnSites(
  query: string,
  sites: readonly OwnSite[] = OWN_SITES,
  timeoutMs = OWN_SITE_TIMEOUT_MS,
): Promise<GroundChunk[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<typeof SLOW>((resolve) => {
    timer = setTimeout(() => resolve(SLOW), timeoutMs);
  });
  try {
    return (await Promise.all(sites.map((s) => searchSite(s, query, deadline)))).flat();
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
