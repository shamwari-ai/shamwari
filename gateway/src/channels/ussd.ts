import type { ChannelAdapter } from './channel';

/**
 * USSD. Placeholder wire format, as for SMS: a signed JSON POST
 * `{sessionId, msisdn, input}` answered with `{message, end}`. One question per
 * session: an empty input opens the session with a prompt, and the question's
 * answer closes it. A screen holds about 182 characters.
 */
export const USSD_MAX_CHARS = 182;

export const ussd: ChannelAdapter = {
  channel: 'ussd',
  reach: 'r0',
  scope: 'platform',
  maxChars: USSD_MAX_CHARS,
  parse(body) {
    const b = body as { sessionId?: unknown; msisdn?: unknown; input?: unknown } | null;
    if (typeof b?.sessionId !== 'string' || !b.sessionId || b.sessionId.length > 128) return null;
    if (typeof b.msisdn !== 'string' || !b.msisdn || b.msisdn.length > 32) return null;
    return { id: b.sessionId, sender: b.msisdn, text: typeof b.input === 'string' ? b.input : '' };
  },
  greeting: (i) => (i.text.trim() ? null : { text: 'Shamwari. Type your question:', end: false }),
  render: (r) => ({ message: r.text, end: r.end }),
};
