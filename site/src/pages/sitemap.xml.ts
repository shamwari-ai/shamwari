import type { APIRoute } from 'astro';
import { PAGES } from '../lib/site';

// Every internal marketing page, on the marketing origin (Astro's `site`, which is
// https://www.shamwari.ai). The chat app is a different Worker on a different
// origin and is deliberately not listed.
export const GET: APIRoute = ({ site }) => {
  const origin = new URL(site ?? 'https://www.shamwari.ai').origin;
  const urls = PAGES.filter((p) => !p.external)
    .map((p) => `  <url><loc>${origin}${p.path}</loc></url>`)
    .join('\n');
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
    { headers: { 'Content-Type': 'application/xml; charset=utf-8' } },
  );
};
