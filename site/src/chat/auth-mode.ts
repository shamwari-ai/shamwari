/**
 * How the chat signs people in. Mukoko sign-in (WorkOS AuthKit through the session Worker) is the DEFAULT and the only
 * mode a release is built in: a build with no setting at all must come out in it. The developer-key mode (a person pastes
 * an API key) exists for local work and for the tests of that screen, and only a build that asks for it by name
 * (PUBLIC_CHAT_AUTH=developer-key) gets it. Anything else, unset or misspelled, is Mukoko: a default that fell the other
 * way once shipped a sign-in screen that said "Mukoko sign-in is coming soon" to everyone.
 *
 * One function decides it for both the build (app-src/pages/lite/index.astro writes it into the page) and the page
 * (chat/main.ts reads it back), so they cannot disagree. test/app/auth-mode.test.ts and `node check.mjs app` hold it.
 */
export type AuthMode = 'mukoko' | 'developer-key';

export const authModeOf = (value: string | null | undefined): AuthMode => (value === 'developer-key' ? 'developer-key' : 'mukoko');
