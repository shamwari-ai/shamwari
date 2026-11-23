// Rule 1 at the client (AGENTS.md): a personal-scope skill never leaves the device, and a question asked with one on is
// personal scope. chat/skills.ts decides what a question carries; the gateway's half is in
// gateway/test/scope-decision.test.ts ("skills: ...").
import { describe, expect, it } from 'vitest';
import { memoryStore, type SkillRecord, type Store } from '../../src/chat/store';
import { requestFields, skillsForAsk } from '../../src/chat/skills';
import { writeSkillMd } from '../../src/chat/skill';
import { createClient } from '../../src/chat/client';

const rec = (id: string, scope: SkillRecord['scope'], source: SkillRecord['source'] = scope === 'personal' ? 'personal' : 'plugin'): SkillRecord => ({
  id,
  source,
  scope,
  skillMd: writeSkillMd({ name: `skill-${id}`, description: `Does ${id}.`, body: `Instructions for ${id}.` }),
  createdAt: 1,
  updatedAt: 1,
});

async function storeWith(...skills: SkillRecord[]): Promise<Store> {
  const s = memoryStore();
  for (const k of skills) await s.putSkill(k);
  return s;
}

describe('what a question asked now carries', () => {
  it('a personal skill on: the question is personal, and no skill is carried for sending', async () => {
    const s = await storeWith(rec('p', 'personal'), rec('g', 'platform'));
    expect(await skillsForAsk(s, ['p', 'g'])).toEqual({ skills: ['g'], ownInformation: true });
    expect(await skillsForAsk(s, ['p'])).toEqual({ skills: [], ownInformation: true });
  });

  it('an imported skill keeps the scope chosen at import', async () => {
    const s = await storeWith(rec('a', 'personal', 'plugin'), rec('b', 'platform', 'plugin'));
    expect((await skillsForAsk(s, ['a'])).ownInformation).toBe(true);
    expect(await skillsForAsk(s, ['b'])).toEqual({ skills: ['b'], ownInformation: false });
  });

  it('a skill deleted since is simply not on', async () => {
    const s = await storeWith(rec('g', 'platform'));
    expect(await skillsForAsk(s, ['gone', 'g'])).toEqual({ skills: ['g'], ownInformation: false });
  });

  it('fails closed: skills that cannot be read make the question personal', async () => {
    const broken = { skills: async () => Promise.reject(new Error('IndexedDB closed')) };
    expect(await skillsForAsk(broken, ['anything'])).toEqual({ skills: [], ownInformation: true });
  });
});

describe('what the request sends for a question\'s skills', () => {
  it('platform skills: name, description and instructions, read from the SKILL.md', async () => {
    const s = await storeWith(rec('g', 'platform'));
    expect(await requestFields(s, ['g'])).toEqual({ skills: [{ name: 'skill-g', description: 'Does g.', instructions: 'Instructions for g.' }] });
  });

  it('never a personal one: if one is among them, only the flag goes, and no skill text at all', async () => {
    const s = await storeWith(rec('g', 'platform'), rec('p', 'personal'));
    const out = await requestFields(s, ['g', 'p']);
    expect(out).toEqual({ own_information: true });
    expect(JSON.stringify(out)).not.toContain('Instructions for');
  });

  it('nothing when every skill has been deleted since', async () => {
    expect(await requestFields(await storeWith(), ['gone'])).toEqual({});
  });

  it('throws when the skills cannot be read, so the question waits rather than going without them', async () => {
    await expect(requestFields({ skills: async () => Promise.reject(new Error('x')) }, ['g'])).rejects.toThrow();
  });

  it('the client sends the fields as they are, beside the messages', async () => {
    let sent: Record<string, unknown> = {};
    const client = createClient({
      baseUrl: 'https://api.example',
      getKey: () => 'k',
      fetch: async (_u, init) => {
        sent = JSON.parse(String(init?.body));
        return Response.json({ id: 'x', choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }], shamwari: {} });
      },
    });
    await client.ask({ messages: [{ role: 'user', content: 'q' }], own_information: true });
    expect(sent).toMatchObject({ own_information: true, reach: 'r2' });
    expect(sent).not.toHaveProperty('skills');
  });
});

describe('skills on this device', () => {
  it('are kept as self-contained records: the SKILL.md text, source, scope, id and timestamps', async () => {
    const s = await storeWith(rec('a', 'personal'));
    const [k] = await s.skills();
    expect(Object.keys(k!).sort()).toEqual(['createdAt', 'id', 'scope', 'skillMd', 'source', 'updatedAt']);
    expect(k!.skillMd.startsWith('---\nname: skill-a\n')).toBe(true);
  });

  it('are not removed by deleting chat history', async () => {
    const s = await storeWith(rec('a', 'personal'));
    await s.clear();
    expect(await s.skills()).toHaveLength(1);
    await s.removeSkill('a');
    expect(await s.skills()).toHaveLength(0);
  });
});
