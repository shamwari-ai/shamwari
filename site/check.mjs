// Post-build checks on dist/. Astro covers types; these are the things it
// cannot know about. Modelled on docs-site/check.mjs.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );

const files = walk('dist');
const pages = files.filter((f) => f.endsWith('.html'));
const fail = [];
if (pages.length < 4) fail.push(`expected at least 4 built pages, found ${pages.length}`);

const routes = new Set(pages.map((p) => p.replace(/^dist/, '').replace(/index\.html$/, '')));
const assets = new Set(files.map((f) => f.replace(/^dist/, '')));

// The one permitted family of uses: naming the phrase in order to reject it.
const PERMITTED = ['not the same as being open source', 'Say open weights, not open source'];

let biggest = 0;

for (const page of pages) {
  const html = readFileSync(page, 'utf8');
  const where = page.replace(/^dist\//, '') || 'index.html';
  biggest = Math.max(biggest, Buffer.byteLength(html, 'utf8'));

  // Internal page links resolve to a route that was actually built. Asset
  // paths are checked against the file list instead.
  for (const [, href] of html.matchAll(/href="(\/[^"#]*)"/g)) {
    if (/\.[a-z0-9]{2,5}$/i.test(href)) {
      if (!assets.has(href)) fail.push(`${where}: missing asset ${href}`);
      continue;
    }
    const norm = href.endsWith('/') ? href : href + '/';
    if (!routes.has(norm)) fail.push(`${where}: dead link ${href}`);
  }
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
  for (const [, id] of html.matchAll(/href="#([^"]+)"/g)) {
    if (!ids.has(id)) fail.push(`${where}: dead anchor #${id}`);
  }

  // og:image / twitter:image resolve to a real file too — a dead social
  // preview image fails silently on every platform that would show it.
  for (const [, url] of html.matchAll(/(?:property="og:image"|name="twitter:image") content="([^"]+)"/g)) {
    const assetPath = new URL(url).pathname;
    if (!assets.has(assetPath)) fail.push(`${where}: missing social preview image ${assetPath}`);
  }

  // Language discipline from CLAUDE.md, mirrored from docs-site.
  const flat = html.replace(/\s+/g, ' ');
  for (const m of flat.matchAll(/open[ -]sourc/gi)) {
    const ctx = flat.slice(Math.max(0, m.index - 90), m.index + 90);
    if (!PERMITTED.some((ok) => ctx.includes(ok))) {
      fail.push(`${where}: says "open source" outside the rule that forbids it — …${ctx.slice(60, 150)}…`);
    }
  }
  // "your data stays in Africa" / national-sovereignty framing is banned for
  // Cloud — sovereignty on this site means user-sovereign, never residency.
  if (/data (stays|remains) in africa/i.test(flat)) {
    fail.push(`${where}: claims data residency, which Cloud cannot promise — see the language table in CLAUDE.md`);
  }

  // No client JavaScript: nothing on this site needs it. @bundu/ui's React
  // primitives render server-side with no client:* directive anywhere, so
  // this should hold even with React in the build.
  if (/<script(?![^>]*type="application\/ld\+json")/i.test(html)) {
    fail.push(`${where}: ships a <script> tag`);
  }
}

// The audience is assumed to be on a slow connection.
if (biggest > 51_200) fail.push(`largest page is ${biggest} bytes, over the 50KB budget`);

if (fail.length) {
  console.error('FAIL\n' + [...new Set(fail)].map((f) => '  - ' + f).join('\n'));
  process.exit(1);
}
console.log(
  `ok — ${pages.length} pages, largest ${biggest} bytes, links and assets resolve, ` +
    `no client JS, language rules held`,
);
