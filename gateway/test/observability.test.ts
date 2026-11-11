// Workers Logs persist at sampling 1, so what reaches a log line is what is stored (Rule 1:
// personal data must not land in persisted logs). These fail if observability is dropped, if the
// gateway stops redacting query strings, or if a log line can carry a header, cookie, body,
// prompt, token or answer. The site Workers have the same checks in site/test/worker/observability.test.ts.
import { describe, expect, it } from "vitest";
import gateway from "../wrangler.jsonc?raw";

const config = JSON.parse(
  gateway.replace(/^\s*\/\/.*$/gm, "").replace(/,(\s*[}\]])/g, "$1"),
) as {
  observability?: {
    enabled?: boolean;
    redact_query_string?: boolean;
    logs?: { enabled?: boolean };
    issue_detection?: { enabled?: boolean };
  };
};

describe("gateway observability", () => {
  it("has logs and issue detection on, and redacts query strings", () => {
    const o = config.observability;
    expect(o?.enabled).toBe(true);
    expect(o?.logs?.enabled).toBe(true);
    expect(o?.issue_detection?.enabled).toBe(true);
    expect(o?.redact_query_string).toBe(true);
  });
});

describe("gateway log lines carry messages only", () => {
  // Vite reads the sources as text; the gateway has no Node types, so no fs here.
  const sources = import.meta.glob("../src/**/*.ts", {
    query: "?raw",
    import: "default",
    eager: true,
  });
  const forbidden =
    /\b(headers?|cookies?|body|request|req|prompt|answer|token|authorization|secret|password)\b/i;

  it("finds the sources it scans", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(5);
  });

  it("no console call passes a header, cookie, body, prompt, token or answer value", () => {
    for (const [file, src] of Object.entries(sources)) {
      for (const m of src.matchAll(
        /console\.(?:log|info|warn|error|debug)\(([\s\S]*?)\);/g,
      )) {
        // Only the literal message text may name these words; no argument may be a value of one.
        const args = (m[1] ?? "").replace(
          /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g,
          "",
        );
        expect(args, `${file}: console call passes ${m[1]}`).not.toMatch(
          forbidden,
        );
      }
    }
  });
});
