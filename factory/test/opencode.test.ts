import { describe, expect, it } from "vitest";
import dockerfile from "../Dockerfile?raw";
import {
  API_KEY_PLACEHOLDER,
  OPENCODE_VERSION,
  PROVIDER_ID,
  gatewayBaseUrl,
  opencodeConfig,
  opencodeEnv,
} from "../src/opencode";

const GATEWAY = "https://api.shamwari.ai";
const cfg = opencodeConfig(GATEWAY);
const env = opencodeEnv(GATEWAY);

/**
 * The top-level keys OpenCode 1.19.4 accepts: `ConfigV1.Info` in
 * packages/core/src/v1/config/config.ts at tag v1.19.4 (anomalyco/opencode,
 * commit 148842ef7cb1bc34192b3fff57d0f9721ab9c801). OpenCode decodes with
 * `onExcessProperty: "ignore"`, so a key outside this list is not an error,
 * it is silently dropped; this test turns that into a failure.
 */
const V1_19_4_CONFIG_KEYS = new Set(
  "$schema shell logLevel server command skills references reference watcher snapshot plugin share autoshare autoupdate disabled_providers enabled_providers model small_model default_agent subagent_depth username mode agent provider mcp formatter lsp instructions layout permission tools attachment enterprise tool_output compaction experimental".split(
    " ",
  ),
);
/** `ConfigProviderV1.Info` (packages/core/src/v1/config/provider.ts, same tag). */
const V1_19_4_PROVIDER_KEYS = new Set(
  "api name env id npm whitelist blacklist options models".split(" "),
);

describe("OpenCode's configuration: the gateway is the only model path", () => {
  it("defines exactly one provider, shamwari, and enables nothing else", () => {
    expect(Object.keys(cfg.provider)).toEqual([PROVIDER_ID]);
    expect(cfg.enabled_providers).toEqual([PROVIDER_ID]);
  });

  it("every model reference is shamwari/<model>, and those models exist", () => {
    for (const ref of [cfg.model, cfg.small_model]) {
      const [p, m] = ref.split("/");
      expect(p).toBe(PROVIDER_ID);
      expect(cfg.provider[PROVIDER_ID]!.models[m!]).toBeDefined();
    }
  });

  it("points at the gateway's /v1 over HTTPS, with a placeholder key", () => {
    const p = cfg.provider[PROVIDER_ID]!;
    expect(p.npm).toBe("@ai-sdk/openai-compatible");
    expect(p.options.baseURL).toBe("https://api.shamwari.ai/v1");
    expect(p.options.apiKey).toBe(API_KEY_PLACEHOLDER);
    expect(() => gatewayBaseUrl("http://api.shamwari.ai")).toThrow();
  });

  it("turns off updates, sharing, plugins and MCP", () => {
    expect(cfg.autoupdate).toBe(false);
    expect(cfg.share).toBe("disabled");
    expect(cfg.plugin).toEqual([]);
    expect(cfg.mcp).toEqual({});
  });

  it("uses only keys the pinned OpenCode (1.19.4) reads", () => {
    for (const k of Object.keys(cfg))
      expect(V1_19_4_CONFIG_KEYS.has(k), k).toBe(true);
    for (const k of Object.keys(cfg.provider[PROVIDER_ID]!))
      expect(V1_19_4_PROVIDER_KEYS.has(k), k).toBe(true);
    // The OpenCode 2.x shape is ignored by 1.19.4: it must not creep in.
    expect(cfg).not.toHaveProperty("providers");
  });

  it("the Dockerfile installs the OpenCode version this configuration was written for", () => {
    const pins = [
      ...dockerfile.matchAll(/opencode-linux-x64-baseline@([0-9.]+)/g),
    ].map((m) => m[1]);
    expect(pins.length).toBeGreaterThan(0);
    for (const p of pins) expect(p).toBe(OPENCODE_VERSION);
  });
});

describe("no credentials in the container", () => {
  const secretsTheWorkerHolds = [
    "sk_live_workos_api_key_value",
    "a-cookie-password-of-at-least-32-characters",
    "person-token-abc",
  ];

  it("no environment name asks for a credential", () => {
    for (const k of Object.keys(env)) {
      expect(k, k).not.toMatch(
        /(API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH)/i,
      );
    }
  });

  it("no value carries a key, a token or anything the Worker holds", () => {
    const all = JSON.stringify(env);
    for (const s of secretsTheWorkerHolds) expect(all).not.toContain(s);
    expect(all).not.toMatch(
      /sk_shamwari_|sk_live|sk_test|Bearer |eyJ[A-Za-z0-9_-]{10,}/,
    );
    // The only "key" anywhere is the fixed placeholder.
    expect(
      JSON.parse(env.OPENCODE_CONFIG_CONTENT!).provider.shamwari.options.apiKey,
    ).toBe(API_KEY_PLACEHOLDER);
  });

  it("switches off what would fetch code or models, or read config from a cloned repository", () => {
    for (const k of [
      "OPENCODE_DISABLE_MODELS_FETCH",
      "OPENCODE_DISABLE_AUTOUPDATE",
      "OPENCODE_DISABLE_DEFAULT_PLUGINS",
      "OPENCODE_DISABLE_LSP_DOWNLOAD",
      "OPENCODE_DISABLE_PROJECT_CONFIG",
      "OPENCODE_DISABLE_EXTERNAL_SKILLS",
      "OPENCODE_DISABLE_CLAUDE_CODE",
    ])
      expect(env[k], k).toBe("1");
  });

  it("the configuration it carries is the one tested above", () => {
    expect(JSON.parse(env.OPENCODE_CONFIG_CONTENT!)).toEqual(cfg);
  });
});
