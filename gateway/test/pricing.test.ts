import { describe, expect, it } from 'vitest';
import table from '../pricing.json';
import { estimateCostUsd, validatePricing, PRICE_TABLE_VERSION } from '../src/pricing';
import { USAGE_EVENT_FIELDS } from '../src/keys';

describe('cost estimate', () => {
  it('prices a served model from the versioned table', () => {
    // 1M in + 1M out on glm-5.3-flash: 0.15 + 0.50
    expect(estimateCostUsd('workers-ai/@cf/zai-org/glm-5.3-flash', 1_000_000, 1_000_000)).toBe(
      0.65,
    );
    expect(estimateCostUsd('workers-ai/@cf/zai-org/glm-5.3', 1000, 500)).toBeCloseTo(0.0036, 9);
  });

  it('zero tokens cost zero; an unpriced model costs null, never zero', () => {
    expect(estimateCostUsd('workers-ai/@cf/zai-org/glm-5.3-flash', 0, 0)).toBe(0);
    expect(estimateCostUsd('workers-ai/@cf/some/unlisted', 1000, 1000)).toBeNull();
    expect(estimateCostUsd(null, 1000, 1000)).toBeNull();
    expect(estimateCostUsd(undefined, 1, 1)).toBeNull();
  });

  it('every model the provenance allowlist serves from Workers AI is priced', () => {
    for (const k of ['workers-ai/@cf/zai-org/glm-5.3-flash', 'workers-ai/@cf/zai-org/glm-5.3']) {
      expect(estimateCostUsd(k, 1, 1)).not.toBeNull();
    }
  });

  it('the table is valid, versioned and sourced', () => {
    expect(validatePricing(table)).toEqual([]);
    expect(PRICE_TABLE_VERSION).toBe(table.version);
  });

  it('a malformed table is caught', () => {
    expect(
      validatePricing({ version: '', currency: 'ZWL', per_million_tokens: { x: { input: -1 } } })
        .length,
    ).toBeGreaterThan(3);
  });

  it('the cost fields are on the usage-event allowlist, and carry no content', () => {
    expect(USAGE_EVENT_FIELDS).toContain('costUsdEstimate');
    expect(USAGE_EVENT_FIELDS).toContain('priceTableVersion');
  });
});
