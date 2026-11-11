// Workers Logs persist at sampling 1, so what reaches a log line is what is stored (Rule 1:
// personal data must not land in persisted logs). These fail if observability is dropped, if a
// Worker that sees sign-in traffic stops redacting query strings, or if a log line can carry a
// header, cookie, body, prompt, token or answer.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import gateway from '../wrangler.jsonc?raw';
import siteApp from '../../site/wrangler.app.jsonc?raw';
import site from '../../site/wrangler.jsonc?raw';

const parse = (raw: string) =>
  JSON.parse(raw.replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1')) as {
    observability?: {
      enabled?: boolean;
      redact_query_string?: boolean;
      logs?: { enabled?: boolean; persist?: boolean };
      issue_detection?: { enabled?: boolean };
    };
  };

describe('observability in the wrangler configs', () => {
  const configs = { gateway, 'shamwari-app': siteApp, 'shamwari-site': site };
  for (const [name, raw] of Object.entries(configs)) {
    it(`${name} has logs and issue detection on`, () => {
      const o = parse(raw).observability;
      expect(o?.enabled).toBe(true);
      expect(o?.logs?.enabled).toBe(true);
      expect(o?.issue_detection?.enabled).toBe(true);
    });
  }

  it('redacts query strings on shamwari-app and the gateway', () => {
    expect(parse(siteApp).observability?.redact_query_string).toBe(true);
    expect(parse(gateway).observability?.redact_query_string).toBe(true);
  });
});

describe('log lines carry messages only', () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
    });
  const forbidden = /\b(headers?|cookies?|body|request|req|prompt|answer|token|authorization|secret|password)\b/i;
  const roots = [join(__dirname, '../src'), join(__dirname, '../../site/worker')];

  it('no console call mentions a header, cookie, body, prompt, token or answer value', () => {
    for (const file of roots.flatMap(files)) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/console\.(?:log|info|warn|error|debug)\(([\s\S]*?)\);/g)) {
        // Only the literal message text may name these words; no argument may be a value of one.
        const args = m[1].replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g, '');
        expect(args, `${file}: console call passes ${m[1]}`).not.toMatch(forbidden);
      }
    }
  });
});
