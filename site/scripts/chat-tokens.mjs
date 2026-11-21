// The chat's design tokens: the few Mzizi custom properties Shamwari Chat uses, taken from @bundu/ui at build time.
//
// The chat used to import all of @bundu/ui's tokens.css, color-scheme.css and density.css (every mineral, heritage tone,
// status, tier and chart colour, about 13 KB gzipped) and then Tailwind on top, for a page that uses about thirty values.
// This reads the same files and writes only the properties the chat names (and the ones those refer to), with their
// values unchanged, for light, dark (following the device, or data-theme), the brand overlay and the Bundu floor.
//
//   node scripts/chat-tokens.mjs           write src/chat/tokens.css
//   node scripts/chat-tokens.mjs --check   fail if src/chat/tokens.css is not what @bundu/ui says (CI, test/app/tokens.test.ts)
//
// Change a value in @bundu/ui (the registry), not in the output.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '../src/chat/tokens.css');

/** What the chat's CSS names. Anything these refer to with var() comes along. */
export const WANTED = [
  '--background',
  '--foreground',
  '--card',
  '--muted',
  '--muted-foreground',
  '--border',
  '--border-control',
  '--input',
  '--primary',
  '--primary-foreground',
  '--ring',
  '--destructive',
  '--destructive-text',
  '--info',
  '--color-sodalite',
  '--color-sodalite-container',
  '--color-sodalite-on-container',
  '--radius-sm',
  '--radius-md',
];
/** The Bundu floor (density.css): sizes, never colours. */
export const FLOOR = [
  '--fs-body',
  '--fs-small',
  '--fs-caption',
  '--lh-body',
  '--target-floor',
  '--inset-floor',
  '--gap-floor',
  '--leading-floor',
  '--control-floor',
  '--size-control-sm',
  // The spacing layers (Bundu floor 1.1.0, owner 2026-11-19): each layer's default and dense floor.
  '--space-page-x',
  '--space-page-x-wide-dense',
  '--space-container',
  '--space-container-dense',
  '--space-container-gap',
  '--space-container-gap-dense',
  '--space-card-dense',
  '--space-card-gap',
  '--space-control-x',
  '--space-control-x-dense',
  '--space-field-x',
  '--space-field-x-dense',
  '--space-control-gap',
  '--space-control-gap-dense',
  '--space-control-between',
  '--space-chip-x-dense',
  '--space-label-gap',
];

const require = createRequire(import.meta.url);
const styles = dirname(require.resolve('@bundu/ui/styles/tokens.css'));
const read = (f) => readFileSync(join(styles, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const version = JSON.parse(readFileSync(join(styles, '../package.json'), 'utf8')).version;

/** The custom properties declared in the first block whose selector matches `selector`. */
function block(css, selector) {
  const at = css.indexOf(selector);
  if (at < 0) throw new Error(`chat-tokens: no ${selector} block`);
  const open = css.indexOf('{', at);
  let depth = 0;
  let end = open;
  for (; end < css.length; end++) {
    if (css[end] === '{') depth++;
    else if (css[end] === '}' && --depth === 0) break;
  }
  const props = new Map();
  for (const m of css.slice(open + 1, end).matchAll(/(--[\w-]+)\s*:\s*([^;{}]+);/g)) props.set(m[1], m[2].trim().replace(/\s+/g, ' '));
  return props;
}

/** `names` and everything they refer to, in a stable order. */
function close(names, ...sources) {
  const out = new Map();
  const add = (n) => {
    if (out.has(n)) return;
    const v = sources.map((s) => s.get(n)).find((x) => x !== undefined);
    if (v === undefined) throw new Error(`chat-tokens: ${n} is not defined in @bundu/ui`);
    out.set(n, v);
    for (const [, dep] of v.matchAll(/var\(\s*(--[\w-]+)/g)) add(dep);
  };
  names.forEach(add);
  return out;
}

export function generate() {
  const tokens = read('tokens.css');
  const density = read('density.css');
  const brand = read('brand-shamwari.css');
  const lightAll = block(tokens, ':root');
  const darkAll = block(tokens, '[data-theme="dark"]');
  const brandLight = block(brand, ':root');
  // The overlay comes last, so it wins: --primary and --ring are sodalite.
  // A dark value can refer to a property the light ones do not (dark --card is var(--surface)): close over both until stable.
  let names = WANTED;
  let light;
  let dark;
  for (;;) {
    light = close(names, brandLight, lightAll);
    dark = new Map();
    for (const n of light.keys()) {
      const v = brandLight.get(n) ?? darkAll.get(n);
      if (v !== undefined && v !== light.get(n)) dark.set(n, v);
    }
    const more = [...dark.values()].flatMap((v) => [...v.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1])).filter((n) => !light.has(n));
    if (!more.length) break;
    names = [...names, ...more];
  }
  const floor = close(FLOOR, block(density, ':root'));
  const desktopAt = density.indexOf('@media (min-width: 64rem) and (pointer: fine)');
  const desktopAll = block(density.slice(desktopAt), ':root');
  const desktop = new Map([...desktopAll].filter(([n]) => floor.has(n)));
  const decl = (m, pad = '  ') => [...m].map(([n, v]) => `${pad}${n}: ${v};`).join('\n');
  return `/* GENERATED by scripts/chat-tokens.mjs from @bundu/ui ${version}. Do not edit: change the registry, then run it again.
   Only what the chat uses, with Mzizi's own values: light, dark (the device's choice, or data-theme), the Shamwari brand
   overlay (--primary and --ring are sodalite) and the Bundu floor 1.1.0 (17px body on touch and 15px with a mouse, 14px
   text, a hit region of 45px on touch and 24px with a mouse, 14px inset, 7px gaps, 1.5 leading; controls drawn at 33px
   only with a mouse from 64rem, never under 28px). */
:root {
  color-scheme: light dark;
${decl(light)}
${decl(floor)}
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
    color-scheme: dark;
${decl(dark, '    ')}
  }
}
:root[data-theme='dark'] {
  color-scheme: dark;
${decl(dark)}
}
:root[data-theme='light'] {
  color-scheme: light;
}
@media (min-width: 64rem) and (pointer: fine) and (hover: hover) and (not (any-pointer: coarse)) {
  :root {
${decl(desktop, '    ')}
  }
}
`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const css = generate();
  if (process.argv.includes('--check')) {
    if (readFileSync(OUT, 'utf8') !== css) {
      console.error('src/chat/tokens.css is not what @bundu/ui says: run node scripts/chat-tokens.mjs');
      process.exit(1);
    }
    console.log('ok: src/chat/tokens.css matches @bundu/ui');
  } else {
    writeFileSync(OUT, css);
    console.log(`wrote src/chat/tokens.css (${css.length} bytes)`);
  }
}
