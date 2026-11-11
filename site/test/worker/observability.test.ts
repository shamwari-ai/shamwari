// The same checks as gateway/test/observability.test.ts, for the site Workers: logs persist, so
// shamwari-app redacts query strings (/lite/callback carries the OAuth code and state) and no
// log line passes a header, cookie, body, prompt, token or answer.
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

type Config = {
  observability?: {
    enabled?: boolean;
    redact_query_string?: boolean;
    logs?: { enabled?: boolean };
    issue_detection?: { enabled?: boolean };
  };
};
const load = (path: string): Config =>
  JSON.parse(
    readFileSync(new URL(path, import.meta.url), "utf8")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/,(\s*[}\]])/g, "$1"),
  ) as Config;

describe("site observability", () => {
  for (const [name, path] of [
    ["shamwari-app", "../../wrangler.app.jsonc"],
    ["shamwari-site", "../../wrangler.jsonc"],
  ] as const) {
    it(`${name} has logs and issue detection on`, () => {
      const o = load(path).observability;
      expect(o?.enabled).toBe(true);
      expect(o?.logs?.enabled).toBe(true);
      expect(o?.issue_detection?.enabled).toBe(true);
    });
  }

  it("shamwari-app redacts query strings", () => {
    expect(
      load("../../wrangler.app.jsonc").observability?.redact_query_string,
    ).toBe(true);
  });
});

describe("site Worker log lines carry messages only", () => {
  const dir = new URL("../../worker/", import.meta.url);
  const forbidden =
    /\b(headers?|cookies?|body|request|req|prompt|answer|token|authorization|secret|password)\b/i;

  it("no console call passes a header, cookie, body, prompt, token or answer value", () => {
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const src = readFileSync(new URL(f, dir), "utf8");
      for (const m of src.matchAll(
        /console\.(?:log|info|warn|error|debug)\(([\s\S]*?)\);/g,
      )) {
        const args = (m[1] ?? "").replace(
          /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g,
          "",
        );
        expect(args, `${f}: console call passes ${m[1]}`).not.toMatch(
          forbidden,
        );
      }
    }
  });
});
