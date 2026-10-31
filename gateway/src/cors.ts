/**
 * CORS for browser callers of the gateway, so the Shamwari Chat web app on
 * shamwari.ai can call api.shamwari.ai. Without it every browser request dies at
 * the preflight, which looks like "offline" to the person using it.
 *
 * Deliberately narrow:
 *  - An exact-match allowlist of origins (`CORS_ORIGINS`, comma separated). Never
 *    `*`, never `null`, and an origin is never reflected unless it is on the list.
 *    Unset means the Shamwari sites; set but empty means NO origins, so CORS can
 *    be switched off by configuration.
 *  - Only the chat endpoint is touched: it alone answers a preflight and it alone
 *    carries CORS headers on its responses. The ground, SMS and USSD endpoints and
 *    /health are exactly as before, so a page cannot read their responses.
 *  - No credentials: callers send a Bearer key in a header, not a cookie, so
 *    `Access-Control-Allow-Credentials` is never set.
 *  - This widens who may READ a response in a browser. It does not authenticate
 *    anyone and does not touch the scope gate: a personal-scope request is still
 *    refused with 409 exactly as before (CLAUDE.md rule 1).
 */
import type { Env } from './types';

export const DEFAULT_CORS_ORIGINS = ['https://shamwari.ai', 'https://www.shamwari.ai'];

/**
 * Request headers a browser may send. `x-shamwari-channel` marks traffic that is
 * never kept as training material (gateway/src/index.ts). A page that sets it can
 * only withhold its own traffic from training, never add to it, so allowing it is
 * the conservative direction.
 */
const ALLOW_HEADERS = 'authorization, content-type, idempotency-key, x-shamwari-channel';

/**
 * Response headers the page may read. Without `Retry-After` a browser hides it,
 * so the app cannot say how long to wait (the gateway sends it on 503 and on the
 * in-progress 409, not on a quota 429). `Idempotent-Replayed` tells a caller that
 * a retry was answered from the stored first answer rather than run again.
 */
const EXPOSE_HEADERS = 'Retry-After, Idempotent-Replayed';

export const CORS_PATHS = new Set(['/v1/chat/completions']);

const normalise = (o: string): string => o.trim().replace(/\/+$/, '');

export function allowedOrigins(env: Pick<Env, 'CORS_ORIGINS'>): string[] {
  if (env.CORS_ORIGINS === undefined) return DEFAULT_CORS_ORIGINS;
  return env.CORS_ORIGINS.split(',').map(normalise).filter((o) => o && o !== '*' && o !== 'null');
}

/** The origin to echo, or null. Exact match only. */
export function corsOrigin(req: Request, env: Pick<Env, 'CORS_ORIGINS'>): string | null {
  const origin = req.headers.get('Origin');
  if (!origin || origin === '*' || origin === 'null') return null;
  return allowedOrigins(env).includes(origin) ? origin : null;
}

const onChatPath = (req: Request): boolean => CORS_PATHS.has(new URL(req.url).pathname);

/** Answer a browser preflight for the chat endpoint; null means "not a preflight we handle". */
export function preflight(req: Request, env: Pick<Env, 'CORS_ORIGINS'>): Response | null {
  if (req.method !== 'OPTIONS' || !onChatPath(req)) return null;
  // A real preflight names its origin and the method it wants. Anything else is
  // not CORS traffic and is left to the router, as before.
  if (!req.headers.has('Origin') || !req.headers.has('Access-Control-Request-Method')) return null;
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

/**
 * Add the response headers a browser needs, for the chat endpoint and an allowed
 * origin only. `Vary: Origin` goes on every chat response so a shared cache can
 * never hand one origin's variant to another.
 */
export function withCors(req: Request, env: Pick<Env, 'CORS_ORIGINS'>, res: Response): Response {
  if (!onChatPath(req)) return res;
  const origin = corsOrigin(req, env);
  // A Response from fetch() has immutable headers, so build a new one.
  const out = new Response(res.body, res);
  out.headers.append('Vary', 'Origin');
  if (origin) {
    out.headers.set('Access-Control-Allow-Origin', origin);
    out.headers.set('Access-Control-Expose-Headers', EXPOSE_HEADERS);
  }
  return out;
}
