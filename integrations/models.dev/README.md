# Shamwari on models.dev

A ready-to-submit [models.dev](https://github.com/anomalyco/models.dev) entry
for Shamwari. models.dev is the catalog OpenCode reads its providers and models
from, so a merged entry is how Shamwari appears in OpenCode's `/connect` and
`/models` without a hand-written config.

**Not submitted.** Opening the pull request on `anomalyco/models.dev` is an
external action for the owner to approve and take. It should wait for the
blockers below.

## What to submit

The tree under `providers/` mirrors models.dev's layout. Copy it to the root of
a models.dev fork as is:

```text
providers/shamwari/
  provider.toml                    name, npm, opencodeai, env, api, doc
  logo.svg                         single colour (currentColor), square viewBox
  models/shamwari-standard.toml    schema = 2, base_model = "zhipuai/glm-5.3"
```

No lab file is needed: `models/zhipuai/glm-5.3.toml` (and
`glm-5.3-flash.toml`) already exist upstream. models.dev's lab id for Z.ai's
GLM models is `zhipuai`, not `zai`.

### The model ids

models.dev lists concrete models, and the id is what a client puts in `model`.
The gateway only pins a model when the request names one of its aliases
(`gateway/routing-policy.json` `model_aliases`); any other id, including the
Workers AI one (`@cf/zai-org/glm-5.3`), is routed by the heuristic and could
be answered by either tier. So the id has to be the gateway's public alias, and
an alias belongs in the catalog only if it maps to one model:

- **`shamwari-standard` is listed.** It pins GLM-5.3 (`STANDARD_MODEL`). The
  one exception is a fallback: if GLM-5.3 fails, or the account's monthly
  route budget is spent, the AI Gateway route answers with GLM-5.3-Flash
  (`gateway/dynamic-route.json`), and the response says so in
  `shamwari.model_served` and `shamwari.model_substituted`. That is a
  degradation path, not a second model, so `base_model = "zhipuai/glm-5.3"`
  is accurate. The file's header comment states it.
- **`shamwari-economy` is held back.** It pins `@cf/zai-org/glm-5.3-flash`,
  which Cloudflare retires from Workers AI on **2026-11-20**: requests then
  fail with `410 Gone`
  ([changelog](https://developers.cloudflare.com/changelog/post/2026-11-05-planned-model-deprecations/);
  models.dev already marks the Workers AI entry `deprecated`). Listing it
  now would point OpenCode at a model that stops answering in days. Add
  `providers/shamwari/models/shamwari-economy.toml` once `ECONOMY_MODEL` has a
  replacement, with `base_model` set to that model's lab file, in the same
  shape as `shamwari-standard.toml`.
- **Premium is not listed**, and `GET /v1/models` cannot list it
  (`gateway/src/models.ts`).

### What the model file records, and why

Everything after `base_model` is a real difference from GLM-5.3 on another host:

| Field                                     | Why                                                                                                |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `name`, `description`                     | It is GLM-5.3 behind Shamwari's grounded system prompt, not the bare model                         |
| `tools = { supported = false }`           | The gateway does not forward `tools` or `tool_choice`                                              |
| `reasoning = { supported = true }`        | Always on, no caller control: the gateway sends `reasoning_effort: "low"` and ignores the caller's |
| `temperature`, `top_p`, `top_k` = `false` | The gateway fixes sampling and ignores the caller's values                                         |
| `limit.output = 2_048`                    | `DEFAULT_MAX_OUTPUT_TOKENS` in `gateway/src/router.ts`                                             |

Left out on purpose: `cost` (not published, see the TODO below), `cache`
(the gateway's response cache is not prompt caching a caller can use or is
billed for), `structured_output` (not forwarded), and `status`.

## Validation

Run on 2026-11-18 against `anomalyco/models.dev` at `7b22cc9` (the `dev` head
that day), with these files copied in:

```text
$ bun validate
exit 0   (schema, base_model target, logo allowlist all pass)

shamwari/shamwari-standard resolves to:
  name "Shamwari Standard", family "glm", tool_call false, reasoning true,
  temperature false, modalities text -> text, open_weights true,
  limit { context 1000000, output 2048 }, canonical_model_id "zhipuai/glm-5.3"

$ bun run v1:check
Added to v1 (1; new models should usually be v2_only): shamwari/shamwari-standard
Changed v1 fields: api id, env, npm, api, name, doc added [shamwari (provider)]
v1 output changed in 3 of 22 views.   (exit 1)
```

`v1:check` exits 1 for any v1 change, and a new provider is necessarily one.
The change is purely additive (no existing field or model changes), which is
how recent chat-model additions land too; list it in the PR as such. If the
maintainers would rather keep it out of v1, add `v2_only = true` to the model
file.

To rerun: clone `anomalyco/models.dev`, copy `providers/shamwari` into its
`providers/`, `bun install`, `bun validate`, `bun run v1:check`.

## The logo

`logo.svg` is a vector redraw of the Shamwari mark (the node mark in
`site/public/shamwari-mark-cream.png`, recoloured from
`site/scripts/brand-assets/source/bundu-node-mark-light.svg`). The source SVG
cannot be used directly: it is a PNG embedded with filters and masks, which
models.dev's logo allowlist rejects and which cannot take `currentColor`. The
redraw measures the seven node centres and radii from the 512px PNG, draws the
eleven edges at the same 55% opacity, and uses `currentColor` only. It passes
`bun validate`'s logo check. It needs the owner's approval before it is used
outside this repository.

## PR description draft

> **Add Shamwari provider**
>
> Adds Shamwari, an AI companion with open weights built in Zimbabwe. Its
> gateway is OpenAI-compatible (Chat Completions) at
> `https://api.shamwari.ai/v1` and grounds answers in cited Zimbabwean
> sources. Every model it serves is open weight.
>
> - `providers/shamwari/provider.toml`: `@ai-sdk/openai-compatible`,
>   `@opencode/ai/providers/openai-compatible`, `SHAMWARI_API_KEY`.
> - `providers/shamwari/models/shamwari-standard.toml`: GLM-5.3
>   (`base_model = "zhipuai/glm-5.3"`) served on Cloudflare Workers AI.
>   Override-only: no tool calling (the gateway does not forward tools), reasoning always on
>   with no caller control, sampling fixed by the gateway, output capped at
>   2,048 tokens.
> - `providers/shamwari/logo.svg`: single colour, `currentColor`.
>
> Sources:
>
> - Docs: <https://docs.shamwari.ai/opencode>
> - Model list: `GET https://api.shamwari.ai/v1/models` (needs a key)
> - Pricing: TODO, link the published price page
> - Gateway source (routing, limits, provenance):
>   <https://github.com/shamwari-ai/shamwari/tree/staging/gateway>
>
> `bun validate` passes. `bun run v1:check` reports one added provider and
> model and no change to any existing field.

## Blockers before submitting

1. **Streaming.** OpenCode streams every reply. The gateway ignores
   `stream: true` and returns one JSON body (gateway README, "Not in this
   phase"), so OpenCode cannot read its answers. Until the chat endpoint
   streams, a catalog entry would list a provider that does not work in
   OpenCode. (It also drops the caller's system messages, which OpenCode
   relies on; that is by design, but worth saying in the docs.)
2. **Self-serve API keys.** Keys are issued by hand; there is no sign-up or
   key page (`platform.shamwari.ai` is not the console yet). A catalog user
   needs a way to get `SHAMWARI_API_KEY` without emailing.
3. **Published prices.** See the TODO below.
4. **The docs page has to be live.** `doc` points to
   `https://docs.shamwari.ai/opencode`. The page is in this repo at
   `docs-site/src/content/docs/opencode.mdx`, but `docs.shamwari.ai` is now
   served from `shamwari-ai/docs` (Mintlify), so it has to be ported there,
   at the path `/opencode`, before the link resolves.
5. **The economy model.** `@cf/zai-org/glm-5.3-flash` is retired on
   2026-11-20. That affects production, not only this listing: it is the
   economy tier, the standard tier's fallback and the last-resort Workers AI
   path.
6. **Logo approval.** See above.
7. **The PR itself.** Opening it on `anomalyco/models.dev` is the owner's
   call.

## TODO(owner): cost

Not in the TOML on purpose: unknown keys fail validation, and a price has to
be a published one. Once prices are published, add to
`models/shamwari-standard.toml` (USD per million tokens, with the pricing page
cited in the header comment):

```toml
# Source: <the published Shamwari pricing page>, retrieved <date>
[cost.text.input]
price = <USD per million input tokens>

[cost.text.output]
price = <USD per million output tokens>
```

For reference only, not a suggestion of the price: what Shamwari pays
Cloudflare is in `gateway/pricing.json` (GLM-5.3: 1.40 input, 4.40 output;
GLM-5.3-Flash: 0.15 input, 0.50 output, USD per million tokens, retrieved
2026-10-29). Things a price has to cover that a per-token margin over those
numbers would hide:

- Every request carries Shamwari's own system prompt and the Ground passages,
  so the input tokens Shamwari pays for are more than the caller sent.
- The edge embedding of each question, and the Core and Ground retrieval
  behind it.
- Fallbacks are billed at the model that served.

One shape that fits models.dev's schema: a flat input and output price per
tier, set as a margin over the Cloudflare rate plus a fixed allowance for the
grounding overhead. Whether to price that way is the owner's decision.
