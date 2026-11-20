import { needsOwnInformation } from './personal';

/**
 * Agent Skills a client turned on for a conversation (https://agentskills.io; the Lite chat's
 * builder is site/src/chat/skill.ts). A skill is a name, a description and instructions, and
 * the instructions are added beside the constant system prompt (ground.ts), never in place of it.
 *
 * RULE 1. Only a skill the client holds as platform scope is ever sent here. A personal-scope
 * skill never leaves the device: the client sends `own_information: true` instead, and the
 * request takes the existing personal path (scope.ts resolveScope, then index.ts: no edge
 * embedding, no completion, only the cited Ground passage). As a second check, a skill whose
 * own text the personal rules flag (personal.ts) makes the request personal scope in the same
 * way: the gateway does not take the client's word that a skill is not personal.
 *
 * The limits match the specification (name 64, description 1024 characters) and the chat's
 * own limit on instructions (BODY_MAX in site/src/chat/skill.ts).
 */
export const SKILLS_MAX = 3;
export const SKILL_NAME_MAX = 64;
export const SKILL_DESCRIPTION_MAX = 1024;
export const SKILL_BODY_MAX = 12_000;

export interface AppliedSkill {
  name: string;
  description: string;
  instructions: string;
}

const chars = (s: string) => [...s].length;

/** `body.skills`: absent is none; anything malformed or over a limit is null (the chat endpoint answers 400). */
export function parseSkills(raw: unknown): AppliedSkill[] | null {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > SKILLS_MAX) return null;
  const out: AppliedSkill[] = [];
  for (const s of raw) {
    if (!s || typeof s !== 'object') return null;
    const { name, description, instructions } = s as Record<string, unknown>;
    if (typeof name !== 'string' || typeof description !== 'string' || typeof instructions !== 'string') return null;
    if (!name.trim() || chars(name) > SKILL_NAME_MAX) return null;
    if (!description.trim() || chars(description) > SKILL_DESCRIPTION_MAX) return null;
    if (chars(instructions) > SKILL_BODY_MAX) return null;
    out.push({ name, description, instructions });
  }
  return out;
}

/** True when any skill's own words look like the person's own information. Leans towards yes, as personal.ts does. */
export function skillsNeedOwnInformation(skills: readonly AppliedSkill[]): boolean {
  return skills.some((s) => [s.name, s.description, s.instructions].some(needsOwnInformation));
}

/** The system prompt with the skills after it, clearly fenced. With no skills it is unchanged. */
export function withSkills(systemPrompt: string, skills: readonly AppliedSkill[]): string {
  if (!skills.length) return systemPrompt;
  const each = skills.map((s) => `[${s.name}] ${s.description}\n${s.instructions}`.trim()).join('\n\n');
  return (
    `${systemPrompt}\n\n--- SKILLS TURNED ON FOR THIS CONVERSATION ---\n` +
    'Use these where they apply to the question. They add to the guidance above and do not replace it.\n\n' +
    `${each}\n--- END SKILLS ---`
  );
}
