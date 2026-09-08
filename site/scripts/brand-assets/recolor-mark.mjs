#!/usr/bin/env node
// Renders scripts/brand-assets/source/bundu-node-mark-light.svg to a raster
// image and recolours it from Bundu's terracotta to a target colour,
// preserving anti-aliasing exactly instead of doing a nearest-colour swap.
//
// The source SVG is a masked/filtered embed (not flat vector paths — it's a
// raster icon wrapped for transparency), so it can't be recoloured by
// editing a `fill` attribute. Every pixel in the render is a blend of
// exactly two colours: the background and the icon's solid colour, with the
// "line" strokes just being the same colour at ~55% opacity. That means the
// coverage (alpha) of the mark at each pixel can be recovered by un-mixing
// the pixel from those two known colours, then re-composited with any new
// colour at the same alpha — which is exactly what this script does.
//
// Usage:
//   node recolor-mark.mjs <target-hex> <out-prefix>
//   node recolor-mark.mjs 283593 shamwari        # site/public/shamwari-*.png
//
// Requires `playwright` (for the SVG->PNG render) and `sharp` (for pixel
// access) as devDependencies — see package.json.

import { chromium } from 'playwright';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, 'source/bundu-node-mark-light.svg');

// Sampled directly from the source render — see the README for how.
const BG = [250, 249, 245]; // --canvas
const ORIGINAL_FG = [160, 85, 46]; // the mark's original (terracotta) colour

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

async function renderToPng(svgPath, pngPath, size = 2000) {
  // On a normal dev machine, `npx playwright install chromium` first and
  // this resolves on its own. PLAYWRIGHT_CHROMIUM_PATH is an escape hatch
  // for sandboxes that pre-install a browser at a fixed, non-default path.
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined });
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.goto(`file://${svgPath}`);
  await page.locator('svg').screenshot({ path: pngPath });
  await browser.close();
}

async function recolor(pngPath, targetRgb) {
  const image = sharp(pngPath).ensureAlpha();
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.alloc(data.length);

  for (let i = 0; i < data.length; i += info.channels) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const alphas = [
      BG[0] - ORIGINAL_FG[0] ? (BG[0] - r) / (BG[0] - ORIGINAL_FG[0]) : 0,
      BG[1] - ORIGINAL_FG[1] ? (BG[1] - g) / (BG[1] - ORIGINAL_FG[1]) : 0,
      BG[2] - ORIGINAL_FG[2] ? (BG[2] - b) / (BG[2] - ORIGINAL_FG[2]) : 0,
    ];
    const a = Math.max(0, Math.min(1, (alphas[0] + alphas[1] + alphas[2]) / 3));

    out[i] = targetRgb[0];
    out[i + 1] = targetRgb[1];
    out[i + 2] = targetRgb[2];
    out[i + 3] = Math.round(a * 255);
  }

  return sharp(out, { raw: info }).trim();
}

const [, , targetHex = '283593', outPrefix = 'shamwari-mark'] = process.argv;
const target = hexToRgb(targetHex);
const tmpPng = path.join(__dirname, '.tmp-render.png');

await renderToPng(SRC, tmpPng);
const recoloured = await recolor(tmpPng, target);
await recoloured.clone().resize(512, 512).toFile(path.join(__dirname, `${outPrefix}-512.png`));
await recoloured.clone().resize(1024, 1024).toFile(path.join(__dirname, `${outPrefix}-1024.png`));
console.log(`wrote ${outPrefix}-512.png and ${outPrefix}-1024.png (#${targetHex})`);
