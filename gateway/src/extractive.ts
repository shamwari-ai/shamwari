import type { GroundChunk } from './types';

/**
 * The extractive rung of the degradation ladder (docs/tiered-access-design.md).
 *
 * Retrieval alone answers: the cited passage, with no generation. It costs no
 * inference, so it is the cheapest rung, and it is what remains when every
 * inference path is down. It cannot invent a citation, because nothing here
 * writes text of its own beyond a fixed label: every word of the answer is a
 * field of a chunk Ground returned.
 *
 * Because no model wrote it, this text has no teacher model and no licence
 * class, and Ground chunks carry their own `mind_eligible` terms that the
 * gateway does not see here. So an extractive answer is never stored as a
 * conversation row and never marked trainable (see index.ts): it is metered
 * and nothing more.
 */

/** About three SMS segments of text plus a citation. Tier caps come later. */
export const EXTRACTIVE_MAX_CHARS = 480;

/** Said plainly, as the system prompt requires, when Ground has nothing. */
export const NO_SOURCE_MESSAGE =
  'I could not find this in the sources I hold, so I will not guess. Please check with the relevant authority.';

export interface ExtractiveAnswer {
  text: string;
  /** The chunks the text was built from, in order. */
  used: GroundChunk[];
}

function citation(c: GroundChunk): string {
  const where = [c.title, c.heading].filter(Boolean).join(' — ');
  const by = c.authority ? ` (${c.authority})` : '';
  const eff = c.effective_from ? `, effective ${c.effective_from}` : '';
  return `Source: ${where}${by}${eff}`;
}

/** Cut on a word boundary, never mid-word, and say so with an ellipsis. */
function clip(text: string, max: number): string {
  const t = text.trim().replace(/\s+/g, ' ');
  if (t.length <= max) return t;
  const cut = t.slice(0, Math.max(0, max - 1));
  const at = cut.lastIndexOf(' ');
  return `${(at > max * 0.5 ? cut.slice(0, at) : cut).trimEnd()}…`;
}

/**
 * Build an answer from the best chunk, adding further chunks only while they
 * fit. The first chunk is always included, clipped if it must be, together
 * with its citation: an answer with no source is never produced.
 */
export function extractiveAnswer(
  chunks: GroundChunk[],
  maxChars: number = EXTRACTIVE_MAX_CHARS,
): ExtractiveAnswer | null {
  const first = chunks[0];
  if (!first) return null;

  const cite = citation(first);
  const room = Math.max(40, maxChars - cite.length - 2);
  const parts: string[] = [`${clip(first.content, room)}\n${cite}`];
  const used: GroundChunk[] = [first];

  for (const c of chunks.slice(1)) {
    const next = `${clip(c.content, room)}\n${citation(c)}`;
    const total = [...parts, next].join('\n\n').length;
    if (total > maxChars) break;
    parts.push(next);
    used.push(c);
  }

  return { text: parts.join('\n\n'), used };
}
