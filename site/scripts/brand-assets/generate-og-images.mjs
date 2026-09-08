#!/usr/bin/env node
// Generates the four 1200x630 social-preview images in public/og/. Run
// this again whenever a page's title/description changes meaningfully, or
// to add a new page's OG image — it's design-time tooling, not part of
// `astro build`, because this is a static site with no server to render
// one per request.
//
// The hexagon backdrop is a honeycomb cluster tiled from the seven
// heritage tones (@bundu/ui/styles/tokens.css, dark-mode values — brighter,
// so they read against the sodalite background), anchored to the
// right two-thirds of the canvas. It's solid, not faded to transparent —
// legibility comes from keeping it out of the text's rectangle entirely,
// the same way the CodeRabbit OG reference keeps its grid pattern clear
// of the headline rather than fading the pattern under it.
//
// Usage: node generate-og-images.mjs
// Requires playwright (see recolor-mark.mjs for the same browser-path note).

import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '../../public/og');
const template = readFileSync(path.join(__dirname, 'og-template.html'), 'utf8');
const markPath = `file://${path.join(__dirname, '../../public/shamwari-mark-cream.png')}`;

const HERITAGE = ['#7986cb', '#e5c158', '#a1887f', '#ff7043', '#4dd0e1', '#90a4ae', '#e8d9b5'];

function hexPoints(cx, cy, r) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i);
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts.map((p) => p.join(',')).join(' ');
}

function hexGrid() {
  const r = 34;
  const colSpacing = r * 1.5;
  const rowSpacing = Math.sqrt(3) * r;
  // Hard boundary: never a hexagon left of here, so the title/description
  // rectangle stays clear regardless of the fade below. The fade itself is
  // a density gradient (fewer hexagons placed) approaching that boundary,
  // not per-hexagon transparency — every hexagon that IS drawn is fully
  // solid, same as the reference.
  const HARD_STOP = 780;
  const FADE_START = 1180; // full density at/right of this x
  let svg = '';
  // A fixed seed keeps every regeneration pixel-identical unless the
  // layout constants below change — deliberate, not a security PRNG.
  let seed = 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  for (let col = 0; col < 20; col++) {
    const cx = 1200 - col * colSpacing - 10;
    if (cx < HARD_STOP) continue;
    // Rows run from off the top edge to off the bottom edge — the pattern
    // is meant to bleed the full 630px height, not sit in a band.
    for (let row = 0; row < 14; row++) {
      const cy = row * rowSpacing + (col % 2 ? rowSpacing / 2 : 0) - r;
      if (cy > 630 + r || cy < -r) continue;
      // Linear density taper from FADE_START (dense) down to HARD_STOP
      // (empty), on top of a flat gap rate so even the densest area reads
      // as honeycomb cells rather than a solid slab.
      const fade = Math.max(0, Math.min(1, (cx - HARD_STOP) / (FADE_START - HARD_STOP)));
      const keepProbability = 0.82 * fade;
      if (rand() > keepProbability) continue;
      const color = HERITAGE[Math.floor(rand() * HERITAGE.length)];
      svg += `<polygon points="${hexPoints(cx, cy, r - 2)}" fill="${color}" />`;
    }
  }
  return svg;
}

// Keep these in sync with each page's <Layout title=... description=...>.
const pages = [
  {
    slug: 'home',
    url: 'shamwari.ai',
    eyebrow: 'Community pillar of the Bundu Ecosystem',
    title: 'A friend that serves; a friend that does not control.',
    description: 'An AI companion built in Zimbabwe, grounded in Zimbabwean law and policy.',
  },
  {
    slug: 'blueprint',
    url: 'shamwari.ai/blueprint',
    eyebrow: 'Blueprint',
    title: 'How Shamwari is built',
    description: 'Cloud, Ground and Mind — and the two rules that must not be broken.',
  },
  {
    slug: 'project',
    url: 'shamwari.ai/project',
    eyebrow: 'Project',
    title: 'Where things actually stand',
    description: "What's live, what's building, what's planned — tracked in the open on GitHub.",
  },
  {
    slug: 'contact',
    url: 'shamwari.ai/contact',
    eyebrow: 'Get in touch',
    title: 'Talk to us before you talk to a consultant',
    description: 'Bringing on the first customers by hand, mostly around Zimbabwean tax and regulatory compliance.',
  },
];

mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined });
for (const p of pages) {
  const html = template
    .replace('MARK_SRC', markPath)
    .replace('HEX_PATTERN', hexGrid())
    .replace('EYEBROW', p.eyebrow)
    .replace('TITLE', p.title)
    .replace('DESCRIPTION', p.description)
    .replace('PAGE_URL', p.url);
  const tmpFile = path.join(__dirname, `.tmp-og-${p.slug}.html`);
  writeFileSync(tmpFile, html);
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.goto(`file://${tmpFile}`, { waitUntil: 'networkidle' });
  await page.screenshot({ path: path.join(OUT_DIR, `${p.slug}.png`) });
  await page.close();
}
await browser.close();
console.log(`wrote ${pages.length} images to ${path.relative(process.cwd(), OUT_DIR)}/`);
