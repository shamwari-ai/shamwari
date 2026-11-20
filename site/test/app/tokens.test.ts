import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FLOOR, WANTED, generate } from '../../scripts/chat-tokens.mjs';

// The chat's tokens are generated from @bundu/ui (scripts/chat-tokens.mjs). If the package changes a value, or someone edits the
// output by hand, this fails until the generator is run again.
describe('chat tokens', () => {
  const css = readFileSync(new URL('../../src/chat/tokens.css', import.meta.url), 'utf8');

  it('is exactly what @bundu/ui says', () => {
    expect(css).toBe(generate());
  });

  it('has every token the chat names, in light, and dark under the device scheme and data-theme', () => {
    for (const name of [...WANTED, ...FLOOR] as string[]) expect(css, name).toContain(`${name}:`);
    expect(css).toContain("@media (prefers-color-scheme: dark)");
    expect(css).toContain(":root:not([data-theme='light'])");
    expect(css).toContain(":root[data-theme='dark']");
  });

  it('keeps the Bundu floor and the Shamwari brand overlay', () => {
    // The Bundu floor 1.1.0 (owner, 2026-11-19): a 45px hit region on touch, 24px with a fine pointer from 64rem.
    expect(css).toMatch(/:root \{[^}]*--target-floor: 2\.8125rem;/); // 45px on touch
    expect(css).toMatch(/--target-floor: 1\.5rem;/); // 24px with a mouse
    expect(css).toMatch(/--control-floor: 1\.75rem;/); // never drawn under 28px with a mouse
    expect(css).toMatch(/--inset-floor: 0\.875rem;/);
    expect(css).toMatch(/--gap-floor: 0\.4375rem;/);
    expect(css).toMatch(/--leading-floor: 1\.5;/);
    expect(css).toMatch(/--primary: var\(--color-sodalite\);/);
    expect(css).toMatch(/--ring: var\(--color-sodalite\);/);
  });

  it('is what the chat stylesheet imports, and the chat no longer pulls in Tailwind or all of @bundu/ui', () => {
    const chat = readFileSync(new URL('../../src/chat/chat.css', import.meta.url), 'utf8');
    expect(chat).toContain("@import './tokens.css';");
    expect(chat).not.toMatch(/@import ['"](tailwindcss|@bundu\/ui)/);
  });
});
