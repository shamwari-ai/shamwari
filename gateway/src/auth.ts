import type { Env, AuthContext } from './types';
import { keyService } from './keys';

async function sha256(raw: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export type AuthResult =
  | { ok: true; auth: AuthContext }
  | { ok: false; reason: 'invalid' | 'unavailable' };

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
  if (!raw.startsWith('sk_shamwari_')) return { ok: false, reason: 'invalid' };

  const hash = await sha256(raw);
  const cacheKey = `auth:${hash}`;
  const ttl = Math.max(60, Number(env.AUTH_CACHE_TTL));

  const cached = await env.AUTH_CACHE.get(cacheKey, 'json');
  if (cached === 'invalid') return { ok: false, reason: 'invalid' };
  if (cached) return { ok: true, auth: cached as AuthContext };

  const outcome = await keyService(env).verify(raw.slice(0, 12), hash);
  if (outcome.status === 'ok') {
    await env.AUTH_CACHE.put(cacheKey, JSON.stringify(outcome.ctx), { expirationTtl: ttl });
    return { ok: true, auth: outcome.ctx };
  }
  if (outcome.status === 'invalid') {
    // Cache the negative so key-guessing cannot hammer the service.
    await env.AUTH_CACHE.put(cacheKey, JSON.stringify('invalid'), { expirationTtl: ttl });
  }
  return { ok: false, reason: outcome.status };
}
