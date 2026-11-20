/**
 * Build-time switches for parts of the chat. Each says below what its default is and the one exact value that changes it;
 * unset, misspelled or anything else is the default.
 *
 * Skills (PUBLIC_CHAT_SKILLS): ON. The Skills tab reads and writes Agent Skills as SKILL.md (chat/skill.ts) and has a
 * builder (chat/skills-ui.ts), which is what shamwari-ai/shamwari#291 found missing when the tab was first hidden. Only a
 * build with exactly 'false' leaves the tab out, and then the Plugins row is a "Coming soon" row again, since Plugins and
 * MCP have nothing behind them. app-src/pages/chat/index.astro reads this; test/app/features.test.ts and
 * `node check.mjs app` hold it.
 */
export const skillsEnabled = (value: string | null | undefined): boolean => value !== 'false';
