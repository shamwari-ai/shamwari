/**
 * The wire contract of the Shamwari gateway (`gateway/src/index.ts`) as the
 * chat app sees it. Nothing here is invented: every field is one the gateway
 * sends today. Keep it small — this file is part of the first-load JS budget
 * and is meant to be shared with the native app (docs/app-plan.md).
 */

export type Scope = 'personal' | 'community' | 'platform';
export type ModelAlias = 'shamwari-economy' | 'shamwari-standard';
export type Language = 'en' | 'sn' | 'nd';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  scope?: Scope;
  model?: ModelAlias;
  /** r1 = chat app, r2 = Lite PWA (docs/tiered-access-design.md). */
  reach?: 'r1' | 'r2';
}

/** One Ground source behind an answer (gateway `citationsOf`). */
export interface Citation {
  /** The instrument, e.g. "Constitution of Zimbabwe Amendment (No. 20) Act 2013". */
  title: string;
  /** The section within it, e.g. "Section 56 — Equality and non-discrimination". */
  heading: string | null;
  /** Who published it, e.g. "Parliament of Zimbabwe". */
  authority: string;
  /** ISO date the text took effect, when known. */
  effective_from: string | null;
  /** Link-out to the source, when there is one. */
  url: string | null;
}

/** The part of the gateway's response body the app reads. */
export interface ChatResponse {
  id: string;
  choices: { message: ChatMessage; finish_reason: string }[];
  shamwari: {
    tier: string;
    scope: Scope;
    language: string | null;
    grounded: boolean;
    truncated: boolean;
    inference_path: string;
    model_served?: string;
    model_substituted?: boolean;
    degraded?: boolean;
    citations: Citation[];
  };
}

/** What the UI renders for one answer. */
export interface Answer {
  id: string;
  text: string;
  scope: Scope;
  language: string | null;
  grounded: boolean;
  truncated: boolean;
  /** `gateway` | `workers-ai` | `extractive` — how it was answered. */
  inferencePath: string;
  /** True when Ground answered alone because inference was unavailable. */
  degraded: boolean;
  modelServed: string | null;
  citations: Citation[];
}

/**
 * Every way an ask can fail, as a kind the UI can say something kind about.
 * `scope_requires_local_inference` is deliberately its own kind and never
 * folded into a generic error: it is the product working, not breaking.
 */
export type AskErrorKind =
  | 'scope_requires_local_inference' // 409: personal data stays on the device
  | 'unauthorized' // 401: no key, or a bad one
  | 'payment_required' // 402: the plan or credit is used up
  | 'forbidden_scope' // 403: this key does not hold the scope it asked for
  | 'rate_limited' // 429: quota_exceeded or too many requests
  | 'unavailable' // 5xx: gateway, Core or auth backend down
  | 'busy' // 409 request_in_progress: the same ask is still being answered
  | 'offline' // no network, or the request never got an answer
  | 'bad_request' // 400
  | 'unknown';

export interface AskError {
  kind: AskErrorKind;
  status: number | null;
  retryAfterSec: number | null;
  upgradeUrl: string | null;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: AskError };
