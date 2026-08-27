// dynamic-route.json is posted to Cloudflare, not bundled into the Worker,
// so nothing else would catch a hand-edit that breaks it. These are the
// checks that do not need the API: graph integrity, and the rule-2
// invariant that every path through the route stays open-weight.
//
// The element shapes themselves were validated against Cloudflare's own
// POST /routes schema. `properties.conditions` and `rate.key` semantics are
// undocumented upstream — see gateway/README.md.
import { describe, expect, it } from 'vitest';
import route from '../dynamic-route.json';
import phase1 from '../dynamic-route-phase1.json';

type Element = {
  id: string;
  type: string;
  outputs: Record<string, { elementId: string }>;
  properties?: Record<string, unknown>;
};

const elements = route.elements as Element[];
const ids = new Set(elements.map((e) => e.id));
const edges = elements.flatMap((e) =>
  Object.entries(e.outputs ?? {}).map(([label, o]) => ({ from: e.id, label, to: o.elementId })),
);
const byType = (t: string) => elements.filter((e) => e.type === t);

describe('the dynamic route graph', () => {
  it('has exactly one start and one end', () => {
    expect(byType('start')).toHaveLength(1);
    expect(byType('end')).toHaveLength(1);
  });

  it('has no duplicate element ids', () => {
    expect(ids.size).toBe(elements.length);
  });

  it('has no dangling elementId', () => {
    const dangling = edges.filter((e) => !ids.has(e.to));
    expect(dangling).toEqual([]);
  });

  it('reaches every element from start', () => {
    const seen = new Set<string>();
    const stack = [byType('start')[0]?.id as string];
    while (stack.length) {
      const n = stack.pop() as string;
      if (seen.has(n)) continue;
      seen.add(n);
      for (const e of edges) if (e.from === n) stack.push(e.to);
    }
    expect([...ids].filter((id) => !seen.has(id))).toEqual([]);
  });

  it('gives every model and rate node both a success and a fallback', () => {
    for (const e of elements) {
      if (e.type !== 'model' && e.type !== 'rate') continue;
      expect(Object.keys(e.outputs).sort()).toEqual(['fallback', 'success']);
    }
  });

  it('gives the conditional both branches', () => {
    for (const e of byType('conditional')) {
      expect(Object.keys(e.outputs).sort()).toEqual(['false', 'true']);
    }
  });
});

describe('rule 2 — every path stays open-weight', () => {
  // The Worker stamps licenseClass from the tier it intended to call. A
  // fallback chain can answer from a different provider without telling it,
  // so the stamp is only true while every reachable provider is
  // open-weight. Adding a restricted provider here means the Worker must
  // stamp from the cf-aig-provider response header instead.
  // 'qwen' and 'moonshot' are custom-provider slugs this account must
  // create; 'workersai' is the native Cloudflare one. See
  // docs/workers-ai-models.md — 'workers-ai' with a hyphen is not valid.
  const OPEN_WEIGHT = new Set(['qwen', 'moonshot', 'workersai']);

  it('routes only to open-weight providers', () => {
    const providers = byType('model').map((e) => e.properties?.provider as string);
    expect(providers.length).toBeGreaterThan(0);
    for (const p of providers) expect(OPEN_WEIGHT).toContain(p);
  });

  it('names no restricted provider anywhere in the file', () => {
    const flat = JSON.stringify(route).toLowerCase();
    for (const restricted of ['anthropic', 'claude', 'openai', 'gpt-', 'azure']) {
      expect(flat).not.toContain(restricted);
    }
  });
});

describe('the route matches the Worker it fronts', () => {
  it('offers a node per live tier plus the last-resort fallback', () => {
    expect(byType('model')).toHaveLength(3);
  });

  it('caps spend before choosing a model', () => {
    const [rate] = byType('rate');
    expect(rate).toBeDefined();
    expect(rate?.properties?.limitType).toBe('cost');
    // Reached directly from start, so the cap cannot be bypassed by a branch.
    const startId = byType('start')[0]?.id;
    expect(edges.find((e) => e.from === startId)?.to).toBe(rate?.id);
  });

  it('degrades to economy when the cap is hit rather than failing the request', () => {
    const [rate] = byType('rate');
    const fallback = rate?.outputs.fallback?.elementId;
    const target = elements.find((e) => e.id === fallback);
    expect(target?.properties?.provider).toBe('qwen');
  });
});

// Phase 1 is a paste target for the dashboard's JSON view, so a broken graph
// there fails silently in someone's browser rather than in CI.
describe('dynamic-route-phase1.json', () => {
  const ph1 = phase1 as Element[];
  const p1ids = new Set(ph1.map((e) => e.id));
  const p1edges = ph1.flatMap((e) =>
    Object.entries(e.outputs ?? {}).map(([, o]) => ({ from: e.id, to: o.elementId })),
  );

  it('is a closed graph with one start and one end', () => {
    expect(ph1.filter((e) => e.type === 'start')).toHaveLength(1);
    expect(ph1.filter((e) => e.type === 'end')).toHaveLength(1);
    expect(p1edges.filter((e) => !p1ids.has(e.to))).toEqual([]);
  });

  it('needs no custom provider — every node is on workersai', () => {
    for (const e of ph1.filter((x) => x.type === 'model')) {
      expect(e.properties?.provider).toBe('workersai');
    }
  });

  it('uses @cf/ model ids, which is what workersai accepts', () => {
    for (const e of ph1.filter((x) => x.type === 'model')) {
      expect(e.properties?.model as string).toMatch(/^@cf\/[a-z0-9._-]+\/[a-zA-Z0-9._-]+$/);
    }
  });

  it('routes to no code-specialised model — the corpus is law and tax, not code', () => {
    for (const e of ph1.filter((x) => x.type === 'model')) {
      expect(e.properties?.model as string).not.toMatch(/coder|-code/);
    }
  });
});
