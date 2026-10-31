// Post-build checks. `node check.mjs marketing` checks dist/ (the www.shamwari.ai
// Worker); `node check.mjs app` checks dist-app/ (the shamwari.ai chat Worker).
// Post-build checks on dist/. Astro covers types; these are the things it
// cannot know about. Modelled on docs-site/check.mjs.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
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

const TARGET = process.argv[2] === 'app' ? 'app' : 'marketing';
const DIST = TARGET === 'app' ? 'dist-app' : 'dist';
const files = walk(DIST);
const pages = files.filter((f) => f.endsWith('.html'));
const fail = [];
if (TARGET === 'marketing' && pages.length < 4) fail.push(`expected at least 4 built pages, found ${pages.length}`);

// Two Workers, two origins, and neither may carry the other's pages. The chat app
// is https://shamwari.ai/chat/ (shamwari-app); the marketing site is
// https://www.shamwari.ai (shamwari-site).
const MARKETING_ORIGIN = 'https://www.shamwari.ai';
const APP_ORIGIN = 'https://shamwari.ai';
if (TARGET === 'marketing') {
  for (const f of files) {
    const rel = f.slice(DIST.length);
    if (rel.startsWith('/chat/') || rel === '/_redirects') fail.push(`marketing build contains an app file: ${rel}`);
  }
}
if (TARGET === 'app') {
  for (const p of pages) {
    if (!p.endsWith('/chat/index.html')) fail.push(`app build contains a page that is not the chat: ${p.slice(DIST.length)}`);
  }
  if (!pages.some((p) => p.endsWith('/chat/index.html'))) fail.push('app build has no /chat/ page');
  const redirects = files.includes(`${DIST}/_redirects`) ? readFileSync(`${DIST}/_redirects`, 'utf8') : '';
  if (!/^\/\s+\/chat\/\s+302\s*$/m.test(redirects)) fail.push('app build: the root / must 302 to /chat/ (_redirects)');
  // Redirects may only go to the chat or to the marketing origin: the app Worker sends
  // old marketing links to www but never serves a marketing page itself.
  for (const line of redirects.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const dest = t.split(/\s+/)[1] ?? '';
    if (!(dest.startsWith('/chat/') || dest.startsWith(MARKETING_ORIGIN + '/'))) fail.push(`app _redirects: "${t}" goes somewhere other than /chat/ or ${MARKETING_ORIGIN}`);
  }
}

const routes = new Set(pages.map((p) => p.replace(new RegExp(`^${DIST}`), '').replace(/index\.html$/, '')));
const assets = new Set(files.map((f) => f.replace(new RegExp(`^${DIST}`), '')));

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

