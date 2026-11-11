// Rule 1 guard for the LibreChat deployment (CLAUDE.md, docs/librechat.md).
// Pure: takes file contents, returns a list of violations. Empty means clean.
import { parse } from "yaml";

export const GATEWAY = "https://api.shamwari.ai/v1";
export const STUB = "http://127.0.0.1:8787/v1";
export const PRODUCTION_SCOPES = ["platform"];
export const TEST_SCOPES = ["platform", "community", "personal"];
const TOP_LEVEL = ["version", "cache", "interface", "endpoints"];
const PLACEHOLDER_KEY = "SHAMWARI_CHAT_PLACEHOLDER_KEY";
const ENDPOINT_OPTIONS = [
  "name",
  "apiKey",
  "baseURL",
  "models",
  "modelDisplayLabel",
  "titleConvo",
  "addParams",
  "headers",
];
// Model-provider credential or routing names, wherever they appear in our files.
const PROVIDER_KEY =
  /(OPENAI|ANTHROPIC|GOOGLE|GEMINI|GROQ|MISTRAL|OPENROUTER|XAI|DEEPSEEK|MOONSHOT|COHERE|PERPLEXITY|AZURE|BEDROCK|TOGETHER|FIREWORKS)[A-Z_]*(KEY|TOKEN|SECRET)|\b[A-Z_]*API_KEY\b|ZAI_|Z_AI_|REVERSE_PROXY|_BASE_URL|CLOUDFLARE_[A-Z_]*TOKEN/g;
// LibreChat turns these on by default, so a block that is missing is NOT off.
const OFF_BLOCKS = ["agents", "prompts", "marketplace"];
const OFF_FLAGS = ["fileSearch", "parameters"];
// The only variables fly.toml [env] may set. Anything else (a provider base URL, a
// reverse proxy, a new feature flag) is a deliberate change that edits this list.
export const ALLOWED_ENV = [
  "ENDPOINTS",
  "ALLOW_EMAIL_LOGIN",
  "ALLOW_REGISTRATION",
  "ALLOW_SOCIAL_LOGIN",
  "ALLOW_SOCIAL_REGISTRATION",
  "SEARCH",
  "NO_INDEX",
  "DOMAIN_CLIENT",
  "DOMAIN_SERVER",
  PLACEHOLDER_KEY,
  "CONFIG_PATH",
];

/** Drop a trailing # comment, but not a # inside a quoted string. */
function stripComment(line) {
  let q = "";
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === q) q = "";
    } else if (c === '"' || c === "'") q = c;
    else if (c === "#") return line.slice(0, i);
  }
  return line;
}

/** Minimal TOML reader: [section] headers and key = "string" lines. Enough for fly.toml. */
export function parseToml(text) {
  const out = { sections: new Set(), env: {}, unparsed: [] };
  let section = "";
  for (const raw of text.split("\n")) {
    const line = stripComment(raw).trim();
    if (!line) continue;
    const h = line.match(/^\[{1,2}([^\]]+)\]{1,2}$/);
    if (h) {
      section = h[1];
      out.sections.add(section);
      continue;
    }
    if (section !== "env") continue;
    const kv = line.match(/^([A-Za-z0-9_]+)\s*=\s*(?:"(.*)"|'(.*)')$/);
    if (kv) out.env[kv[1]] = kv[2] ?? kv[3];
    else out.unparsed.push(line);
  }
  return out;
}

function checkConfig(
  name,
  yamlText,
  { allowedScopes, allowedBaseURLs, allowedAddresses },
  v,
) {
  let cfg;
  try {
    cfg = parse(yamlText);
  } catch {
    v.push(`${name}: not valid YAML`);
    return;
  }
  for (const k of Object.keys(cfg ?? {})) {
    if (!TOP_LEVEL.includes(k))
      v.push(`${name}: top-level key "${k}" is not on the allowlist`);
  }
  const eps = cfg?.endpoints ?? {};
  for (const k of Object.keys(eps)) {
    if (k === "allowedAddresses" && allowedAddresses) {
      const got = JSON.stringify(eps[k]);
      if (got !== JSON.stringify(allowedAddresses))
        v.push(
          `${name}: allowedAddresses must be exactly ${JSON.stringify(allowedAddresses)}, got ${got}`,
        );
    } else if (k !== "custom") {
      v.push(`${name}: endpoint type "${k}" is not allowed (only custom)`);
    }
  }
  const custom = Array.isArray(eps.custom) ? eps.custom : [];
  if (custom.length === 0) v.push(`${name}: no custom endpoint defined`);
  const extra = (obj, ok) =>
    Object.keys(obj ?? {}).filter((k) => !ok.includes(k));
  for (const e of custom) {
    const label = `${name}: endpoint "${e?.name}"`;
    if (!allowedBaseURLs.includes(e?.baseURL))
      v.push(`${label} baseURL "${e?.baseURL}" is not the gateway`);
    const key = String(e?.apiKey ?? "");
    if (key === "user_provided") v.push(`${label} apiKey is user_provided`);
    else if (key !== "${" + PLACEHOLDER_KEY + "}")
      v.push(`${label} apiKey must be the fixed placeholder reference`);
    if (e?.titleConvo !== false) v.push(`${label} titleConvo must be false`);
    const scope = e?.addParams?.scope;
    if (!allowedScopes.includes(scope))
      v.push(`${label} scope "${scope}" is not allowed here`);
    if (e?.addParams?.stream !== false)
      v.push(`${label} must set stream: false`);
    if (e?.headers?.["X-Shamwari-Channel"] !== "pwa")
      v.push(`${label} must send X-Shamwari-Channel: pwa`);
    for (const k of extra(e?.headers, ["X-Shamwari-Channel"]))
      v.push(`${label} header "${k}" is not allowed`);
    for (const k of extra(e?.addParams, ["scope", "stream"]))
      v.push(`${label} addParams key "${k}" is not allowed`);
    for (const k of extra(e, ENDPOINT_OPTIONS))
      v.push(`${label} option "${k}" is not allowed`);
    if (e?.models?.fetch !== false)
      v.push(`${label} models.fetch must be false`);
  }
  for (const b of OFF_BLOCKS) {
    const blk = cfg?.interface?.[b];
    const values = blk && typeof blk === "object" ? Object.values(blk) : [];
    if (values.length === 0 || values.some((x) => x !== false)) {
      v.push(`${name}: interface.${b} must be present and explicitly off`);
    }
  }
  for (const k of OFF_FLAGS) {
    if (cfg?.interface?.[k] !== false)
      v.push(`${name}: interface.${k} must be present and false`);
  }
}

