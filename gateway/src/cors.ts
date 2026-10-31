/**
 * CORS for browser callers of the gateway, so the Shamwari Chat web app on
 * shamwari.ai can call api.shamwari.ai. Without it every browser request dies at
 * the preflight, which looks like "offline" to the person using it.
 *
 * Deliberately narrow:
 *  - An exact-match allowlist of origins (`CORS_ORIGINS`, comma separated). Never
 *    `*`, and an origin is never reflected back unless it is on the list.
 *  - Only the chat endpoint answers a preflight (any other gets a 404, which fails
 *    it, so a browser cannot make an authenticated call to it). Nothing else gains a browser
 *    surface by this change.
 *  - No credentials: callers send a Bearer key in a header, not a cookie, so
 *    `Access-Control-Allow-Credentials` is never set.
 *  - This widens who may READ a response in a browser. It does not authenticate
 *    anyone and does not touch the scope gate: a personal-scope request is still
 *    refused with 409 exactly as before (CLAUDE.md rule 1).
 */
import type { Env } from './types';

export const DEFAULT_CORS_ORIGINS = ['https://shamwari.ai', 'https://www.shamwari.ai'];

/** Request headers a browser may send. `x-shamwari-channel` marks traffic that is never training material. */
const ALLOW_HEADERS = 'authorization, content-type, idempotency-key, x-shamwari-channel';

/** Without this a browser hides `Retry-After` from the page, so the app cannot say how long to wait. */
const EXPOSE_HEADERS = 'Retry-After';

const PREFLIGHT_PATHS = new Set(['/v1/chat/completions']);

export function allowedOrigins(env: Pick<Env, 'CORS_ORIGINS'>): string[] {
  const configured = env.CORS_ORIGINS?.split(',').map((o) => o.trim()).filter(Boolean);
  return configured?.length ? configured : DEFAULT_CORS_ORIGINS;
}

/** The origin to echo, or null. Exact match only: `*` is never honoured, even if configured. */
export function corsOrigin(req: Request, env: Pick<Env, 'CORS_ORIGINS'>): string | null {
  const origin = req.headers.get('Origin');
  if (!origin || origin === '*') return null;
  return allowedOrigins(env).includes(origin) ? origin : null;
}

/** Answer a browser preflight for the chat endpoint; null means "not a preflight we handle". */
export function preflight(req: Request, env: Pick<Env, 'CORS_ORIGINS'>): Response | null {
  const url = new URL(req.url);
  if (req.method !== 'OPTIONS' || !PREFLIGHT_PATHS.has(url.pathname)) return null;
  const origin = corsOrigin(req, env);
  // A disallowed origin gets a bare 204 with no allow headers: the browser then
  // blocks the real request, which is the intended outcome.
  if (!origin) return new Response(null, { status: 204, headers: { Vary: 'Origin' } });
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': ALLOW_HEADERS,
      'Access-Control-Max-Age': '600',
      Vary: 'Origin',
    },
  });
}

/** Add the response headers a browser needs, for an allowed origin only. */
export function withCors(req: Request, env: Pick<Env, 'CORS_ORIGINS'>, res: Response): Response {
  const origin = corsOrigin(req, env);
  if (!origin) return res;
  // A Response from fetch() has immutable headers, so build a new one.
  const out = new Response(res.body, res);
  out.headers.set('Access-Control-Allow-Origin', origin);
  out.headers.set('Access-Control-Expose-Headers', EXPOSE_HEADERS);
  out.headers.append('Vary', 'Origin');
  return out;
}
