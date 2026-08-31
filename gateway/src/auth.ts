import type { Env, AuthContext } from './types';
import { core } from './core';

async function sha256(raw: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * KV first, Core on miss. Only the hash is ever transmitted or cached, so
 * neither a KV leak nor a Core log yields a usable key.
 *
 * Short TTL is the revocation window: a revoked key stops working within
 * AUTH_CACHE_TTL seconds without any cache invalidation step.
 */
export async function authenticate(req: Request, env: Env): Promise<AuthContext | null> {
  const header = req.headers.get('Authorization') ?? '';
  const raw = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!raw.startsWith('sk_shamwari_')) return null;

  const hash = await sha256(raw);
  const cacheKey = `auth:${hash}`;
  const ttl = Math.max(60, Number(env.AUTH_CACHE_TTL));

  const cached = await env.AUTH_CACHE.get(cacheKey, 'json');
  if (cached === 'invalid') return null;
  if (cached) return cached as AuthContext;

  try {
    const result = await core<{
      api_key_id: string;
      owner_entity_id: string;
      owner_person_id: string | null;
      key_type: string;
      tier: string;
      monthly_token_cap: number;
    }>(env, '/auth/verify', {
      method: 'POST',
      // keyPrefix is indexed in platform.apiKeys; Core finds by prefix then
      // does a constant-time compare on the hash.
      body: { key_prefix: raw.slice(0, 12), key_hash: hash },
    });

    const ctx: AuthContext = {
      apiKeyId: result.api_key_id,
      ownerEntityId: result.owner_entity_id,
      ownerPersonId: result.owner_person_id,
      keyType: result.key_type,
      tier: result.tier,
      monthlyTokenCap: result.monthly_token_cap,
    };
    await env.AUTH_CACHE.put(cacheKey, JSON.stringify(ctx), { expirationTtl: ttl });
    return ctx;
  } catch {
    // Cache the negative so key-guessing cannot hammer Core.
    await env.AUTH_CACHE.put(cacheKey, JSON.stringify('invalid'), { expirationTtl: ttl });
    return null;
  }
}
