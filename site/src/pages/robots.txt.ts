import type { APIRoute } from 'astro';

export const GET: APIRoute = ({ site }) => {
  const origin = new URL(site ?? 'https://www.shamwari.ai').origin;
  return new Response(`User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
