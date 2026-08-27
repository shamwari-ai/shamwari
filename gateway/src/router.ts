import type { Env, Message, Tier, LicenseClass } from './types';

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

const HARD = [
  'calculate', 'compute', 'derive', 'compare', 'analyse', 'analyze',
  'step by step', 'write code', 'debug', 'reconcile', 'draft a contract',
  'tsanangura', 'verenga',
];

/**
 * Heuristic v0. Deliberately not an LLM classifier — paying for a model
 * call to decide which model to call doubles latency and cost on every
 * request. Revisit once platform.usageEvents shows where economy fails.
 *
 * Economy handles the bulk; that is where the margin comes from, since
 * AI Gateway passes provider pricing through at cost.
 */
export function route(messages: Message[], requested: string | undefined, env: Env): Target {
  const t = targets(env);
  if (requested === 'shamwari-standard') return t.standard;
  if (requested === 'shamwari-economy') return t.economy;

  const text = messages.map((m) => m.content).join(' ');
  if (text.length > 6000 || messages.length > 12) return t.standard;

  const lower = text.toLowerCase();
  if (HARD.some((s) => lower.includes(s))) return t.standard;
  return t.economy;
}
