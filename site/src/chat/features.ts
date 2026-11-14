/**
 * Build-time switches for parts of the chat that are not real yet. Each one is OFF unless a build asks for it by name
 * with the exact value 'true'; unset, misspelled or anything else is off.
 *
 * Skills (PUBLIC_CHAT_SKILLS): the drawer used to show a Skills tab, but there is no SKILL.md loader behind it, so the
 * tab promised something that does not exist (shamwari-ai/shamwari#291). It stays out of the page until a loader
 * exists. app-src/pages/lite/index.astro reads this; test/app/features.test.ts and `node check.mjs app` hold it.
 */
export const skillsEnabled = (value: string | null | undefined): boolean => value === 'true';
