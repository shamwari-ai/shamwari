// Why an answer could not be given, in a form that can travel to the app.
//
// Before this, each inference step logged a bare status ("gateway 424") and the caller answered
// `inference_unavailable`, so a person, and the owner, saw "having trouble" while AI Gateway was
// saying exactly what was wrong ("Prompt blocked due to security configurations", 2026-11-23). Each
// step now records a reason, and the 503 carries them with the request id that finds the logs.
//
// What leaves the Worker is cleaned first: no URLs (they carry the account id), no long hex or
// token-like strings, at most MESSAGE_MAX characters, at most REASONS_MAX entries. The repository and
// the API are public; a reason says what failed, never a credential or an internal address.

export type FailureStep = 'ai-gateway' | 'workers-ai' | 'core' | 'worker';

export interface StepFailure {
  /** Which step failed, in the order they were tried. */
  step: FailureStep;
  /** The upstream HTTP status, when there was one. */
  status?: number;
  /** The upstream's own error code (AI Gateway's internalCode, e.g. 2016), when it gave one. */
  code?: number | string;
  /** What the upstream said, cleaned (see clean()). */
  message: string;
}

export const MESSAGE_MAX = 200;
export const REASONS_MAX = 5;

/** A message safe to show: no URLs, no long hex ids or tokens, one line, bounded. */
export function clean(raw: unknown): string {
  let s = typeof raw === 'string' ? raw : raw instanceof Error ? raw.message : String(raw ?? '');
  s = s
    .replace(/\bhttps?:\/\/\S+/gi, '[url]')
    .replace(/\b(?:Bearer|Basic)\s+\S+/gi, '[credential]')
    .replace(/\b[0-9a-f]{24,}\b/gi, '[id]')
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, '[token]')
    .replace(/\s+/g, ' ')
    .trim();
  if (s.length > MESSAGE_MAX) s = `${s.slice(0, MESSAGE_MAX - 1)}…`;
  return s || 'no detail given';
}

/**
 * Read an upstream error body for its code and message. AI Gateway answers
 * `{ error: [{ code, message }], internalCode, message }`; OpenAI-style bodies answer
 * `{ error: { code, message } }`. Anything else is kept as text.
 */
export function fromBody(step: FailureStep, status: number, body: string): StepFailure {
  let code: number | string | undefined;
  let message: string | undefined;
  try {
    const j = JSON.parse(body) as Record<string, unknown>;
    const e = j.error;
    const first = Array.isArray(e) ? (e[0] as Record<string, unknown> | undefined) : e && typeof e === 'object' ? (e as Record<string, unknown>) : undefined;
    const c = j.internalCode ?? first?.code;
    if (typeof c === 'number' || typeof c === 'string') code = c;
    const m = j.message ?? first?.message ?? (typeof e === 'string' ? e : undefined);
    if (typeof m === 'string') message = m;
  } catch {
    message = body;
  }
  return { step, status, ...(code !== undefined ? { code } : {}), message: clean(message || `HTTP ${status}`) };
}

/** A thrown error as a failure of `step`. */
export function fromError(step: FailureStep, e: unknown): StepFailure {
  return { step, message: clean(e) };
}

/** Every inference step failed. Carries what each one said. */
export class InferenceFailed extends Error {
  constructor(readonly failures: StepFailure[]) {
    super(`every inference step failed: ${failures.map((f) => `${f.step}${f.status ? ` ${f.status}` : ''}: ${f.message}`).join('; ')}`);
    this.name = 'InferenceFailed';
  }
}

/** The reasons as they go out: bounded in number, each already cleaned. */
export function publicReasons(failures: StepFailure[]): StepFailure[] {
  return failures.slice(0, REASONS_MAX).map((f) => ({ ...f, message: clean(f.message) }));
}
