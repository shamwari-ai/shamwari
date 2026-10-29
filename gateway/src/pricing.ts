import table from '../pricing.json';

/**
 * Estimated cost of one answer, from a versioned price table.
 *
 * An ESTIMATE, labelled as one everywhere it appears: it is not billing-grade
 * and nothing should invoice from it. The table lives in pricing.json, not in
 * a handler, so a price change is a reviewed diff with a new version and a
 * source. Tokens are the fact; this is derived from them.
 *
 * A model with no entry returns null, never 0: "unpriced" and "free" must not
 * look alike in a report. Extractive and Mind-retrieval answers make no model
 * call, so they have no model and no cost.
 */
export const PRICE_TABLE_VERSION: string = table.version;

type Prices = { input: number; output: number };
const PRICES: Record<string, Prices> = table.per_million_tokens;

/** `servedKey` is `provider/model` as served, the key provenance.ts uses. */
export function estimateCostUsd(
  servedKey: string | null | undefined,
  inputTokens: number,
  outputTokens: number,
): number | null {
  if (!servedKey) return null;
  const p = PRICES[servedKey];
  if (!p) return null;
  const usd = (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
  // Fixed precision keeps the number stable across sums and out of float noise.
  return Math.round(usd * 1e9) / 1e9;
}

/** What validatePricing() checks, exported so a test can hold the table to it. */
export function validatePricing(t: unknown): string[] {
  const errs: string[] = [];
  const o = t as Record<string, any>;
  if (typeof o?.version !== 'string' || !o.version) errs.push('version required');
  if (o?.currency !== 'USD') errs.push('currency must be USD');
  if (typeof o?.source !== 'string' || !o.source.startsWith('https://'))
    errs.push('source required');
  if (typeof o?.retrieved !== 'string') errs.push('retrieved date required');
  for (const [k, v] of Object.entries(o?.per_million_tokens ?? {})) {
    const p = v as Prices;
    if (!(Number.isFinite(p?.input) && p.input >= 0)) errs.push(`${k}: input`);
    if (!(Number.isFinite(p?.output) && p.output >= 0)) errs.push(`${k}: output`);
    if (!k.includes('/')) errs.push(`${k}: key must be provider/model`);
  }
  return errs;
}
