import type { ChannelAdapter } from './channel';

/**
 * SMS. The wire format is a placeholder until an operator or aggregator is
 * chosen (docs/tiered-access-design.md, open decisions): a signed JSON POST
 * `{id, from, text}` answered with `{reply}`. Another operator's shape changes
 * `parse` and `render` only; the gate and the pipeline stay in channel.ts.
 *
 * 459 characters is three concatenated GSM-7 segments (3 x 153). Replies are
 * plain ASCII so one curly quote does not push the message into UCS-2.
 */
export const SMS_MAX_CHARS = 459;

const str = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.length > 0 && v.length <= max ? v : null;

export const sms: ChannelAdapter = {
  channel: 'sms',
  reach: 'r0',
  scope: 'platform',
  maxChars: SMS_MAX_CHARS,
  parse(body) {
    const b = body as { id?: unknown; from?: unknown; text?: unknown } | null;
    const id = str(b?.id, 128);
    const sender = str(b?.from, 32);
    if (!id || !sender || typeof b?.text !== 'string') return null;
    return { id, sender, text: b.text };
  },
  render: (r) => ({ reply: r.text }),
};
