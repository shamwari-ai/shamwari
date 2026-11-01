import { describe, expect, it } from 'vitest';
import { BUDGET, byteLength, clampBytes } from '../src/lib/budget';
import { createClient } from '../src/lib/client';
import { dequeue, enqueue, parseQueue } from '../src/lib/queue';

const ask = (id: string, question: string) => ({ id, question, createdAt: 1 });

describe('queue', () => {
  it('refuses personal scope (Rule 1: a stored ask is delivered to Cloud later)', () => {
    expect(enqueue([], ask('a', 'my payslip'), 'personal')).toEqual({ ok: false, reason: 'personal_scope' });
  });
  it('enforces the byte budget', () => {
    expect(enqueue([], ask('a', 'x'.repeat(BUDGET.maxQuestionBytes + 1)))).toEqual({ ok: false, reason: 'too_long' });
    let q = [] as ReturnType<typeof parseQueue>;
    for (let i = 0; i < BUDGET.maxQueueBytes / BUDGET.maxQuestionBytes; i++) {
      const r = enqueue(q, ask(String(i), 'x'.repeat(BUDGET.maxQuestionBytes)));
      expect(r.ok).toBe(true); if (r.ok) q = r.queue;
    }
    expect(enqueue(q, ask('z', 'x'))).toEqual({ ok: false, reason: 'queue_full' });
  });
  it('dequeues by id and survives a corrupt store', () => {
    expect(dequeue([ask('a', 'q'), ask('b', 'q')], 'a').map((a) => a.id)).toEqual(['b']);
    expect(parseQueue('{not json')).toEqual([]);
    expect(parseQueue(JSON.stringify([{ id: 1 }, ask('ok', 'q')]))).toEqual([ask('ok', 'q')]);
  });
});

describe('budget', () => {
  it('never splits a multi-byte character', () => {
    const r = clampBytes('ndinokutendai ñ'.repeat(400), 100);
    expect(byteLength(r.text)).toBeLessThanOrEqual(100);
    expect(r.clipped).toBe(true);
  });
});

describe('client contract', () => {
  const body = { id: 'r1', choices: [{ message: { role: 'assistant', content: 'Section 56 says…' }, finish_reason: 'stop' }],
    shamwari: { scope: 'platform', grounded: true, inference_path: 'gateway', citations: [{ title: 'Constitution', heading: 'Section 56', authority: 'Parliament', url: 'javascript:alert(1)' }] } };
  it('sends the idempotency key, never claims personal scope, parses citations and drops unsafe links', async () => {
    let seen: { headers: Record<string, string>; body: string } | null = null;
    const c = createClient({ baseUrl: 'https://x.test/', getKey: () => 'k',
      fetch: (async (_u: unknown, init: { headers: Record<string, string>; body: string }) => { seen = init; return new Response(JSON.stringify(body)); }) as unknown as typeof fetch });
    const r = await c.ask({ messages: [{ role: 'user', content: 'q' }], scope: 'personal' }, { idempotencyKey: 'abc' });
    expect(seen!.headers['Idempotency-Key']).toBe('abc');
    expect(JSON.parse(seen!.body).scope).toBe('platform');
    expect(r.ok && r.value.citations[0]).toMatchObject({ title: 'Constitution', url: null });
  });
  it('maps the Rule 1 refusal to its own kind and offline to offline', async () => {
    const mk = (f: typeof fetch) => createClient({ baseUrl: 'https://x.test', getKey: () => 'k', fetch: f });
    const r409 = await mk((async () => new Response(JSON.stringify({ error: 'scope_requires_local_inference' }), { status: 409 })) as unknown as typeof fetch).ask({ messages: [] });
    expect(!r409.ok && r409.error.kind).toBe('scope_requires_local_inference');
    const off = await mk((async () => { throw new Error('net'); }) as unknown as typeof fetch).ask({ messages: [] });
    expect(!off.ok && off.error.kind).toBe('offline');
  });
});
