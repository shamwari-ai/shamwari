import type { Env, Message, Tier, LicenseClass } from './types';
import rawPolicy from '../routing-policy.json';

export interface Target {
  tier: Tier;
  provider: string;
  model: string;
  licenseClass: LicenseClass;
  directUrl: string;
  apiKey: (env: Env) => string;
}

/**
 * VERIFY provider slugs against the AI Gateway provider list before deploy.
 * Anything not natively supported is added as an OpenAI-compatible custom
 * provider in the Gateway dashboard.
 *
 * Provider identity and licenseClass stay here rather than in
 * routing-policy.json. They are provenance-bearing: Core rejects restricted
 * rows from the Mind training path on the strength of what this function
 * stamps, so it must not be editable without a code review.
 */
export function targets(env: Env): Record<Tier, Target> {
  return {
    economy: {
      tier: 'economy',
      provider: 'qwen',
      model: env.ECONOMY_MODEL,
      licenseClass: 'open_weight',
      directUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
      apiKey: (e) => e.QWEN_API_KEY,
    },
    standard: {
      tier: 'standard',
      provider: 'moonshot',
      model: env.STANDARD_MODEL,
      licenseClass: 'open_weight',
      directUrl: 'https://api.moonshot.ai/v1/chat/completions',
      apiKey: (e) => e.MOONSHOT_API_KEY,
    },
    // Premium is deliberately unconfigured. When Claude or GPT are added,
    // licenseClass MUST stay 'restricted' — their terms bar using outputs
    // to train competing models, and Core rejects restricted rows from the
    // Mind training path.
    premium: {
      tier: 'premium',
      provider: 'unconfigured',
      model: '',
      licenseClass: 'restricted',
      directUrl: '',
      apiKey: () => '',
    },
  };
}

const TIERS: readonly Tier[] = ['economy', 'standard', 'premium'];

export interface RoutingPolicy {
  version: number;
  default_tier: Tier;
  model_aliases: Record<string, Tier>;
  escalation: {
    tier: Tier;
    max_total_chars: number;
    max_messages: number;
    keywords: Record<string, string[]>;
  };
}

export class PolicyError extends Error {
  constructor(detail: string) {
    super(`routing-policy.json: ${detail}`);
  }
}

function isTier(v: unknown): v is Tier {
  return typeof v === 'string' && (TIERS as readonly string[]).includes(v);
}

function positiveInt(v: unknown, field: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0) {
    throw new PolicyError(`${field} must be a positive integer, got ${JSON.stringify(v)}`);
  }
  return v;
}

/**
 * Validated at load, not at first use. A policy that parses but means
 * something different — an unknown tier name, a threshold of zero, a
 * keyword with a capital letter that the lowercased match can never hit —
 * would otherwise route every request to the default tier and look like it
 * was working.
 */
export function validatePolicy(input: unknown): RoutingPolicy {
  if (typeof input !== 'object' || input === null) throw new PolicyError('not an object');
  const p = input as Record<string, unknown>;

  if (p.version !== 1) {
    throw new PolicyError(`unsupported version ${JSON.stringify(p.version)}, expected 1`);
  }
  if (!isTier(p.default_tier)) {
    throw new PolicyError(`unknown default_tier ${JSON.stringify(p.default_tier)}`);
  }

  const aliasesIn = p.model_aliases;
  if (typeof aliasesIn !== 'object' || aliasesIn === null) {
    throw new PolicyError('model_aliases must be an object');
  }
  const model_aliases: Record<string, Tier> = {};
  for (const [alias, tier] of Object.entries(aliasesIn as Record<string, unknown>)) {
    if (!isTier(tier)) {
      throw new PolicyError(`model_aliases["${alias}"] names unknown tier ${JSON.stringify(tier)}`);
    }
    model_aliases[alias] = tier;
  }

  const escIn = p.escalation;
  if (typeof escIn !== 'object' || escIn === null) {
    throw new PolicyError('escalation must be an object');
  }
  const esc = escIn as Record<string, unknown>;
  if (!isTier(esc.tier)) {
    throw new PolicyError(`escalation.tier names unknown tier ${JSON.stringify(esc.tier)}`);
  }

  const keywordsIn = esc.keywords;
  if (typeof keywordsIn !== 'object' || keywordsIn === null) {
    throw new PolicyError('escalation.keywords must be an object keyed by language');
  }
  const keywords: Record<string, string[]> = {};
  for (const [lang, list] of Object.entries(keywordsIn as Record<string, unknown>)) {
    if (!Array.isArray(list)) {
      throw new PolicyError(`escalation.keywords.${lang} must be an array`);
    }
    for (const kw of list) {
      if (typeof kw !== 'string' || kw.length === 0) {
        throw new PolicyError(`escalation.keywords.${lang} contains a non-string or empty entry`);
      }
      // Matching lowercases the request text, so an uppercase keyword can
      // never fire. Reject it rather than shipping a dead rule.
      if (kw !== kw.toLowerCase()) {
        throw new PolicyError(`escalation.keywords.${lang} entry "${kw}" must be lowercase`);
      }
    }
    keywords[lang] = list as string[];
  }

  return {
    version: 1,
    default_tier: p.default_tier,
    model_aliases,
    escalation: {
      tier: esc.tier,
      max_total_chars: positiveInt(esc.max_total_chars, 'escalation.max_total_chars'),
      max_messages: positiveInt(esc.max_messages, 'escalation.max_messages'),
      keywords,
    },
  };
}

export const policy: RoutingPolicy = validatePolicy(rawPolicy);

/** Every escalation keyword, flattened across languages. */
const HARD: readonly string[] = Object.values(policy.escalation.keywords).flat();

/**
 * Heuristic v0, parameterised by routing-policy.json. Deliberately not an
 * LLM classifier — paying for a model call to decide which model to call
 * doubles latency and cost on every request. Revisit the policy file once
 * platform.usageEvents shows where economy fails.
 *
 * Economy handles the bulk; that is where the margin comes from, since
 * AI Gateway passes provider pricing through at cost.
 */
export function route(messages: Message[], requested: string | undefined, env: Env): Target {
  const t = targets(env);

  if (requested !== undefined) {
    const alias = policy.model_aliases[requested];
    if (alias) return t[alias];
  }

  const { tier: escalateTo, max_total_chars, max_messages } = policy.escalation;

  const text = messages.map((m) => m.content).join(' ');
  if (text.length > max_total_chars || messages.length > max_messages) return t[escalateTo];

  const lower = text.toLowerCase();
  if (HARD.some((s) => lower.includes(s))) return t[escalateTo];

  return t[policy.default_tier];
}
