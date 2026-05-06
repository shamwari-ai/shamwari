import { SITE } from "$lib/seo/meta";
import { posts } from "../blog/posts";

export const prerender = true;

export function GET() {
  const items = posts
    .map(
      (post) => `    <item>
      <title><![CDATA[${post.title}]]></title>
      <link>${SITE.url}/blog/${post.slug}</link>
      <guid isPermaLink="true">${SITE.url}/blog/${post.slug}</guid>
      <pubDate>${new Date(post.datePublished).toUTCString()}</pubDate>
      <author>${post.author.name}</author>
      <description><![CDATA[${post.description}]]></description>
    </item>`,
    )
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${SITE.brand}</title>
    <link>${SITE.url}/blog</link>
    <description>${SITE.defaultDescription}</description>
    <language>en</language>
    <atom:link href="${SITE.url}/rss.xml" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
