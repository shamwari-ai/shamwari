// No build step, so this is the whole test suite: the checks that would
// otherwise only fail in a reader's browser.
import { readFileSync, statSync } from 'node:fs';

const html = readFileSync('public/index.html', 'utf8');
const bytes = statSync('public/index.html').size;
const fail = [];

// Every in-page link resolves to an id that exists.
const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
for (const [, href] of html.matchAll(/href="#([^"]+)"/g)) {
  if (!ids.has(href)) fail.push(`dead anchor: #${href}`);
}

// Language discipline is a project rule, not a preference — see CLAUDE.md.
// Collapse whitespace first: the permitted phrases wrap across lines in the
// source, and a per-line check would flag its own allow-list.
const flat = html.replace(/\s+/g, ' ');
const PERMITTED = [
  'not the same as being open source',
  'Say open weights, not open source',
  '\u201Can open source model\u201D',
];
for (const m of flat.matchAll(/.{60}open[ -]sourc.{60}/gi)) {
  if (!PERMITTED.some((ok) => m[0].includes(ok))) {
    fail.push(`says "open source" outside the rule that forbids it: …${m[0].slice(40, 110)}…`);
  }
}

// A colour defined only inside a media or [data-theme] block renders one
// theme's text on the other theme's ground.
const rootVars = (html.match(/:root\s*\{([^}]*)\}/) || [, ''])[1];
for (const [, name] of html.matchAll(/var\((--[a-z-]+)/g)) {
  if (!rootVars.includes(name + ':')) fail.push(`token ${name} has no base :root value`);
}

// The site's own argument is that it loads on a slow connection.
if (bytes > 40_960) fail.push(`index.html is ${bytes} bytes, over the 40KB budget`);

if (fail.length) {
  console.error('FAIL\n' + [...new Set(fail)].map((f) => '  - ' + f).join('\n'));
  process.exit(1);
}
console.log(`ok — ${bytes} bytes, ${ids.size} anchors, tokens resolve, language rule held`);
