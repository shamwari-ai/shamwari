// Post-build checks on dist/. Astro covers types; these are the things it
// cannot know about. Modelled on docs-site/check.mjs.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { findClaimProblems, selfTest } from './claims.mjs';

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );

// The claim rules are tested before they are used: if a rule has stopped
// catching what it exists to catch, fail here rather than pass every page.
const broken = selfTest();
if (broken.length) {
  console.error('FAIL\n' + broken.map((f) => '  - claims.mjs self-test: ' + f).join('\n'));
  process.exit(1);
}

const files = walk('dist');
const pages = files.filter((f) => f.endsWith('.html'));
const fail = [];
if (pages.length < 4) fail.push(`expected at least 4 built pages, found ${pages.length}`);

const routes = new Set(pages.map((p) => p.replace(/^dist/, '').replace(/index\.html$/, '')));
const assets = new Set(files.map((f) => f.replace(/^dist/, '')));

// The one permitted family of uses: naming the phrase in order to reject it.
const PERMITTED = ['not the same as being open source', 'Say open weights, not open source'];

// The diagram takes its colours from design tokens, so light and dark both
// work; a hard-coded colour would be right in one and wrong in the other.
// Removing a comment can join the text around it into a new comment opener, so
// strip until nothing changes. (This reads our own source, not user input; the
// loop is what makes the removal complete.)
const stripUntilStable = (text, patterns) => {
  let prev;
  do {
    prev = text;
    for (const p of patterns) text = text.replace(p, '');
  } while (text !== prev);
  return text;
};

for (const src of ['src/components/DataScopes.astro', 'src/pages/index.astro']) {
  const code = stripUntilStable(readFileSync(src, 'utf8'), [
    /<!--[\s\S]*?-->/g,
    /\/\*[\s\S]*?\*\//g,
    /^\s*\/\/.*$/gm,
  ]);
  // Fallbacks inside var() count: a hex fallback is a hard-coded colour too.
  if (/(?<![\w&])#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i.test(code.replace(/href="[^"]*"/g, ''))) {
    fail.push(`${src}: hard-coded colour; use design tokens (var(--…))`);
  }
}

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

  // Sovereignty is never claimed for Cloud, and it is never an "open source
  // model" or "our own model", on any page.
  // Block ends become sentence ends, so a heading cannot lend its words to the
  // list item after it, and entities are decoded so "isn&#39;t" is "isn't".
  const text = stripUntilStable(html, [/<(script|style)[\s\S]*?<\/\1>/gi])
    .replace(/<\/(p|li|h[1-6]|div|section|figcaption|td|th|tr|text|title|desc|blockquote|summary)>/gi, '. ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#39;|&apos;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
  for (const p of findClaimProblems(text)) fail.push(`${where}: ${p}`);

  // The home page is SVG only: no raster image anywhere on it.
  if (where === 'index.html' && /<img[^>]+src="[^"]+\.(png|jpe?g|gif|webp|avif)"/i.test(html)) {
    fail.push(`${where}: a raster <img> on the SVG-only home page`);
  }

  // The scope diagram is an image to a screen reader: role="img" with a title
  // and a description, both real text, both referenced by aria-labelledby.
  if (where === 'index.html') {
    const svgs = [...html.matchAll(/<svg\b[^>]*>[\s\S]*?<\/svg>/g)]
      .map((m) => m[0])
      .filter((tag) => /\brole="img"/.test(tag.slice(0, tag.indexOf('>') + 1)));
    if (!svgs.length) {
      fail.push(`${where}: the data-scopes diagram has no <svg role="img">`);
    }
    for (const svg of svgs) {
      const open = svg.slice(0, svg.indexOf('>') + 1);
      const labelled = open.match(/\baria-labelledby="([^"]+)"/);
      if (!labelled) {
        fail.push(`${where}: an <svg role="img"> has no aria-labelledby`);
        continue;
      }
      for (const id of labelled[1].split(/\s+/)) {
        const el = svg.match(new RegExp(`<(title|desc) id="${id}"[^>]*>([\\s\\S]*?)</\\1>`));
        const t = el ? el[2].replace(/\s+/g, ' ').trim() : '';
        const min = el && el[1] === 'title' ? 8 : 80;
        if (t.length < min) fail.push(`${where}: diagram ${id} is missing or too short to be alt text (${t.length} < ${min})`);
      }
    }
    const scopes = svgs.find((v) => /scopes-title/.test(v));
    if (scopes && !/personal[\s\S]{0,400}Mind[\s\S]{0,400}(never|not)[\s\S]{0,200}provider/i.test(scopes)) {
      fail.push(`${where}: the diagram's description must say personal data goes to Mind and never to a provider`);
    }
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
