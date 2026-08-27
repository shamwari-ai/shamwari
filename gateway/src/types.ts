export interface Env {
  AI: Ai;
  AUTH_CACHE: KVNamespace;
  SINK: Queue<SinkMessage>;

  CF_ACCOUNT_ID: string;
  CF_AIG_TOKEN: string;
  CF_GATEWAY_ID: string;

  CORE_URL: string;
  SHAMWARI_CORE_TOKEN: string;

  QWEN_API_KEY: string;
  MOONSHOT_API_KEY: string;

  EMBEDDING_MODEL: string;
  GROUND_TOP_K: string;
  AUTH_CACHE_TTL: string;
  ECONOMY_MODEL: string;
  STANDARD_MODEL: string;
  SURFACE: string;
  MIND_AVAILABLE: string;
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
}

export type SinkMessage = {
  database: 'shamwari' | 'platform';
  collection: string;
  doc: Record<string, unknown>;
};
