/**
 * Does a question need the user's OWN information? (shamwari-ai/shamwari#81)
 *
 * The server decides this, never the user: there is no scope dropdown and a
 * client-sent scope is not read (scope.ts, resolveScope). This is the first
 * version of that decision. It is a short list of deterministic rules, no
 * model, and it is deliberately conservative: when in doubt it says yes.
 *
 * WHAT THIS IS AND IS NOT
 * -----------------------
 * It is an honesty control. When it says yes and the answer can only be given
 * from community and platform knowledge, the response carries "answered
 * without your own information" so a person is never left thinking the
 * answer used their own data.
 *
 * It is NOT the privacy control. A wrong answer here, in either direction,
 * cannot send personal-layer content to a provider: Cloud never holds any, and
 * the scope sent to a provider is community or platform whatever this says
 * (scope.ts, providerScope). A false negative means the notice is missing on
 * one answer, so the rules lean towards a false positive.
 *
 * The same rules, word for word, live in core/personal.py. Core's copy is
 * authoritative for what it returns and the gateway's is the fast path.
 * core/scope_cases.json holds the cases both suites run, so the two cannot
 * drift apart without a test failing.
 *
 * LANGUAGES
 * ---------
 * English, Shona and Ndebele. The Shona and Ndebele rules are possessive
 * suffixes and a few first-person verb forms. No native speaker has reviewed
 * them yet; treat them as a starting point that errs towards flagging.
 */

/**
 * What a client may see as one line. Plain ASCII, so it survives every channel.
 *
 * It says what actually happened (shamwari-ai/shamwari#291). A question this file flags is
 * treated as personal scope: it is not sent to any hosted model, including the
 * Cloudflare-hosted embedding, and the answer is the cited Ground passage with nothing
 * generated (index.ts). The earlier wording promised on-device Mind, which has not shipped.
 */
export const OWN_INFORMATION_NOTICE =
  'Answered without your own information, from public sources only. It looks personal, so it was not sent to an AI model.';

/** For SMS and USSD, where every character is billed and a segment is 160. */
export const OWN_INFORMATION_NOTICE_SHORT =
  'Answered without your own info. Not sent to an AI: public sources only.';

/** For a screen of about 180 characters (USSD): the marker alone, so the answer keeps its room. */
export const OWN_INFORMATION_NOTICE_MIN = 'Answered without your own info.';

/** Stable machine-readable name for the notice. Clients key their rendering on this. */
export const OWN_INFORMATION_CODE = 'answered_without_your_own_information';

// Whole-word match that also works next to apostrophes and non-ASCII letters.
const W = (body: string) => new RegExp(`(?<![\\p{L}\\p{N}_])(?:${body})(?![\\p{L}\\p{N}_])`, 'u');

const RULES: RegExp[] = [
  // English: possessives and first-person contractions.
  W("my|mine|myself|our|ours|ourselves|i'm|i've|i'll|i'd|im|ive"),
  // English: "I" followed by something that is about the speaker's own situation.
  // A bare "I" is not enough ("Can I vote?" is a general question).
  W(
    'i (?:am|was|own|owe|earn|paid|pay|receive|received|lost|bought|sold|saved|spent|uploaded)',
  ),
  // "I have 3 rental properties", "I make $900": a first-person verb near a number or currency.
  W('i (?:have|had|get|got|make|made|need) [^.?!]{0,20}?(?:\\$|\\d)'),
  W('i get paid|i work (?:at|for|as)'),
  W('(?:about|for|to|on|with|from) me'),
  // English: things only the person holds.
  W('payslips?|bank statements?|medical records?'),
  // Shona: possessive -ngu (wangu, yangu, dzangu, changu, zvangu, rangu, vangu, kwangu, pangu, ...) and "ini".
  W('(?:w|y|dz|ch|zv|r|v|kw|p|rw|tw|bw|sw)angu|ini'),
  // Shona: first-person verbs (ndiri, ndine, ndakabhadhara, ndichada, ndinoda, ndiku...).
  W('ndiri|ndine|nda[ck]a[\\p{L}\\p{N}_]*|ndichi[\\p{L}\\p{N}_]*|ndino[\\p{L}\\p{N}_]*|ndiku[\\p{L}\\p{N}_]*'),
  // Ndebele: possessive -mi (wami, yami, lami, zami, sami, bami, kwami) and "mina".
  W('(?:w|y|l|z|s|b|kw)ami|mina'),
  // Ndebele: first-person verbs.
  W('ngine|ngikhokhile|ngisebenza|ngihlala|ngiyakhokha'),
];

/** Fold the cheap evasions: width and case, curly apostrophes, zero-width characters. */
export function normalise(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[​-‍⁠﻿]/g, '')
    .replace(/[‘’ʼ`]/g, "'")
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function needsOwnInformation(text: string): boolean {
  const t = normalise(text);
  return RULES.some((r) => r.test(t));
}

/**
 * Looks at the latest two user turns. The latest alone would miss "and how
 * much tax is that?" straight after "my salary is...".
 */
export function conversationNeedsOwnInformation(messages: { role: string; content: string }[]): boolean {
  const users = messages.filter((m) => m.role === 'user').slice(-2);
  return users.some((m) => needsOwnInformation(m.content));
}
