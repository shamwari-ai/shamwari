/**
 * Which skills a question carries, and what its request sends for them. Loaded only when a chat has a skill on, so the
 * chat's first load does not carry it (or the SKILL.md reader).
 *
 * RULE 1 (AGENTS.md). A personal-scope skill never leaves this device. A question asked while one is on is marked
 * `ownInformation`, and its request says `own_information: true` and carries no skill at all: the gateway then treats
 * it as personal scope, the same path as a question its own rules flag (gateway/src/scope.ts resolveScope, index.ts):
 * no edge embedding, no completion, only the cited Ground passage. Only platform-scope skills are ever sent.
 */
import { parseSkillMd } from './skill';
import type { SkillRecord, Store } from './store';
import type { ChatRequest } from './types';

/**
 * Skills Shamwari publishes: the same self-contained record as the person's own, read-only, never stored per person.
 * None is published yet; which ones to publish is the owner's call (docs/chat-app.md).
 */
/** How many skills can be on in one chat at once (each on skill travels with every question). */
export const SKILLS_ON_MAX = 3;

export const PLATFORM_SKILLS: readonly SkillRecord[] = [];

/** Every skill this person can turn on: Shamwari's, then their own. */
export async function allSkills(store: Pick<Store, 'skills'>): Promise<SkillRecord[]> {
  return [...PLATFORM_SKILLS, ...(await store.skills())];
}

/**
 * What a question asked now carries, from the skills on in its chat. A skill deleted since is simply not on. If the
 * skills cannot be read at all, the question is treated as personal: it fails closed, never open.
 */
export async function skillsForAsk(store: Pick<Store, 'skills'>, ids: readonly string[]): Promise<{ skills: string[]; ownInformation: boolean }> {
  try {
    const all = await allSkills(store);
    const on = ids.map((id) => all.find((k) => k.id === id)).filter((k): k is SkillRecord => !!k);
    return { skills: on.filter((k) => k.scope === 'platform').map((k) => k.id), ownInformation: on.some((k) => k.scope !== 'platform') };
  } catch {
    return { skills: [], ownInformation: true };
  }
}

/**
 * The request fields for a question's platform skills. A skill deleted since is left out. Should one of them somehow be
 * personal scope, nothing of any skill is sent and the question goes as personal. Throws if the skills cannot be read:
 * the question then waits, rather than going without the skills it was asked with.
 */
export async function requestFields(store: Pick<Store, 'skills'>, ids: readonly string[]): Promise<Pick<ChatRequest, 'own_information' | 'skills'>> {
  const all = await allSkills(store);
  const skills: NonNullable<ChatRequest['skills']> = [];
  for (const id of ids) {
    const k = all.find((x) => x.id === id);
    if (!k) continue;
    if (k.scope !== 'platform') return { own_information: true };
    const p = parseSkillMd(k.skillMd);
    if (p.ok) skills.push({ name: p.skill.name, description: p.skill.description, instructions: p.skill.body });
  }
  return skills.length ? { skills } : {};
}
