#!/usr/bin/env node
// PWA install icons for /chat/, made from the existing brand assets: 192 and
// 512 "any" icons from shamwari-icon.png, and a 512 maskable icon (the mark on
// a full sodalite square, inside the 80% safe zone). Run once; the PNGs are
// committed. They are fetched only at install time, never on first load.
import sharp from 'sharp';

const out = (n) => new URL(`../../public/chat/icons/${n}`, import.meta.url).pathname;
const src = new URL('../../public/shamwari-icon.png', import.meta.url).pathname;
const mark = new URL('../../public/shamwari-mark-cream.png', import.meta.url).pathname;
const png = { compressionLevel: 9, palette: true };

for (const size of [192, 512]) await sharp(src).resize(size, size).png(png).toFile(out(`icon-${size}.png`));

const SODALITE = { r: 0x28, g: 0x35, b: 0x93, alpha: 1 };
const inner = Math.round(512 * 0.6);
const glyph = await sharp(mark).resize(inner, inner).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 4, background: SODALITE } })
  .composite([{ input: glyph, gravity: 'center' }])
  .png(png)
  .toFile(out('maskable-512.png'));
