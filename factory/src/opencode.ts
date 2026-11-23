/**
 * What OpenCode inside the container is told: its configuration
 * (OPENCODE_CONFIG_CONTENT) and the environment of the `opencode serve`
 * process. Pure, so the tests can check both without a container.
 *
 * Two promises are kept here and held by test/opencode.test.ts:
 *
 *  1. The ONLY model path is the Shamwari gateway. One provider is defined
 *     (`shamwari`, OpenAI-compatible, pointed at the gateway's /v1), and
 *     `enabled_providers` names only it, so the providers built into the
 *     OpenCode binary (its own hosted models among them) are switched off.
 *     The egress allow-list (egress.ts) is the hard backstop: a provider that
 *     slipped through would still be refused at the container's edge.
 *  2. No credential is in the container. The provider's `apiKey` is a fixed
 *     placeholder; the Worker's outbound handler replaces the Authorization
 *     header on the way out (egress.ts). Nothing from the person's Shamwari
 *     account (memories, skills, chat history) is passed in either: OpenCode
 *     works on the code repositories the person clones, and nothing else.
 *
 * The configuration uses the shape of the PINNED OpenCode release (1.19.4,
 * `ConfigV1` in packages/core/src/v1/config/config.ts at tag v1.19.4): a
 * `provider` map with `npm`/`options`/`models`. The newer `providers` /
 * `package` / `settings` shape on opencode.ai/docs is OpenCode 2.x; 1.19.4
 * reports it as unsupported and ignores it, which would leave the gateway
 * provider undefined. Moving to 2.x means changing this file and the image
 * together (test/opencode.test.ts pins the 1.19.4 key set).
 */

/** Pinned in the Dockerfile; the tests read the Dockerfile and fail if the two disagree. */
export const OPENCODE_VERSION = "1.19.4";

/** The provider id. Model references are `shamwari/<model>`. */
export const PROVIDER_ID = "shamwari";

/**
 * Sent as the API key. Not a credential: the outbound handler removes it and
 * sets the person's own gateway authorisation in the Worker.
 */
export const API_KEY_PLACEHOLDER = "provided-by-worker";

/**
 * The models the gateway already routes (gateway/routing-policy.json
 * `model_aliases`): both are open-weight GLM models on Workers AI
 * (gateway/wrangler.jsonc ECONOMY_MODEL / STANDARD_MODEL). No route is added
 * here; a code-specialised "factory" tier is an owner step in the gateway
 * (docs/factory.md).
 */
export const MODELS = {
  "shamwari-standard": "Shamwari Standard (GLM, open weights)",
  "shamwari-economy": "Shamwari Economy (GLM, open weights)",
} as const;
export type ModelId = keyof typeof MODELS;

export const DEFAULT_MODEL: ModelId = "shamwari-standard";
export const SMALL_MODEL: ModelId = "shamwari-economy";

/**
 * The gateway caps a generation at 2048 tokens (gateway/src/router.ts
 * DEFAULT_MAX_OUTPUT_TOKENS). Saying so here keeps OpenCode from asking for
 * more and being cut off without knowing why.
 */
const OUTPUT_LIMIT = 2048;
const CONTEXT_LIMIT = 128_000;

export interface OpencodeConfig {
  $schema: string;
  enabled_providers: string[];
  model: string;
  small_model: string;
  autoupdate: false;
  share: "disabled";
  plugin: string[];
  mcp: Record<string, never>;
  provider: Record<
    string,
    {
      npm: string;
      name: string;
      options: { baseURL: string; apiKey: string };
      models: Record<
        string,
        {
          name: string;
          tool_call: boolean;
          limit: { context: number; output: number };
        }
      >;
    }
  >;
}

/** The gateway's OpenAI-compatible base: `<origin>/v1`. HTTPS only. */
export function gatewayBaseUrl(gatewayOrigin: string): string {
  const u = new URL(gatewayOrigin);
  if (u.protocol !== "https:") throw new Error("GATEWAY_ORIGIN must be https");
  return `${u.origin}/v1`;
}

