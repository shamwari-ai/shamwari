import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { check, GATEWAY } from "../guard.mjs";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(join(dir, f), "utf8");
const files = () => ({
  production: read("librechat.yaml"),
  test: read("librechat.test.yaml"),
  fly: read("fly.toml"),
  dockerfile: read("Dockerfile"),
  buildSh: read("build.sh"),
  pin: read("PIN"),
});

test("the real configuration is clean", () => {
  assert.deepEqual(check(files()), []);
});

test("the pin is the verified release", () => {
  const pin = read("PIN");
  assert.match(pin, /^tag=v0\.8\.8$/m);
  assert.match(pin, /^base=e8f3be08623663d4ad7f7241e693c94469b63bb0$/m);
  assert.match(pin, /^commit=[0-9a-f]{40}$/m);
});

// Mutation checks: the guard must FAIL on each way of breaking a rule, or it is a
// test that always passes (the same discipline as docs/degradation-probe.md).
const mutants = [
  [
    "a provider baseURL",
    (f) => ({
      ...f,
      production: f.production.replace(GATEWAY, "https://api.openai.com/v1"),
    }),
    /is not the gateway/,
  ],
  [
    "a look-alike gateway host",
    (f) => ({
      ...f,
      production: f.production.replace(
        GATEWAY,
        "https://api.shamwari.ai.evil.example/v1",
      ),
    }),
    /is not the gateway/,
  ],
  [
    "the test stub in production",
    (f) => ({
      ...f,
      production: f.production.replace(GATEWAY, "http://127.0.0.1:8787/v1"),
    }),
    /is not the gateway/,
  ],
  [
    "a built-in provider endpoint",
    (f) => ({
      ...f,
      production: f.production + "\n  openAI:\n    apiKey: x\n",
    }),
    /endpoint type "openAI"/,
  ],
  [
    "a non-custom endpoint key",
    (f) => ({
      ...f,
      production: f.production.replace(
        "endpoints:\n",
        "endpoints:\n  anthropic:\n    apiKey: x\n",
      ),
    }),
    /endpoint type "anthropic"/,
  ],
  [
    "user_provided keys",
    (f) => ({
      ...f,
      production: f.production.replace(
        "'${SHAMWARI_CHAT_PLACEHOLDER_KEY}'",
        "user_provided",
      ),
    }),
    /user_provided/,
  ],
  [
    "a literal key",
    (f) => ({
      ...f,
      production: f.production.replace(
        "'${SHAMWARI_CHAT_PLACEHOLDER_KEY}'",
        "'sk-live-123'",
      ),
    }),
    /placeholder reference/,
  ],
  [
    "personal scope in production",
    (f) => ({
      ...f,
      production: f.production.replace(
        "scope: 'platform'",
        "scope: 'personal'",
      ),
    }),
    /scope "personal"/,
  ],
  [
    "title generation on",
    (f) => ({
      ...f,
      production: f.production.replace("titleConvo: false", "titleConvo: true"),
    }),
    /titleConvo/,
  ],
  [
    "an unlisted feature block (memory)",
    (f) => ({
      ...f,
      production: f.production + "\nmemory:\n  disabled: false\n",
    }),
    /top-level key "memory"/,
  ],
  [
    "agents switched on",
    (f) => ({
      ...f,
      production: f.production.replace(
        "agents:\n    use: false",
        "agents:\n    use: true",
      ),
    }),
    /interface\.agents/,
  ],
  [
    "ENDPOINTS widened",
    (f) => ({
      ...f,
      fly: f.fly.replace('ENDPOINTS = "custom"', 'ENDPOINTS = "custom,openAI"'),
    }),
    /ENDPOINTS/,
  ],
  [
    "registration on",
    (f) => ({
      ...f,
      fly: f.fly.replace(
        'ALLOW_REGISTRATION = "false"',
        'ALLOW_REGISTRATION = "true"',
      ),
    }),
    /ALLOW_REGISTRATION/,
  ],
  [
    "email login on",
    (f) => ({
      ...f,
      fly: f.fly.replace(
        'ALLOW_EMAIL_LOGIN = "false"',
        'ALLOW_EMAIL_LOGIN = "true"',
      ),
    }),
    /ALLOW_EMAIL_LOGIN/,
  ],
  [
    "a provider key in fly.toml",
    (f) => ({
      ...f,
      fly: f.fly.replace("[[vm]]", 'OPENAI_API_KEY = "x"\n[[vm]]'),
    }),
    /provider credential name/,
  ],
  [
    "a provider key in the Dockerfile",
    (f) => ({ ...f, dockerfile: f.dockerfile + "\nENV ANTHROPIC_API_KEY=x\n" }),
    /provider credential name/,
  ],
  [
    "a public service port",
    (f) => ({
      ...f,
      fly: f.fly + "\n[http_service]\n  internal_port = 3080\n",
    }),
    /public port/,
  ],
  [
    "Meilisearch on",
    (f) => ({
      ...f,
      fly: f.fly.replace('SEARCH = "false"', 'SEARCH = "true"'),
    }),
    /SEARCH/,
  ],
  [
    "a floating base image",
    (f) => ({
      ...f,
      dockerfile: f.dockerfile.replace(
        "FROM ${BASE_IMAGE}",
        "FROM ghcr.io/danny-avila/librechat:latest",
      ),
    }),
    /FROM must be/,
  ],
  [
    "a default BASE_IMAGE",
    (f) => ({
      ...f,
      dockerfile: f.dockerfile.replace(
        "ARG BASE_IMAGE",
        "ARG BASE_IMAGE=librechat:latest",
      ),
    }),
    /no default/,
  ],
  [
    "a release candidate pin",
    (f) => ({ ...f, pin: f.pin.replace("tag=v0.8.8", "tag=v0.8.8-rc4") }),
    /exact release tag/,
  ],
  [
    "a short commit pin",
    (f) => ({ ...f, pin: f.pin.replace(/commit=.*/, "commit=e8f3be08") }),
    /40-hex/,
  ],
  [
    "a test endpoint pointing at a provider",
    (f) => ({
      ...f,
      test: f.test.replace(
        "http://127.0.0.1:8787/v1",
        "https://api.openai.com/v1",
      ),
    }),
    /is not the gateway/,
  ],
  [
    "a deleted agents block",
    (f) => ({
      ...f,
      production: f.production.replace(/  agents:\n(    .*\n){4}/, ""),
    }),
    /interface\.agents must be present/,
  ],
  [
    "a deleted prompts block",
    (f) => ({
      ...f,
      production: f.production.replace(/  prompts:\n(    .*\n){4}/, ""),
    }),
    /interface\.prompts must be present/,
  ],
  [
    "file search omitted",
    (f) => ({
      ...f,
      production: f.production.replace("  fileSearch: false\n", ""),
    }),
    /interface\.fileSearch/,
  ],
  [
    "parameters UI on",
    (f) => ({
      ...f,
      production: f.production.replace("parameters: false", "parameters: true"),
    }),
    /interface\.parameters/,
  ],
  [
    "a provider reverse proxy var",
    (f) => ({
      ...f,
      fly: f.fly.replace(
        "[[vm]]",
        'OPENAI_REVERSE_PROXY = "https://x"\n[[vm]]',
      ),
    }),
    /OPENAI_REVERSE_PROXY|not on the allowlist/,
  ],
  [
    "an unlisted env var",
    (f) => ({
      ...f,
      fly: f.fly.replace("[[vm]]", 'NEW_FEATURE = "on"\n[[vm]]'),
    }),
    /env var "NEW_FEATURE"/,
  ],
  [
    "a Z.ai credential var",
    (f) => ({ ...f, fly: f.fly.replace("[[vm]]", 'ZAI_TOKEN = "x"\n[[vm]]') }),
    /ZAI_|allowlist/,
  ],
  [
    "a single-quoted flag that was ignored before",
    (f) => ({
      ...f,
      fly: f.fly.replace('SEARCH = "false"', "SEARCH = 'true'"),
    }),
    /SEARCH/,
  ],
  [
    "an env value with a hash in it",
    (f) => ({
      ...f,
      fly: f.fly.replace('ENDPOINTS = "custom"', 'ENDPOINTS = "custom#openAI"'),
    }),
    /ENDPOINTS/,
  ],
  [
    "an extra request header",
    (f) => ({
      ...f,
      production: f.production.replace(
        "X-Shamwari-Channel: 'pwa'",
        "X-Shamwari-Channel: 'pwa'\n        Authorization: 'Bearer x'",
      ),
    }),
    /header "Authorization"/,
  ],
  [
    "an extra addParams key",
    (f) => ({
      ...f,
      production: f.production.replace(
        "stream: false",
        "stream: false\n        model: 'gpt-5'",
      ),
    }),
    /addParams key "model"/,
  ],
  [
    "an extra endpoint option",
    (f) => ({
      ...f,
      production: f.production.replace(
        "titleConvo: false",
        "titleConvo: false\n      directEndpoint: true",
      ),
    }),
    /option "directEndpoint"/,
  ],
  [
    "model fetch on",
    (f) => ({
      ...f,
      production: f.production.replace("fetch: false", "fetch: true"),
    }),
    /models\.fetch/,
  ],
  [
    "a Dockerfile ENV",
    (f) => ({ ...f, dockerfile: f.dockerfile + "\nENV FOO=bar\n" }),
    /ENV is not allowed/,
  ],
  [
    "a fly build section",
    (f) => ({ ...f, fly: f.fly + '\n[build]\n  dockerfile = "Dockerfile"\n' }),
    /no \[build\]/,
  ],
  [
    "a build.sh that skips the tag check",
    (f) => ({ ...f, buildSh: f.buildSh.replace(/refs\/tags/g, "refs/heads") }),
    /tag in PIN resolves/,
  ],
  [
    "a private address allowed in production",
    (f) => ({
      ...f,
      production: f.production.replace(
        "endpoints:\n",
        "endpoints:\n  allowedAddresses: ['127.0.0.1:8787']\n",
      ),
    }),
    /endpoint type "allowedAddresses"/,
  ],
  [
    "a wider allowed address in the test config",
    (f) => ({
      ...f,
      test: f.test.replace("['127.0.0.1:8787']", "['10.0.0.5:443']"),
    }),
    /allowedAddresses must be exactly/,
  ],
  [
    "streaming left on",
    (f) => ({
      ...f,
      production: f.production.replace(
        "disableStreaming: true",
        "disableStreaming: false",
      ),
    }),
    /disableStreaming: true/,
  ],
  [
    "the user id no longer dropped",
    (f) => ({
      ...f,
      production: f.production.replace(
        "dropParams: ['user']",
        "dropParams: []",
      ),
    }),
    /dropParams must be exactly/,
  ],
  [
    "allowedAddresses dropped from the test config",
    (f) => ({ ...f, test: f.test.replace(/  allowedAddresses:.*\n/, "") }),
    /allowedAddresses must be present/,
  ],
  [
    "a repository override in build.sh",
    (f) => ({
      ...f,
      buildSh: f.buildSh.replace(
        'repo="https://github.com/shamwari-ai/librechat"',
        'repo="${LIBRECHAT_REPO:-https://github.com/shamwari-ai/librechat}"',
      ),
    }),
    /source repository must be the Shamwari fork/,
  ],
  [
    "no upstream base in the pin",
    (f) => ({ ...f, pin: f.pin.replace(/base=.*\n/, "") }),
    /base must be the full 40-hex/,
  ],
  [
    "a build.sh that skips the ancestry check",
    (f) => ({
      ...f,
      buildSh: f.buildSh.replace("merge-base --is-ancestor", "echo"),
    }),
    /built on the upstream base/,
  ],
  [
    "an ancestry check that only exists in a comment",
    (f) => ({
      ...f,
      buildSh: f.buildSh.replace(
        /git -C "\$work\/src" merge-base --is-ancestor[^\n]*\n[^\n]*\n/,
        '# git merge-base --is-ancestor "$base" HEAD || { exit 1; }\n',
      ),
    }),
    /built on the upstream base/,
  ],
  [
    "an ancestry check that no longer exits",
    (f) => ({
      ...f,
      buildSh: f.buildSh.replace(
        /(is-ancestor "\$base" HEAD[\s\\]*\|\|\s*\{[^}]*)exit 1/,
        "$1true",
      ),
    }),
    /built on the upstream base/,
  ],
  [
    "a tag compared against the fork commit",
    (f) => ({
      ...f,
      buildSh: f.buildSh.replace(
        '"$tagged" = "$base"',
        '"$tagged" = "$commit"',
      ),
    }),
    /resolves to the upstream base/,
  ],
  [
    "a neutered check with || true",
    (f) => ({ ...f, buildSh: f.buildSh + "\ngit status || true\n" }),
    /\|\| true/,
  ],
  [
    "commit equal to base (stock upstream)",
    (f) => ({
      ...f,
      pin: f.pin.replace(/commit=.*/, "commit=" + /base=(.*)/.exec(f.pin)[1]),
    }),
    /not the stock upstream commit/,
  ],
];

for (const [name, mutate, expected] of mutants) {
  test(`guard fails on: ${name}`, () => {
    const v = check(mutate(files()));
    assert.ok(v.length > 0, `guard let "${name}" through`);
    assert.ok(
      v.some((m) => expected.test(m)),
      `expected ${expected}, got ${JSON.stringify(v)}`,
    );
  });
}

test("personal scope is allowed in the test config only", () => {
  const f = files();
  assert.match(f.test, /scope: 'personal'/);
  assert.doesNotMatch(f.production, /personal/);
});
