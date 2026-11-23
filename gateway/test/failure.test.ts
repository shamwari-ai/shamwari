import { describe, expect, it } from 'vitest';
import { clean, fromBody, fromError, InferenceFailed, MESSAGE_MAX, publicReasons, REASONS_MAX } from '../src/failure';

describe('why an answer failed reaches the app, and nothing secret goes with it', () => {
  it("reads AI Gateway's own error body: the guardrail block that hid behind a bare 424 (2026-11-23)", () => {
    const body = JSON.stringify({
      success: false,
      result: [],
      messages: [],
      error: [{ code: 2016, message: 'Prompt blocked due to security configurations' }],
      name: 'AiGatewayError',
      httpCode: 424,
      internalCode: 2016,
      message: 'Prompt blocked due to security configurations',
    });
    expect(fromBody('ai-gateway', 424, body)).toEqual({
      step: 'ai-gateway',
      status: 424,
      code: 2016,
      message: 'Prompt blocked due to security configurations',
    });
  });

  it('reads an OpenAI-style error, and a body that is not JSON at all', () => {
    expect(fromBody('ai-gateway', 429, JSON.stringify({ error: { code: 'rate_limited', message: 'Too many requests' } }))).toEqual({
      step: 'ai-gateway',
      status: 429,
      code: 'rate_limited',
      message: 'Too many requests',
    });
    expect(fromBody('ai-gateway', 502, '<html>Bad gateway</html>')).toEqual({ step: 'ai-gateway', status: 502, message: '<html>Bad gateway</html>' });
    expect(fromBody('ai-gateway', 500, '')).toEqual({ step: 'ai-gateway', status: 500, message: 'HTTP 500' });
  });

  it('never lets a URL (it carries the account id), a credential, a long id or a token out', () => {
    const leaky =
      'POST https://gateway.ai.cloudflare.com/v1/125a2dfbc21f76a25c980609609e8218/shamwari/compat failed: Bearer sk_live_abc123 ' +
      'id 125a2dfbc21f76a25c980609609e8218 token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9eyJzdWIiOiIxMjM0NTY3ODkwIn0';
    const out = clean(leaky);
    expect(out).not.toMatch(/https?:/);
    expect(out).not.toContain('125a2dfbc21f76a25c980609609e8218');
    expect(out).not.toContain('sk_live_abc123');
    expect(out).not.toContain('eyJhbGci');
    expect(out).toContain('[url]');
    expect(out).toContain('[credential]');
  });

  it('keeps a message to one bounded line, and never empty', () => {
    expect(clean('a\n\n  b')).toBe('a b');
    expect(clean('word '.repeat(300)).length).toBe(MESSAGE_MAX);
    expect(clean('')).toBe('no detail given');
    expect(clean(new Error('kv down'))).toBe('kv down');
    expect(fromError('workers-ai', new Error('3040: capacity exceeded'))).toEqual({ step: 'workers-ai', message: '3040: capacity exceeded' });
  });

  it('sends at most a few reasons, each cleaned again on the way out', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ step: 'ai-gateway' as const, message: `try ${i} https://x.example/secret` }));
    const out = publicReasons(many);
    expect(out).toHaveLength(REASONS_MAX);
    expect(out[0]!.message).toBe('try 0 [url]');
  });

  it('InferenceFailed carries every step, and says them in its own message for the logs', () => {
    const e = new InferenceFailed([
      { step: 'ai-gateway', status: 424, code: 2016, message: 'Prompt blocked due to security configurations' },
      { step: 'workers-ai', message: 'workers ai returned no text' },
    ]);
    expect(e.failures).toHaveLength(2);
    expect(e.message).toBe(
      'every inference step failed: ai-gateway 424: Prompt blocked due to security configurations; workers-ai: workers ai returned no text',
    );
  });
});
