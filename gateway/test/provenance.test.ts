// Rule 2 of CLAUDE.md: only open_weight provenance may train Shamwari Mind.
//
// router.test.ts covers the licenceClass stamped on the tier that was
// *requested*. This file covers the one resolved from the model that
// actually *served*, which is the only one a training row may carry.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { resolveLicenseClass, openWeightModels, WORKERS_AI_FALLBACK_MODEL } from '../src/provenance';

beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

describe('resolveLicenseClass', () => {
  it('admits the configured Kimi and Qwen models', () => {
    expect(resolveLicenseClass('moonshot', 'kimi-k3')).toBe('open_weight');
    expect(resolveLicenseClass('qwen', 'qwen3.8-max')).toBe('open_weight');
  });

  it('admits the Workers AI fallback under its real model id', () => {
    expect(resolveLicenseClass('workers-ai', WORKERS_AI_FALLBACK_MODEL)).toBe('open_weight');
  });

  it('fails closed for a model nobody has read the terms of', () => {
    // The whole point. An unlisted model is not assumed permissive just
    // because it sits behind a provider whose other models are.
    expect(resolveLicenseClass('moonshot', 'kimi-k9-unreleased')).toBe('restricted');
    expect(resolveLicenseClass('qwen', 'qwen-some-new-thing')).toBe('restricted');
  });

  it('fails closed for the providers whose terms bar training outright', () => {
    expect(resolveLicenseClass('anthropic', 'claude-opus-5')).toBe('restricted');
    expect(resolveLicenseClass('openai', 'gpt-5')).toBe('restricted');
  });

  it('warns when it stamps restricted, so a silent corpus loss is visible', () => {
    resolveLicenseClass('openai', 'gpt-5');
    expect(console.warn).toHaveBeenCalled();
  });

  it('is insensitive to casing and padding from a provider header', () => {
    expect(resolveLicenseClass(' Moonshot ', ' Kimi-K3 ')).toBe('open_weight');
  });

  it('never admits a bare provider or a bare model', () => {
    expect(resolveLicenseClass('moonshot', '')).toBe('restricted');
    expect(resolveLicenseClass('', 'kimi-k3')).toBe('restricted');
  });

  it('keeps every allowlist entry lowercase, or lookups silently miss', () => {
    for (const entry of openWeightModels) {
      expect(entry).toBe(entry.toLowerCase());
    }
  });
});
