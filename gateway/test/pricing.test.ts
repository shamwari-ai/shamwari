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

  it('an unmeasured answer (zero tokens) and an unpriced model are null, never zero', () => {
    // The Workers AI fallback reports no usage; that must not read as free.
    expect(estimateCostUsd('workers-ai/@cf/zai-org/glm-5.3-flash', 0, 0)).toBeNull();
    expect(estimateCostUsd('workers-ai/@cf/zai-org/glm-5.3-flash', 0, 1)).not.toBeNull();
    expect(estimateCostUsd('workers-ai/@cf/some/unlisted', 1000, 1000)).toBeNull();
    expect(estimateCostUsd(null, 1000, 1000)).toBeNull();
    expect(estimateCostUsd(undefined, 1, 1)).toBeNull();
  });

  it('every model the provenance allowlist serves from Workers AI is priced', () => {
    for (const k of ['workers-ai/@cf/zai-org/glm-5.3-flash', 'workers-ai/@cf/zai-org/glm-5.3']) {
      expect(estimateCostUsd(k, 1, 1)).not.toBeNull();
    }
  });

  it('matches the model the way provenance does: case and padding do not hide a priced model', () => {
    const exact = estimateCostUsd('workers-ai/@cf/zai-org/glm-5.3-flash', 10, 10);
    expect(estimateCostUsd(' Workers-AI/@cf/zai-org/GLM-5.3-Flash ', 10, 10)).toBe(exact);
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
