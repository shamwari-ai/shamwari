export interface Env {
  AI: Ai;
  AUTH_CACHE: KVNamespace;
  SINK: Queue<SinkMessage>;

  CF_ACCOUNT_ID: string;
  /** Secrets Store binding: the AI Gateway authentication token. Read with `.get()`. */
  CF_AIG_TOKEN: SecretsStoreSecret;
  CF_GATEWAY_ID: string;
  /** The dynamic route on that gateway, called as `dynamic/<name>`. */
  CF_ROUTE_NAME: string;

  CORE_URL: string;
  SHAMWARI_CORE_TOKEN: string;

  /** "true" moves key verification and metering to the Servers API. Off by default. */
  SERVERS_API_ENABLED?: string;
  SERVERS_API_URL?: string;
  /** Secret. */
  SERVERS_API_TOKEN?: string;
  /** Secret. Second factor the Servers API's internal routes require. */
  SERVERS_API_INTERNAL_KEY?: string;

  /**
   * WorkOS sign-in for people (docs/chat-signin.md). Off unless WORKOS_CLIENT_ID is
   * set; once it is, a missing or malformed value denies (503), it never relaxes a check.
   * None of these is a secret: they identify the app and the token's issuer.
   */
  WORKOS_CLIENT_ID?: string;
  /** The `iss` WorkOS puts in access tokens for this app. Exact match. */
  WORKOS_ISSUER?: string;
  /** The `aud` the JWT template sets, our API's URI. Required: a token without it is refused. */
  WORKOS_AUDIENCE?: string;
  /** Defaults to https://api.workos.com/sso/jwks/{WORKOS_CLIENT_ID}. HTTPS only. */
  WORKOS_JWKS_URL?: string;
  /** Monthly token cap per person. A positive integer; the owner sets it. */
  WORKOS_MONTHLY_TOKEN_CAP?: string;
  /** Longest a token may have been valid, in seconds, whatever its `exp`. Default 3600. */
  WORKOS_MAX_TOKEN_AGE_SECONDS?: string;

  /**
   * Browser origins allowed to call the chat endpoint, comma separated, exact
   * match (src/cors.ts). Absent means https://shamwari.ai and https://www.shamwari.ai.
   */
  CORS_ORIGINS?: string;

  EMBEDDING_MODEL: string;
  GROUND_TOP_K: string;
  AUTH_CACHE_TTL: string;
  ECONOMY_MODEL: string;
  STANDARD_MODEL: string;
  SURFACE: string;
  MIND_AVAILABLE: string;

  /**
   * Channels (SMS, USSD). Both are secrets set by the owner; a channel with
   * either missing answers 503 and nothing else. The key is an ordinary
   * customer-style API key for the channel's owning entity, so the channel
   * is metered and gated like any other caller.
   */
  CHANNEL_WEBHOOK_SECRET?: string;
  CHANNEL_API_KEY?: string;
}

export type Tier = 'economy' | 'standard' | 'premium';

/**
 * Shamwari's three layers of intelligence. These are data scopes, not
 * deployment tiers.
 *
 *   personal   the user's own pod data      — never leaves the device
 *   community  anonymised platform data     — may reach Cloud
 *   platform   base Mukoko knowledge        — may reach Cloud
 */
export type Scope = 'personal' | 'community' | 'platform';

/** Gates Mind training eligibility. Stamped at generation, never inferred. */
export type LicenseClass = 'open_weight' | 'restricted';

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GroundChunk {
  content: string;
  heading: string | null;
  title: string;
  authority: string;
  resource_type: string;
  source_url: string | null;
  effective_from: string | null;
  scope: string;
}

export interface AuthContext {
  apiKeyId: string;
  ownerEntityId: string;
  ownerPersonId: string | null;
  keyType: string;
  tier: string;
  monthlyTokenCap: number;
  /**
   * What this key may ask for. Absent (an older cached context, or the Core
   * path, which carries none) means community and platform only: personal is
   * never implied. It can only narrow a request, never widen what the scope
   * gate allows.
   */
  scopes?: Scope[];
}

export type SinkMessage = {
  database: 'shamwari' | 'platform';
  collection: string;
  doc: Record<string, unknown>;
};
