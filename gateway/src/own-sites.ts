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

/** A site with a search we can call: the MCP endpoint its docs host serves. */
export interface McpSite {
  kind: 'mcp';
  /** Shown as the source's authority, and used in the citation. */
  name: string;
  mcp: string;
  tool: string;
  /** How the tool lays out its hits: one text item per hit ("Title: ..."), or one numbered list. */
  format: 'titled' | 'numbered';
}

/** A site with no search to call that publishes its full text as `llms-full.txt`: searched here, by section. */
export interface FullTextSite {
  kind: 'llms-full';
  name: string;
  url: string;
}

export type OwnSite = McpSite | FullTextSite;

/** Everything of ours that a machine can read. A site that offers neither is not here (owner: add one). */
export const OWN_SITES: readonly OwnSite[] = [
  { kind: 'mcp', name: 'Zimbabwe Travel Information', mcp: 'https://www.travel-info.co.zw/mcp', tool: 'search_zimbabwe_travel_information', format: 'titled' },
  { kind: 'mcp', name: 'Nyuchi Docs', mcp: 'https://docs.nyuchi.com/mcp', tool: 'search_docs', format: 'numbered' },
  { kind: 'mcp', name: 'Shamwari Docs', mcp: 'https://docs.shamwari.ai/mcp', tool: 'search_shamwari', format: 'titled' },
  { kind: 'mcp', name: 'Mzizi', mcp: 'https://docs.mzizi.dev/mcp', tool: 'search_mzizi', format: 'titled' },
  { kind: 'mcp', name: 'SiafuDB', mcp: 'https://siafudb.org/mcp', tool: 'search_siafu_db', format: 'titled' },
  { kind: 'mcp', name: 'Open Neural Transfer Layer', mcp: 'https://openntl.org/mcp', tool: 'search_neural_transfer_layer', format: 'titled' },
  { kind: 'llms-full', name: 'Bundu Docs', url: 'https://docs.bundu.org/llms-full.txt' },
];

const siteId = (site: OwnSite) => (site.kind === 'mcp' ? site.mcp : site.url);

/** Sites answer in 0.4 to 3 s (a repeat question at once, from the edge cache). Past this the answer goes on
 * without them; with the ranking after (about 0.3 s) the whole step stays near Ground's own 1.5 s. */
export const OWN_SITE_TIMEOUT_MS = 1200;
export const OWN_SITE_COOLDOWN_MS = 30_000;
/** How long the edge keeps a site's answer to one question. */
export const OWN_SITE_CACHE_SECONDS = 3600;
/** At most this many passages per site, each cut to this many characters. */
export const OWN_SITE_TOP_K = 3;
export const OWN_SITE_MAX_CHARS = 1500;
/** Sections of a full text passed on to the ranking by meaning. */
export const OWN_SITE_FULL_TEXT_CANDIDATES = 8;

const downUntil = new Map<string, number>();

export function resetOwnSiteBreakers(): void {
  downUntil.clear();
}

export const ownSiteDown = (site: OwnSite, now = Date.now()): boolean => now < (downUntil.get(siteId(site)) ?? 0);

const STOP = new Set(
  'what when where which who whom whose why how does do did is are was were the and for with from that this there their about into your have has had can could would should will shall may might must tell me please much many some any best good'.split(
    ' ',
  ),
);

/** A rough stem, the same on both sides: plurals, and British "-our" against American "-or" (colour, color). */
export function stem(w: string): string {
  let s = w.replace(/our(s|ed|ing)?$/, 'or$1');
  if (s.length > 4 && s.endsWith('ies')) s = `${s.slice(0, -3)}y`;
  else if (s.length > 4 && s.endsWith('es') && /(ch|sh|x|ss)es$/.test(s)) s = s.slice(0, -2);
  else if (s.length > 4 && s.endsWith('s') && !s.endsWith('ss')) s = s.slice(0, -1);
  return s;
}

/** Words of four letters or more that carry meaning: used to drop passages that share nothing with the question. */
export function terms(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of text.toLowerCase().normalize('NFKD').split(/[^\p{L}\p{N}]+/u)) {
    if (w.length >= 4 && !STOP.has(w)) out.add(stem(w));
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

/** Nyuchi Docs' layout: one text holding "1. Title\n   https://...\n   content", "2. ...". */
export function parseNumbered(texts: string[]): Hit[] {
  const hits: Hit[] = [];
  for (const t of texts) {
    for (const block of t.split(/\n(?=\d{1,2}\. )/)) {
      const m = /^\d{1,2}\. ([^\n]{1,300})\n\s*(https:\/\/\S{1,500})\n([\s\S]*)$/.exec(block.trim());
      if (!m) continue;
      const content = plain(m[3]!.replace(/\[Skip to content\]\([^)]{0,100}\)/g, '').replace(/\[Section titled[^\]]{0,200}\]\([^)]{0,200}\)/g, ''));
      hits.push({ title: m[1]!.trim(), link: m[2]!, content });
    }
  }
  return hits;
}

