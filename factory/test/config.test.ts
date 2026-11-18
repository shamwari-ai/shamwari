import { describe, expect, it } from "vitest";
import wranglerText from "../wrangler.jsonc?raw";
import packageText from "../package.json?raw";
import dockerfile from "../Dockerfile?raw";

/** Comments and trailing commas out, strings left alone. */
function parseJsonc(text: string): Record<string, unknown> {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inString) {
      out += c;
      if (c === "\\") out += text[++i] ?? "";
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
      out += c;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      i = text.indexOf("*/", i + 2) + 1;
    } else out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

const cfg = parseJsonc(wranglerText);

describe("nothing here is live", () => {
  it("wrangler.jsonc declares only the allowed keys, so nothing can be switched on", () => {
    // An allow-list, not a deny-list: routes, custom domains, secrets store bindings,
    // services, env.*, triggers... all fail here until the owner changes this test too.
    const allowed = [
      "$schema",
      "name",
      "main",
      "compatibility_date",
      "compatibility_flags",
      "observability",
      "workers_dev",
      "preview_urls",
      "vars",
      "containers",
      "durable_objects",
      "exports",
    ];
    expect(Object.keys(cfg).sort()).toEqual([...allowed].sort());
    expect(cfg.workers_dev).toBe(false);
    expect(cfg.preview_urls).toBe(false);
    expect(cfg).not.toHaveProperty("routes");
    expect(cfg).not.toHaveProperty("route");
  });

  it("the only variable is the public gateway origin", () => {
    expect(cfg.vars).toEqual({ GATEWAY_ORIGIN: "https://api.shamwari.ai" });
  });

  it("each workspace object owns one container, started by the object itself", () => {
    const containers = cfg.containers as Record<string, unknown>[];
    expect(containers).toHaveLength(1);
    expect(containers[0]!.class_name).toBe("FactoryWorkspace");
    expect(containers[0]!.scheduling_policy).toBe("durable_object");
    expect(containers[0]).not.toHaveProperty("max_instances");
  });
});

describe("pins agree", () => {
  it("the sandbox-shim image tag matches the @cloudflare/sandbox version", () => {
    const pkg = JSON.parse(packageText) as {
      dependencies: Record<string, string>;
    };
    const v = pkg.dependencies["@cloudflare/sandbox"]!;
    expect(v).toMatch(/^\d+\.\d+\.\d+$/);
    expect(dockerfile).toContain(`docker.io/cloudflare/sandbox:${v}@sha256:`);
  });

  it("every dependency is an exact version", () => {
    const pkg = JSON.parse(packageText) as Record<
      string,
      Record<string, string>
    >;
    for (const group of ["dependencies", "devDependencies"])
      for (const [n, v] of Object.entries(pkg[group] ?? {}))
        expect(v, n).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("every base image is pinned by digest", () => {
    const froms = dockerfile
      .split("\n")
      .filter((l: string) => l.startsWith("FROM "));
    expect(froms.length).toBeGreaterThan(0);
    for (const f of froms) expect(f).toMatch(/@sha256:[0-9a-f]{64}/);
  });
});

describe("the source names no inference provider and holds no credential", () => {
  it("no provider host or provider key name appears in src/", () => {
    const sources = import.meta.glob("../src/**/*.ts", {
      query: "?raw",
      import: "default",
      eager: true,
    });
    expect(Object.keys(sources).length).toBeGreaterThan(5);
    const bad =
      /(api\.openai\.com|anthropic\.com|api\.z\.ai|moonshot|dashscope|groq|mistral|openrouter|deepseek|opencode\.ai\/inference|OPENAI_API_KEY|ANTHROPIC_API_KEY|sk_shamwari_)/i;
    for (const [f, text] of Object.entries(sources))
      expect(text, f).not.toMatch(bad);
  });
});
