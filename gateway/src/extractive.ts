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
 * It does not judge relevance. Ground returns the nearest passages whether or
 * not they answer the question, so the citation line says "Closest source",
 * which is true, rather than "Source", which would claim the passage answers it.
 * A relevance threshold needs a score from Ground and an eval set to calibrate
 * it; see docs/tiered-access-design.md.
 *
 * Because no model wrote it, this text has no teacher model and no licence
 * class, and Ground chunks carry their own `mind_eligible` terms that the
 * gateway does not see here. So an extractive answer is never stored as a
 * conversation and never marked trainable (see index.ts): it is metered and
 * nothing more.
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
  /** A passage was cut short. The full text is at the citation's source. */
  truncated: boolean;
}

/** Core fills this in when a field is missing. It names nothing, so it is not cited. */
const PLACEHOLDER_AUTHORITY = 'Unknown';

function citation(c: GroundChunk, max: number): string {
  const where = [c.title, c.heading].filter(Boolean).join(' — ');
  const by = c.authority && c.authority !== PLACEHOLDER_AUTHORITY ? ` (${c.authority})` : '';
  const eff = c.effective_from ? `, effective ${c.effective_from}` : '';
  return clip(`Closest source: ${where}${by}${eff}`, max).text;
}

/**
 * Cut on a word boundary, never mid-word, and say so with an ellipsis. Line
 * breaks are kept: they carry the numbering of subsections, and losing them
 * can merge a rule into its exception.
 */
function clip(text: string, max: number): { text: string; truncated: boolean } {
  const t = text
    .trim()
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n');
  if (t.length <= max) return { text: t, truncated: false };
  const cut = t.slice(0, Math.max(0, max - 1));
  const at = Math.max(cut.lastIndexOf(' '), cut.lastIndexOf('\n'));
  return { text: `${(at > max * 0.5 ? cut.slice(0, at) : cut).trimEnd()}…`, truncated: true };
}

/**
 * Build an answer from the best chunk, adding further chunks only while they
 * fit. The first chunk is always included, clipped if it must be, together
 * with its citation: an answer with no source is never produced. The whole
 * answer, citation included, stays within `maxChars`.
 */
export function extractiveAnswer(
  chunks: GroundChunk[],
  maxChars: number = EXTRACTIVE_MAX_CHARS,
): ExtractiveAnswer | null {
  const first = chunks[0];
  if (!first) return null;

  // The citation may take at most 40% of the budget, so a very long title
  // cannot push the answer over the limit or crowd out the passage.
  const citeMax = Math.floor(maxChars * 0.4);
  const cite = citation(first, citeMax);
  const room = Math.max(20, maxChars - cite.length - 1);
  const head = clip(first.content, room);
  const parts: string[] = [`${head.text}\n${cite}`];
  const used: GroundChunk[] = [first];
  let truncated = head.truncated;

  for (const c of chunks.slice(1)) {
    const body = clip(c.content, room);
    const next = `${body.text}\n${citation(c, citeMax)}`;
    if ([...parts, next].join('\n\n').length > maxChars) break;
    parts.push(next);
    used.push(c);
    truncated = truncated || body.truncated;
  }

  return { text: parts.join('\n\n'), used, truncated };
}
