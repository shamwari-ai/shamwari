// Rule 2 of CLAUDE.md: only open_weight provenance may train Shamwari Mind.
// licenseClass is stamped here, at generation time, and never inferred later.
import { describe, expect, it } from 'vitest';
import { route, targets } from '../src/router';
import type { Env, Message } from '../src/types';

const env = {
  ECONOMY_MODEL: 'qwen3-32b-instruct',
  STANDARD_MODEL: 'kimi-k3',
} as unknown as Env;

const user = (content: string): Message => ({ role: 'user', content });

describe('targets', () => {
  it('marks both live tiers open_weight so they stay Mind-trainable', () => {
    const t = targets(env);
    expect(t.economy.licenseClass).toBe('open_weight');
    expect(t.standard.licenseClass).toBe('open_weight');
  });

  it('keeps premium restricted and unconfigured', () => {
    const t = targets(env);
    expect(t.premium.licenseClass).toBe('restricted');
    expect(t.premium.provider).toBe('unconfigured');
    expect(t.premium.directUrl).toBe('');
  });
});

describe('route', () => {
  it('honours an explicit model request', () => {
    expect(route([user('hi')], 'shamwari-standard', env).tier).toBe('standard');
    expect(route([user('calculate my PAYE')], 'shamwari-economy', env).tier).toBe('economy');
  });

  it('defaults to economy for short, simple turns', () => {
    expect(route([user('Mhoro, urikuita sei?')], undefined, env).tier).toBe('economy');
  });

  it('escalates on hard-task keywords, in English and in Shona', () => {
    expect(route([user('Please calculate my PAYE for August')], undefined, env).tier).toBe(
      'standard',
    );
    expect(route([user('Tsanangura mutero wangu')], undefined, env).tier).toBe('standard');
  });

  it('escalates on long input or long conversations', () => {
    expect(route([user('a'.repeat(6001))], undefined, env).tier).toBe('standard');
    expect(route(Array.from({ length: 13 }, () => user('hi')), undefined, env).tier).toBe(
      'standard',
    );
  });

  it('reads model ids from env rather than hardcoding them', () => {
    expect(route([user('hi')], undefined, env).model).toBe('qwen3-32b-instruct');
    expect(route([user('hi')], 'shamwari-standard', env).model).toBe('kimi-k3');
  });
});