/** An `llms-full.txt` split into sections: each page ("# Title", then "Source: <url>") at its ##/### headings. */
export function fullTextSections(text: string): Hit[] {
  const out: Hit[] = [];
  const pages = text.split(/\n(?=# [^\n]{1,300}\n\s*\nSource: https:\/\/)/);
  for (const page of pages) {
    const m = /^# ([^\n]{1,300})\n\s*\nSource: (https:\/\/\S{1,500})\n([\s\S]*)$/.exec(page.trim());
    if (!m) continue;
    const [, title, link, body] = m as unknown as [string, string, string, string];
    for (const part of body.split(/\n(?=#{2,3} )/)) {
      const h = /^#{2,3} ([^\n]{1,300})\n/.exec(part);
      const content = plain(h ? part.slice(h[0].length) : part).slice(0, OWN_SITE_MAX_CHARS);
      if (content.split(/\s+/).length < 8) continue;
      out.push({ title: h ? `${title} — ${h[1]!.trim()}` : title, link, content });
    }
  }
  return out;
}

/** Sections of a full text that share the most words with the question (the ranking by meaning comes after). */
export function bestSections(sections: Hit[], query: string, k = OWN_SITE_TOP_K): Hit[] {
  const want = terms(query);
  if (want.size === 0) return [];
  return sections
    .map((h) => {
      const have = terms(`${h.title} ${h.title} ${h.content}`);
      let n = 0;
      for (const w of want) if (have.has(w)) n++;
      return { h, n };
    })
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, k)
    .map((x) => x.h);
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
  `${siteId(site)}?q=${encodeURIComponent([...terms(query)].sort().join(' ') || query.trim().toLowerCase())}`;

/** The Workers edge cache, where there is one (not in tests or Node). */
const edgeCache = (): Cache | null =>
  typeof caches !== 'undefined' && 'default' in caches ? (caches as unknown as { default: Cache }).default : null;

async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const cache = edgeCache();
  const hit = await cache?.match(key).catch(() => undefined);
  if (hit) return (await hit.json()) as T;
  const value = await load();
  await cache
    ?.put(key, Response.json(value, { headers: { 'Cache-Control': `public, max-age=${OWN_SITE_CACHE_SECONDS}` } }))
    .catch(() => undefined);
  return value;
}

async function fetchHits(site: OwnSite, query: string): Promise<Hit[]> {
  if (site.kind === 'llms-full') {
    // The whole text is cached at the edge for an hour, not per question; it is split and searched here.
    const sections = await cached(site.url, async () => {
      const res = await fetch(site.url);
      if (!res.ok) throw new Error(`http_${res.status}`);
      return fullTextSections(await res.text());
    });
    // More candidates than a search site gives: the ranking by meaning picks among them.
    return bestSections(sections, query, OWN_SITE_FULL_TEXT_CANDIDATES);
  }
  return cached(cacheKey(site, query), async () => {
    const res = await fetch(site.mcp, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: site.tool, arguments: { query } } }),
    });
    if (!res.ok) throw new Error(`http_${res.status}`);
    const t = texts(await res.text());
    return (site.format === 'numbered' ? parseNumbered(t) : parseHits(t)).slice(0, OWN_SITE_TOP_K);
  });
}

const SLOW = Symbol('slow');

async function searchSite(site: OwnSite, query: string, deadline: Promise<typeof SLOW>): Promise<GroundChunk[]> {
  if (ownSiteDown(site)) return [];
  try {
    const got = await Promise.race([fetchHits(site, query), deadline]);
    // Slow is not down: this answer goes on without the site, and the breaker stays shut.
    if (got === SLOW) return [];
    downUntil.delete(siteId(site));
    return got.map((h) => ({
      content: h.content.slice(0, OWN_SITE_MAX_CHARS),
      heading: null,
      title: h.title,
      authority: site.name,
      resource_type: 'web page',
      source_url: h.link,
      effective_from: null,
      scope: 'platform',
    }));
  } catch (e) {
    downUntil.set(siteId(site), Date.now() + OWN_SITE_COOLDOWN_MS);
    console.warn('own site unavailable', site.name, e instanceof Error ? e.message : 'error');
    return [];
  }
}

/** Passages scoring at least this against the question (bge-m3 cosine) are kept. Measured on our sites,
 * 2026-11-23: passages that answer score 0.58 to 0.76, unrelated ones 0.30 to 0.45, "hello" at most 0.56. */
export const OWN_SITE_MIN_SIMILARITY = 0.58;
/** At most this many passages from all our sites together. */
export const OWN_SITE_KEEP = 4;

const cosine = (a: number[], b: number[]): number => {
  let d = 0;
  let x = 0;
  let y = 0;
  for (let i = 0; i < a.length && i < b.length; i++) {
    d += a[i]! * b[i]!;
    x += a[i]! ** 2;
    y += b[i]! ** 2;
  }
  return x && y ? d / Math.sqrt(x * y) : 0;
};

/**
 * Keep the passages that answer the question. With the question's embedding, rank every passage by meaning in
 * one embedding call; without it (or if that call fails), keep those that share a word with the question.
 */
export async function rankOwnSites(
  query: string,
  chunks: GroundChunk[],
  questionVector: number[] | null,
  embed: (texts: string[]) => Promise<number[][]>,
): Promise<GroundChunk[]> {
  if (chunks.length === 0) return [];
  if (questionVector) {
    try {
      const vs = await embed(chunks.map((c) => `${c.title}\n${c.content.slice(0, 600)}`));
      if (vs.length === chunks.length) {
        return chunks
          .map((c, i) => ({ c, s: cosine(questionVector, vs[i]!) }))
          .filter((x) => x.s >= OWN_SITE_MIN_SIMILARITY)
          .sort((a, b) => b.s - a.s)
          .slice(0, OWN_SITE_KEEP)
          .map((x) => x.c);
      }
    } catch (e) {
      console.warn('own site ranking unavailable, matching words', e instanceof Error ? e.name : 'error');
    }
  }
  const want = terms(query);
  return chunks.filter((c) => [...terms(`${c.title} ${c.content}`)].some((w) => want.has(w))).slice(0, OWN_SITE_KEEP);
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
