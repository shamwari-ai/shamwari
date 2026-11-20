import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { skillsEnabled } from '../../src/chat/features';

describe('the Skills tab is on unless a build turns it off (a SKILL.md reader and builder exist: chat/skill.ts, chat/skills-ui.ts)', () => {
  it('is on when unset, empty, misspelled or anything but the exact value false', () => {
    for (const v of [undefined, null, '', 'true', 'TRUE', 'False', '0', 'no', ' false']) expect(skillsEnabled(v)).toBe(true);
  });

  it('is off only for exactly "false"', () => {
    expect(skillsEnabled('false')).toBe(false);
  });

  it('the page renders the Skills tab, its panel, and the Plugins row that opens them only behind the switch', () => {
    const page = readFileSync(new URL('../../app-src/pages/chat/index.astro', import.meta.url), 'utf8');
    expect(page).toContain('skillsEnabled(import.meta.env.PUBLIC_CHAT_SKILLS)');
    // Every mention of the tab and panel sits inside a {showSkills && ...} block, and the opening row in a {showSkills ? ...} one.
    const outside = page.replace(/\{showSkills && \([\s\S]*?\)\}/g, '').replace(/\{showSkills\s*\n\s*\?[\s\S]*?\)\}/g, '');
    expect(outside).not.toMatch(/tab-skills"|tabpanel-skills"|data-section="plugins"/);
  });

  it('no comment in the chat still says there is no SKILL.md loader', () => {
    for (const f of ['../../app-src/pages/chat/index.astro', '../../src/chat/features.ts', '../../src/chat/plugins.ts', '../../check.mjs']) {
      expect(readFileSync(new URL(f, import.meta.url), 'utf8'), f).not.toMatch(/no SKILL\.md loader|until a SKILL\.md loader|until a loader exists/i);
    }
  });
});
