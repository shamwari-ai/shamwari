/**
 * Byte budget, from docs/tiered-access-design.md ("Low-bandwidth protocol"):
 * answer <= 4 KB. Those figures are _assumed_ there, not measured; they live
 * here as constants so a measurement changes one file.
 */
export const BUDGET = {
  /** Largest answer the app will render or store (bytes of UTF-8). */
  maxAnswerBytes: 4 * 1024,
  /** Largest single question the app will send. */
  maxQuestionBytes: 1024,
  /** Everything waiting offline. Past this, the app says so instead of growing. */
  maxQueueBytes: 16 * 1024,
} as const;

const cpBytes = (cp: number): number => (cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4);

/** UTF-8 length without allocating an encoder per call (this runs on a low-end phone's JS thread). */
export const byteLength = (s: string): number => {
  let n = 0;
  for (const ch of s) n += cpBytes(ch.codePointAt(0)!);
  return n;
};

/** Cut on a character boundary so a multi-byte letter (Shona, Ndebele) is never split. */
export function clampBytes(s: string, max: number): { text: string; clipped: boolean } {
  if (byteLength(s) <= max) return { text: s, clipped: false };
  let out = '';
  let used = 0;
  for (const ch of s) {
    const n = cpBytes(ch.codePointAt(0)!);
    if (used + n > max) break;
    out += ch;
    used += n;
  }
  return { text: out, clipped: true };
}