export function check({ production, test, fly, dockerfile, buildSh, pin }) {
  const v = [];
  checkConfig(
    "librechat.yaml",
    production,
    { allowedScopes: PRODUCTION_SCOPES, allowedBaseURLs: [GATEWAY] },
    v,
  );
  checkConfig(
    "librechat.test.yaml",
    test,
    {
      allowedScopes: TEST_SCOPES,
      allowedBaseURLs: [GATEWAY, STUB],
      allowedAddresses: ["127.0.0.1:8787"],
    },
    v,
  );

  const toml = parseToml(fly);
  const env = toml.env;
  if (env.ENDPOINTS !== "custom")
    v.push('fly.toml: ENDPOINTS must be exactly "custom"');
  for (const k of [
    "ALLOW_EMAIL_LOGIN",
    "ALLOW_REGISTRATION",
    "ALLOW_SOCIAL_LOGIN",
    "ALLOW_SOCIAL_REGISTRATION",
  ]) {
    if (env[k] !== "false")
      v.push(`fly.toml: ${k} must be "false" while sign-in is blocked`);
  }
  if (env.SEARCH !== "false")
    v.push('fly.toml: SEARCH (Meilisearch) must be "false"');
  for (const k of Object.keys(env)) {
    if (!ALLOWED_ENV.includes(k))
      v.push(`fly.toml: env var "${k}" is not on the allowlist`);
  }
  for (const l of toml.unparsed)
    v.push(`fly.toml: could not parse [env] line "${l}"`);
  for (const s of toml.sections) {
    if (
      s === "http_service" ||
      s === "services" ||
      s.startsWith("http_service.") ||
      s.startsWith("services.")
    ) {
      v.push(`fly.toml: [${s}] would expose a public port`);
    }
  }
  if (toml.sections.has("build"))
    v.push(
      "fly.toml: no [build]; deploy a pushed image by reference (see README)",
    );

  const scanned = {
    "fly.toml": fly,
    Dockerfile: dockerfile,
    "build.sh": buildSh,
    "librechat.yaml": production,
    "librechat.test.yaml": test,
  };
  for (const [file, text] of Object.entries(scanned)) {
    for (const m of text.match(PROVIDER_KEY) ?? [])
      v.push(`${file}: provider credential name "${m}"`);
  }

  if (/^ARG\s+BASE_IMAGE\s*=/m.test(dockerfile))
    v.push("Dockerfile: BASE_IMAGE must have no default");
  if (/^\s*ENV\s/m.test(dockerfile))
    v.push("Dockerfile: ENV is not allowed (settings live in fly.toml [env])");
  for (const line of dockerfile.split("\n")) {
    if (/^FROM\s/i.test(line) && !/\$\{BASE_IMAGE\}/.test(line))
      v.push(`Dockerfile: FROM must be \${BASE_IMAGE}, got "${line.trim()}"`);
    if (/:latest\b/.test(line)) v.push("Dockerfile: floating :latest tag");
  }
  const commit = /^commit=([0-9a-f]{40})$/m.exec(pin)?.[1];
  const tag = /^tag=(v\d+\.\d+\.\d+)$/m.exec(pin)?.[1];
  if (!commit) v.push("PIN: commit must be a full 40-hex SHA");
  if (!tag) v.push("PIN: tag must be an exact release tag (no rc, no latest)");
  if (!/rev-parse HEAD/.test(buildSh) || !/PIN/.test(buildSh))
    v.push("build.sh: must verify the checked-out commit against PIN");
  if (!/refs\/tags/.test(buildSh))
    v.push(
      "build.sh: must verify that the tag in PIN resolves to the pinned commit",
    );
  return v;
}
