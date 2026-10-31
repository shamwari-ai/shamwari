import type { Env, AuthContext } from './types';
import { keyService } from './keys';
import { looksLikeJwt, verifyWorkosToken } from './workos';

async function sha256(raw: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export type AuthResult =
  | { ok: true; auth: AuthContext }
  | { ok: false; reason: 'invalid' | 'unavailable' }
  | { ok: false; reason: 'forbidden'; detail: string };

/**
 * KV first, key service on miss. Only the hash is ever transmitted or cached,
 * so neither a KV leak nor a service log yields a usable key.
 *
 * Short TTL is the revocation window: a revoked key stops working within
 * AUTH_CACHE_TTL seconds without any cache invalidation step.
 *
 * Fails closed: 'unavailable' denies the request and is not cached, so a
 * recovered service is believed at once and an outage never becomes a
 * lasting verdict on a good key.
 */
export async function authenticate(req: Request, env: Env): Promise<AuthResult> {
  const header = req.headers.get('Authorization') ?? '';
  const raw = header.startsWith('Bearer ') ? header.slice(7).trim() : '';

  // Two credential shapes, told apart by prefix and never tried against each other.
  // A WorkOS access token is verified offline (src/workos.ts) and needs no cache: the
  // signature check is the whole cost, and a revoked session ends at the token's `exp`.
  if (!raw.startsWith('sk_shamwari_')) {
    if (!looksLikeJwt(raw)) return { ok: false, reason: 'invalid' };
    const outcome = await verifyWorkosToken(raw, env);
    if (outcome.status === 'ok') return { ok: true, auth: outcome.ctx };
    if (outcome.status === 'forbidden') {
      return { ok: false, reason: 'forbidden', detail: outcome.reason };
    }
    return { ok: false, reason: outcome.status };
  }

  const hash = await sha256(raw);
  const cacheKey = `auth:${hash}`;
  const ttl = Math.max(60, Number(env.AUTH_CACHE_TTL));

  const cached = await env.AUTH_CACHE.get(cacheKey, 'json');
  if (cached === 'invalid') return { ok: false, reason: 'invalid' };
  if (cached) return { ok: true, auth: cached as AuthContext };

  const outcome = await keyService(env).verify(raw.slice(0, 12), hash);
  // The cache write is best-effort: a KV hiccup must not deny a verified key.
  const remember = (v: unknown) =>
    env.AUTH_CACHE.put(cacheKey, JSON.stringify(v), { expirationTtl: ttl }).catch(() => {});
  if (outcome.status === 'ok') {
    await remember(outcome.ctx);
    return { ok: true, auth: outcome.ctx };
  }
  if (outcome.status === 'invalid') {
    // Cache the negative so key-guessing cannot hammer the service.
    await remember('invalid');
  }
  return { ok: false, reason: outcome.status };
}