for (const src of TARGET === 'marketing' ? ['src/components/DataScopes.astro', 'src/pages/index.astro'] : []) {
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
const chatScripts = new Set();

for (const page of pages) {
  const html = readFileSync(page, 'utf8');
  const where = page.replace(new RegExp(`^${DIST}/`), '') || 'index.html';
  biggest = Math.max(biggest, Buffer.byteLength(html, 'utf8'));

  // Canonical and social URLs belong to this Worker's own origin, so a search
  // engine never sees the app under www or the marketing pages on the apex.
  const own = TARGET === 'app' ? APP_ORIGIN : MARKETING_ORIGIN;
  for (const m of html.matchAll(/(?:<link rel="canonical" href|property="og:url" content)="([^"]+)"/g)) {
    if (!m[1].startsWith(own + '/')) fail.push(`${where}: canonical/og:url ${m[1]} is not on ${own}`);
  }

  // Internal page links resolve to a route that was actually built. Asset
  // paths are checked against the file list instead.
  for (const [, href] of html.matchAll(/href="(\/[^"#]*)"/g)) {
    if (/\.(?:[a-z0-9]{2,5}|webmanifest)$/i.test(href)) {
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

  // No client JavaScript anywhere except the chat app. @bundu/ui's React
  // primitives render server-side with no client:* directive, so the
  // marketing pages ship none. The chat page is the one exception, and it may
  // load only its own bundled module from /_astro/ (no third-party script, no
  // inline script), whose size is held to the budget below.
  const scripts = [...html.matchAll(/<script\b([^>]*)>/gi)].filter((m) => !/type="application\/ld\+json"/i.test(m[1]));
  if (where === 'chat/index.html') {
    for (const [, attrs] of scripts) {
      const src = attrs.match(/\bsrc="([^"]+)"/)?.[1];
      if (!src || !src.startsWith('/_astro/')) fail.push(`${where}: script is not a bundled /_astro/ module (${attrs.trim().slice(0, 60)})`);
      else chatScripts.add(src);
    }
    if (!scripts.length) fail.push(`${where}: the chat page ships no script`);
    // Web fonts block render on 2G; the chat shell uses the system stack.
    if (/fonts\.(googleapis|gstatic)\.com/.test(html)) fail.push(`${where}: loads a web font; the chat shell is system-font only`);
    if (!/<html lang="/.test(html)) fail.push(`${where}: <html> has no lang`);
  } else if (scripts.length) {
    fail.push(`${where}: ships a <script> tag`);
  }
}

// First-load JS budget for the chat app, gzipped as a CDN would send it: the
// module the page loads plus every static import it pulls in. Anything lazily
// imported is not first load and is not counted, but is listed.
const CHAT_JS_BUDGET = 100 * 1024;
const CHAT_CSS_BUDGET = 30 * 1024;
const CHAT_FIRST_LOAD_BUDGET = 50 * 1024;
const gz = (file) => gzipSync(readFileSync(file)).length;
const closure = new Set();
const visit = (src) => {
  if (closure.has(src)) return;
  closure.add(src);
  const code = readFileSync(DIST + src, 'utf8');
  for (const [, dep] of code.matchAll(/(?:^|[;}\s])(?:import|export)[^'"`;]*?from\s*["']\.\/([^"']+)["']/g)) visit('/_astro/' + dep);
};
for (const src of chatScripts) if (assets.has(src)) visit(src);
const chatJs = [...closure].reduce((n, src) => n + gz(DIST + src), 0);
if (chatJs > CHAT_JS_BUDGET) fail.push(`chat first-load JS is ${chatJs} B gzipped, over the ${CHAT_JS_BUDGET} B budget`);

let chatCss = 0;
let chatFirstLoad = 0;
const chatHtml = pages.find((p) => p.endsWith('chat/index.html'));
if (chatHtml) {
  for (const [, href] of readFileSync(chatHtml, 'utf8').matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)) chatCss += gz(DIST + href);
  if (chatCss > CHAT_CSS_BUDGET) fail.push(`chat CSS is ${chatCss} B gzipped, over the ${CHAT_CSS_BUDGET} B budget`);
  // docs/tiered-access-design.md: "R2 first load <= 50 KB over the wire" (HTML + CSS + JS, gzipped).
  chatFirstLoad = gz(chatHtml) + chatCss + chatJs;
  if (chatFirstLoad > CHAT_FIRST_LOAD_BUDGET) fail.push(`chat first load is ${chatFirstLoad} B gzipped, over the ${CHAT_FIRST_LOAD_BUDGET} B R2 budget`);
}

// The installable shell: manifest, icons, service worker and headers have to
// agree with each other and with what the build produced. A service worker that
// precaches a file the build no longer emits fails to install, silently, and the
// app then has no offline mode: so every precache entry is checked here.
if (chatHtml) {
  const html = readFileSync(chatHtml, 'utf8');
  if (!/<link rel="manifest" href="\/chat\/manifest\.webmanifest"/.test(html)) fail.push('chat: no <link rel="manifest">');
  if (!assets.has('/chat/manifest.webmanifest')) fail.push('chat: manifest missing from the build');
  else {
    const m = JSON.parse(readFileSync(`${DIST}/chat/manifest.webmanifest`, 'utf8'));
    if (m.start_url !== '/chat/' || m.scope !== '/chat/') fail.push('chat manifest: start_url and scope must both be /chat/');
    if ('orientation' in m) fail.push('chat manifest: do not lock orientation (WCAG 1.3.4)');
    if (m.display !== 'standalone') fail.push('chat manifest: display must be standalone');
    const sizes = new Set((m.icons ?? []).map((i) => `${i.sizes}/${i.purpose}`));
    for (const want of ['192x192/any', '512x512/any', '512x512/maskable']) if (!sizes.has(want)) fail.push(`chat manifest: missing icon ${want}`);
    for (const i of m.icons ?? []) if (!assets.has(i.src)) fail.push(`chat manifest: missing icon file ${i.src}`);
  }
  if (!assets.has('/chat/sw.js')) fail.push('chat: sw.js missing (post-build did not run?)');
  else {
    const sw = readFileSync(`${DIST}/chat/sw.js`, 'utf8');
    const list = JSON.parse(sw.match(/const PRECACHE = (\[.*?\]);/)?.[1] ?? '[]');
    if (!list.includes('/chat/')) fail.push('chat sw: the shell (/chat/) is not precached');
    for (const f of list) if (!assets.has(f) && !routes.has(f)) fail.push(`chat sw: precaches ${f}, which the build did not produce`);
    if (/caches\.put\([^)]*v1\/chat/.test(sw) || /completions/.test(sw)) fail.push('chat sw: must never cache API traffic');
  }
  if (!assets.has('/_headers')) fail.push('chat: _headers missing');
  else {
    const headers = readFileSync(`${DIST}/_headers`, 'utf8');
    const csp = headers.match(/Content-Security-Policy:\s*(.+)/)?.[1] ?? '';
    if (!csp) fail.push('chat: no Content-Security-Policy on /chat/*');
    const metaApi = html.match(/<meta name="shamwari-api" content="([^"]+)"/)?.[1];
    if (!metaApi || !csp.includes(`connect-src 'self' ${new URL(metaApi).origin}`)) fail.push('chat CSP: connect-src does not name the API origin the page calls');
    if (/unsafe-(inline|eval)/.test(csp)) fail.push('chat CSP: unsafe-inline / unsafe-eval are not allowed');
    if (!/script-src 'self'(;|$)/.test(csp)) fail.push("chat CSP: script-src must be exactly 'self'");
    if (!/frame-ancestors 'none'/.test(csp)) fail.push("chat CSP: frame-ancestors 'none' missing");
  }
}

// The audience is assumed to be on a slow connection.
if (biggest > 51_200) fail.push(`largest page is ${biggest} bytes, over the 50KB budget`);

if (TARGET === 'marketing') {
  // The sitemap names only pages that were built, on the marketing origin.
  const sm = assets.has('/sitemap.xml') ? readFileSync(`${DIST}/sitemap.xml`, 'utf8') : null;
  if (!sm) fail.push('marketing build has no sitemap.xml');
  else {
    for (const [, loc] of sm.matchAll(/<loc>([^<]+)<\/loc>/g)) {
      if (!loc.startsWith(MARKETING_ORIGIN + '/')) fail.push(`sitemap.xml: ${loc} is not on ${MARKETING_ORIGIN}`);
      else if (!routes.has(new URL(loc).pathname)) fail.push(`sitemap.xml: ${loc} is not a built page`);
    }
  }
  const robots = assets.has('/robots.txt') ? readFileSync(`${DIST}/robots.txt`, 'utf8') : '';
  if (!robots.includes(`Sitemap: ${MARKETING_ORIGIN}/sitemap.xml`)) fail.push('robots.txt must point at the marketing sitemap');
  // If the chat link is on the page at all, it goes to the app origin, never a relative path.
  for (const p of pages) {
    for (const [, href] of readFileSync(p, 'utf8').matchAll(/href="([^"]*\/chat\/?[^"]*)"/g)) {
      if (href !== APP_ORIGIN + '/chat/') fail.push(`${p.slice(DIST.length)}: a chat link must be exactly ${APP_ORIGIN}/chat/, found ${href}`);
    }
  }
}

if (fail.length) {
  console.error('FAIL\n' + [...new Set(fail)].map((f) => '  - ' + f).join('\n'));
  process.exit(1);
}
console.log(
  TARGET === 'app'
    ? `ok (app) — ${pages.length} page, links and assets resolve, client JS only on /chat/ (${chatJs} B gzipped first load, budget ${CHAT_JS_BUDGET}; CSS ${chatCss} B, budget ${CHAT_CSS_BUDGET}; whole first load ${chatFirstLoad} B, budget ${CHAT_FIRST_LOAD_BUDGET}), language rules held`
    : `ok (marketing) — ${pages.length} pages, largest ${biggest} bytes, links and assets resolve, no client JS, no app files, canonical and sitemap on ${MARKETING_ORIGIN}, language rules held`,
);
