import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { skillsEnabled } from '../../src/chat/features';

describe('the Skills tab is off unless a build asks for it (shamwari#291: no SKILL.md loader yet)', () => {
  it('is off when unset, empty, misspelled or anything but the exact value true', () => {
    for (const v of [undefined, null, '', 'false', 'TRUE', 'True', '1', 'yes', ' true']) expect(skillsEnabled(v)).toBe(false);
  });

  it('is on only for exactly "true"', () => {
    expect(skillsEnabled('true')).toBe(true);
  });

  it('the page renders the Skills tab and its panel only behind the switch', () => {
    const page = readFileSync(new URL('../../app-src/pages/lite/index.astro', import.meta.url), 'utf8');
    expect(page).toContain('skillsEnabled(import.meta.env.PUBLIC_CHAT_SKILLS)');
    // Every mention of the tab and panel sits inside a {showSkills && ...} block.
    const outside = page.replace(/\{showSkills && \([\s\S]*?\)\}/g, '');
    expect(outside).not.toMatch(/tab-skills|tabpanel-skills/);
  });
});