export function opencodeConfig(gatewayOrigin: string): OpencodeConfig {
  const models: OpencodeConfig["provider"][string]["models"] = {};
  for (const [id, name] of Object.entries(MODELS)) {
    models[id] = {
      name,
      tool_call: true,
      limit: { context: CONTEXT_LIMIT, output: OUTPUT_LIMIT },
    };
  }
  return {
    $schema: "https://opencode.ai/config.json",
    // ONLY this provider. Everything built into the binary is ignored.
    enabled_providers: [PROVIDER_ID],
    model: `${PROVIDER_ID}/${DEFAULT_MODEL}`,
    small_model: `${PROVIDER_ID}/${SMALL_MODEL}`,
    autoupdate: false,
    share: "disabled",
    // No plugins and no MCP servers: each is code or a network path we did
    // not choose. (The egress allow-list would refuse their downloads anyway.)
    plugin: [],
    mcp: {},
    provider: {
      [PROVIDER_ID]: {
        // Bundled in the 1.19.4 binary (BUNDLED_PROVIDERS in
        // packages/opencode/src/provider/provider.ts), so nothing is fetched
        // from npm at run time.
        npm: "@ai-sdk/openai-compatible",
        name: "Shamwari",
        options: {
          baseURL: gatewayBaseUrl(gatewayOrigin),
          apiKey: API_KEY_PLACEHOLDER,
        },
        models,
      },
    },
  };
}

/**
 * The container's trust for the HTTPS intercept. Every HTTPS request from the
 * container goes through the Worker (egress.ts), which answers with a
 * certificate from this CA, so the CA alone is the trust store (as in
 * Cloudflare's coding-agent runner).
 */
export const CA_PATH = "/etc/cloudflare/certs/cloudflare-containers-ca.crt";
export const TRUST_ENV = {
  NODE_EXTRA_CA_CERTS: CA_PATH,
  GIT_SSL_CAINFO: CA_PATH,
  CURL_CA_BUNDLE: CA_PATH,
  SSL_CERT_FILE: CA_PATH,
} as const;

/**
 * The environment of `opencode serve`. Every value is either a switch, a
 * path, or the configuration above: test/opencode.test.ts fails if any value
 * looks like a credential or carries a value from the Worker's secrets.
 */
export function opencodeEnv(gatewayOrigin: string): Record<string, string> {
  return {
    ...TRUST_ENV,
    OPENCODE_CONFIG_CONTENT: JSON.stringify(opencodeConfig(gatewayOrigin)),
    // Use the model list built into the binary; no update check; no default
    // plugins; no language-server downloads (as Cloudflare's OpenCode guide).
    OPENCODE_DISABLE_MODELS_FETCH: "1",
    OPENCODE_DISABLE_AUTOUPDATE: "1",
    OPENCODE_DISABLE_DEFAULT_PLUGINS: "1",
    OPENCODE_DISABLE_LSP_DOWNLOAD: "1",
    // Cloudflare's guide sets this, but the 1.19.4 binary does not read it;
    // `share: "disabled"` in the configuration is what turns sharing off. Kept
    // so a later release that reads it is covered too.
    OPENCODE_DISABLE_SHARE: "1",
    // A repository someone clones must not be able to add a provider, a
    // plugin or an MCP server through its own opencode.json.
    OPENCODE_DISABLE_PROJECT_CONFIG: "1",
    // No skills or prompts from anywhere but this configuration: the
    // container holds no personal-layer material and must not go looking.
    OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
    OPENCODE_DISABLE_CLAUDE_CODE: "1",
  };
}

export const OPENCODE_PORT = 4096;
export const OPENCODE_ARGV = [
  "opencode",
  "serve",
  "--port",
  String(OPENCODE_PORT),
  "--hostname",
  "0.0.0.0",
];
