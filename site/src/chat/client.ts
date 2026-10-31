import type { Answer, AskError, ChatRequest, ChatResponse, Citation, Result } from './types';

export interface ClientConfig {
  /** e.g. https://api.shamwari.ai — no trailing slash needed. */
  baseUrl: string;
  /** Read at call time, so signing in or out needs no new client. May renew an expired credential. */
  getKey: () => string | null | Promise<string | null>;
  /**
   * Called once when the gateway answers 401. Return true if a fresh credential is
   * now available: the ask is then repeated, once, under the same Idempotency-Key.
   * A second 401 is final. Never loops.
   */
  onUnauthorized?: () => Promise<boolean>;
  fetch?: typeof fetch;
  /** A slow network is not a broken one: 2G round trips are many seconds. */
  timeoutMs?: number;
}

export interface AskOptions {
  /**
   * Sent as `Idempotency-Key`. The offline queue reuses one id per message, so
   * a retry after a dropped connection is replayed by the gateway instead of
   * answered, and metered, twice.
   */
  idempotencyKey?: string;
  signal?: AbortSignal;
  /**
   * The seam for streaming. The gateway answers in one piece today
   * (streaming is "deliberately not in this phase", CLAUDE.md), so this is
   * never called yet; an SSE reader will call it with the text so far and
   * the UI is already built to render it.
   */
  onProgress?: (textSoFar: string) => void;
}

const fail = (
  kind: AskError['kind'],
  status: number | null = null,
  extra: Partial<AskError> = {},
): Result<never> => ({
  ok: false,
  error: { kind, status, retryAfterSec: null, upgradeUrl: null, ...extra },
});

const asObject = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {};

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/** Only http(s) links leave the app: a `javascript:` URL in Ground must not become an href. */
export const safeUrl = (v: unknown): string | null => {
  const s = str(v);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
};

export function parseCitations(v: unknown): Citation[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((c) => {
    const o = asObject(c);
    const title = str(o.title);
    if (!title) return [];
    return [
      {
        title,
        heading: str(o.heading),
        authority: str(o.authority) ?? '',
        effective_from: str(o.effective_from),
        url: safeUrl(o.url),
      },
    ];
  });
}

/** Turn the gateway's JSON into an Answer, or null if it is not an answer at all. */
export function parseAnswer(body: unknown): Answer | null {
  const b = asObject(body) as Partial<ChatResponse>;
  const text = str(b.choices?.[0]?.message?.content);
  const meta = asObject(b.shamwari);
  if (!text || typeof b.id !== 'string') return null;
  const scope = meta.scope === 'personal' || meta.scope === 'community' ? meta.scope : 'platform';
  return {
    id: b.id,
    text,
    scope,
    language: str(meta.language),
    grounded: meta.grounded === true,
    truncated: meta.truncated === true,
    inferencePath: str(meta.inference_path) ?? 'gateway',
    degraded: meta.degraded === true,
    modelServed: str(meta.model_served),
    citations: parseCitations(meta.citations),
  };
}

function classify(status: number, body: unknown, headers: Headers): Result<never> {
  const o = asObject(body);
  const code = str(o.error);
  const retry = Number(headers.get('Retry-After'));
  const retryAfterSec = Number.isFinite(retry) && retry > 0 ? retry : null;

  // 409 is two different things: the Rule 1 refusal, and "I am still answering
  // that exact request". Only the first is the scope explanation.
  if (status === 409) {
    if (code === 'scope_requires_local_inference') return fail('scope_requires_local_inference', 409);
    return fail('busy', 409, { retryAfterSec });
  }
  if (status === 401) return fail('unauthorized', 401);
  if (status === 402) return fail('payment_required', 402, { upgradeUrl: safeUrl(o.upgrade) });
  if (status === 403) return fail('forbidden_scope', 403);
  if (status === 429) return fail('rate_limited', 429, { retryAfterSec, upgradeUrl: safeUrl(o.upgrade) });
  if (status === 400) return fail('bad_request', 400);
  if (status >= 500) return fail('unavailable', status, { retryAfterSec });
  return fail('unknown', status);
}

export function createClient(config: ClientConfig) {
  const base = config.baseUrl.replace(/\/+$/, '');
  const doFetch = config.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));

  async function once(req: ChatRequest, opts: AskOptions): Promise<Result<Answer>> {
    const key = await config.getKey();
    if (!key) return fail('unauthorized');

    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), config.timeoutMs ?? 45_000);
    const onAbort = () => timeout.abort();
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    try {
      const res = await doFetch(`${base}/v1/chat/completions`, {
        method: 'POST',
        signal: timeout.signal,
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          // The gateway never keeps requests with this header as Mind training
          // material (gateway/src/index.ts). Nobody using the chat has been asked
          // whether their questions may train a model, so the answer is no until
          // the owner decides otherwise.
          'X-Shamwari-Channel': 'pwa',
          ...(opts.idempotencyKey ? { 'Idempotency-Key': opts.idempotencyKey } : {}),
        },
        body: JSON.stringify({ reach: 'r2', ...req }),
      });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) return classify(res.status, body, res.headers);
      const answer = parseAnswer(body);
      return answer ? { ok: true, value: answer } : fail('unknown', res.status);
    } catch {
      // fetch rejects for no network, DNS, TLS, CORS and our own timeout. To
      // the person these are one thing: the answer did not arrive.
      return fail('offline');
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
    }
  }

  async function ask(req: ChatRequest, opts: AskOptions = {}): Promise<Result<Answer>> {
    const first = await once(req, opts);
    if (first.ok || first.error.kind !== 'unauthorized' || first.error.status !== 401) return first;
    // A 401 from the gateway (not a missing key): one silent renewal, one more try.
    if (!config.onUnauthorized || !(await config.onUnauthorized())) return first;
    return once(req, opts);
  }

  return { ask };
}

export type Client = ReturnType<typeof createClient>;
