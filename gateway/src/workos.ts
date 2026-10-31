import { createRemoteJWKSet, errors, jwtVerify } from 'jose';
import type { JWTPayload } from 'jose';
import type { AuthContext, Env, Scope } from './types';

/**
 * Verifies a WorkOS AuthKit access token offline against the JWKS, and turns
 * its claims into an AuthContext. docs/chat-signin.md has the design.
 *
 * The properties that matter, each pinned by test/workos.test.ts:
 *
 *   - The algorithm is pinned to RS256 and the key comes from the JWKS, never
 *     from the token. `alg: none` and an HS256 token signed with the public key
 *     as a shared secret are both refused.
 *   - `iss`, `aud` and `client_id` must all match configuration, `exp` and `sub`
 *     must be present. A token without an `aud` is refused, not waved through.
 *   - Scope comes from the `permissions` claim and defaults to nothing. Personal
 *     is not a scope this file can grant to anyone (rule 1): a token that carries
 *     a personal permission gets no more than one that does not.
 *   - Fails closed. A verdict on the token ('invalid') and a failure to reach a
 *     verdict ('unavailable') are different outcomes, so a JWKS outage is a 503
 *     and not a sign-out.
 */

/** Permissions the WorkOS JWT template must issue. Owner-defined; see the doc. */
export const PERMISSION_COMMUNITY = 'shamwari:community';
export const PERMISSION_PLATFORM = 'shamwari:platform';

const GRANTABLE: ReadonlyArray<readonly [string, Scope]> = [
  [PERMISSION_COMMUNITY, 'community'],
  [PERMISSION_PLATFORM, 'platform'],
];

export const WORKOS_KEY_TYPE = 'workos';

export type WorkosOutcome =
  | { status: 'ok'; ctx: AuthContext }
  | { status: 'invalid' }
  | { status: 'unavailable' };

/** Three dot-separated base64url segments: shaped like a JWT, not yet believed. */
export function looksLikeJwt(raw: string): boolean {
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/.test(raw);
}

/** WorkOS sign-in is off unless a client id is configured. */
export function workosEnabled(env: Env): boolean {
  return Boolean(env.WORKOS_CLIENT_ID);
}

interface Config {
  clientId: string;
  issuer: string;
  audience: string;
  jwksUrl: URL;
  monthlyTokenCap: number;
}

/** null when enabled but incomplete: that is 'unavailable', never "accept anyway". */
function config(env: Env): Config | null {
  const { WORKOS_CLIENT_ID: clientId, WORKOS_ISSUER: issuer, WORKOS_AUDIENCE: audience } = env;
  const cap = Number(env.WORKOS_MONTHLY_TOKEN_CAP);
  if (!clientId || !issuer || !audience) return null;
  if (!Number.isInteger(cap) || cap <= 0) return null;
  let jwksUrl: URL;
  try {
    jwksUrl = new URL(
      env.WORKOS_JWKS_URL || `https://api.workos.com/sso/jwks/${encodeURIComponent(clientId)}`,
    );
  } catch {
    return null;
  }
  if (jwksUrl.protocol !== 'https:') return null;
  return { clientId, issuer, audience, jwksUrl, monthlyTokenCap: cap };
}

// One JWKS set per URL per isolate. jose caches the keys, re-fetches on an
// unknown `kid`, and will not re-fetch more than once per cooldown however many
// forged kids arrive, so a flood of bad tokens cannot become a flood at WorkOS.
const JWKS_CACHE_MAX_AGE_MS = 10 * 60 * 1000;
const JWKS_COOLDOWN_MS = 30 * 1000;
const JWKS_TIMEOUT_MS = 1500;
const jwksSets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function jwksFor(url: URL) {
  const key = url.toString();
  let set = jwksSets.get(key);
  if (!set) {
    set = createRemoteJWKSet(url, {
      cacheMaxAge: JWKS_CACHE_MAX_AGE_MS,
      cooldownDuration: JWKS_COOLDOWN_MS,
      timeoutDuration: JWKS_TIMEOUT_MS,
    });
    jwksSets.set(key, set);
  }
  return set;
}

/** For tests: forget cached keys so one test's JWKS does not answer for the next. */
export function resetJwksCache(): void {
  jwksSets.clear();
}

/** Errors that are a verdict on the token. Anything else is ours, and 'unavailable'. */
function isVerdict(e: unknown): boolean {
  return (
    e instanceof errors.JWTExpired ||
    e instanceof errors.JWTClaimValidationFailed ||
    e instanceof errors.JWTInvalid ||
    e instanceof errors.JWSInvalid ||
    e instanceof errors.JWSSignatureVerificationFailed ||
    e instanceof errors.JOSEAlgNotAllowed ||
    e instanceof errors.JWKSNoMatchingKey ||
    e instanceof errors.JWKSMultipleMatchingKeys
  );
}

const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** Scopes this token may ask for. Empty means no access: there is no default. */
export function scopesFromPermissions(permissions: unknown): Scope[] {
  if (!Array.isArray(permissions)) return [];
  const held = new Set(permissions.filter((p): p is string => typeof p === 'string'));
  return GRANTABLE.filter(([perm]) => held.has(perm)).map(([, scope]) => scope);
}

export async function verifyWorkosToken(token: string, env: Env): Promise<WorkosOutcome> {
  if (!workosEnabled(env)) return { status: 'invalid' };
  const cfg = config(env);
  if (!cfg) {
    console.error('workos sign-in is enabled but its configuration is incomplete');
    return { status: 'unavailable' };
  }

  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, jwksFor(cfg.jwksUrl), {
      algorithms: ['RS256'],
      issuer: cfg.issuer,
      audience: cfg.audience,
      requiredClaims: ['exp', 'iat', 'sub'],
    }));
  } catch (e) {
    return { status: isVerdict(e) ? 'invalid' : 'unavailable' };
  }

  if (!nonEmpty(payload.sub)) return { status: 'invalid' };
  // A token minted for another WorkOS app that shares our issuer and audience.
  if (payload.client_id !== cfg.clientId) return { status: 'invalid' };
  // The session id is what revocation is keyed on; a token without one cannot be revoked.
  if (!nonEmpty(payload.sid)) return { status: 'invalid' };

  const scopes = scopesFromPermissions(payload.permissions);
  if (scopes.length === 0) return { status: 'invalid' };

  return {
    status: 'ok',
    ctx: {
      // Metered and capped per person. The `workos:` prefix keeps these ids out of
      // the entity and API-key namespaces they would otherwise be read as.
      apiKeyId: `workos:sid:${payload.sid}`,
      ownerEntityId: `workos:${payload.sub}`,
      ownerPersonId: payload.sub,
      keyType: WORKOS_KEY_TYPE,
      tier: 'community',
      monthlyTokenCap: cfg.monthlyTokenCap,
      scopes,
    },
  };
}
