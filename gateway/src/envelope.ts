/**
 * The compact response envelope (docs/tiered-access-design.md): what a narrow
 * channel needs and nothing else. The default response stays OpenAI-shaped; a
 * request opts in with `"format": "compact"`.
 *
 *   { id, answer, cites: [{ n, label, url? }], scope, via, truncated, degraded }
 *
 * `via` is the rung that served it (gateway, workers-ai, extractive). Usage,
 * model names, latency and language are left out: they cost bytes a 2G link
 * pays for and a feature-phone adapter never reads. On r0 the labels are
 * made plain, so an SMS adapter does not meet a dash that forces UCS-2.
 */
import { plain } from './extractive';

export const FORMATS = ['compact'] as const;
export type Format = (typeof FORMATS)[number];

export function isFormat(v: unknown): v is Format {
  return typeof v === 'string' && (FORMATS as readonly string[]).includes(v);
}

interface Verbose {
  id: string;
  choices: { message: { content: string } }[];
  shamwari: {
    scope: string;
    inference_path: string;
    truncated?: boolean;
    degraded?: boolean;
    citations: { title: string; heading: string | null; url: string | null }[];
  };
}

/** Replace what forces an SMS into UCS-2; the same set extractive.ts uses. */
export function toCompact(v: Verbose, asciiLabels = false) {
  const label = (t: string) => (asciiLabels ? plain(t) : t);
  const s = v.shamwari;
  return {
    id: v.id,
    answer: v.choices[0]?.message.content ?? '',
    cites: s.citations.map((c, i) => ({
      n: i + 1,
      label: label([c.title, c.heading].filter(Boolean).join(' - ')),
      ...(c.url ? { url: c.url } : {}),
    })),
    scope: s.scope,
    via: s.inference_path,
    truncated: s.truncated === true,
    degraded: s.degraded === true,
  };
}
