# Cloudflare model catalogue — verified 2026-08-27

The README's "verify provider slugs before deploy" item, done. Everything
here was read from Cloudflare's own OpenAPI schema and docs, not from
memory. Re-verify before any deploy: the catalogue moves.

## Status

Text generation and embeddings are in this phase. **Voice and image are
deferred** — decided 2026-08-27. Their sections below stay because the
constraints, not the model ids, are the expensive part to rediscover.
CLAUDE.md's deferred-work list carries the summary.

## AI Gateway provider slugs

These 24 are the only natively supported provider slugs:

```
anthropic  azureopenai  baseten  bedrock  cartesia  cerebras  cohere
deepgram   deepseek     elevenlabs  fal    google-ai-studio  grok  groq
huggingface  ideogram   mistral  openai  openrouter  parallel  perplexity
replicate  vertex       workersai
```

**There is no `qwen` and no `moonshot` provider.** Both need a custom
provider (`POST /accounts/{id}/ai-gateway/custom-providers`, requires
`name`, `slug`, `base_url`) or must be reached through `openrouter`.

**The Workers AI slug is `workersai`, not `workers-ai`.**

## What was wrong before this was checked

| Was | Reality |
|---|---|
| `provider: "qwen"` | not a provider slug — needs a custom provider |
| `provider: "moonshot"` | not a provider slug — needs a custom provider |
| `provider: "workers-ai"` | the slug is `workersai` |
| `model: "qwen3-32b-instruct"` | does not exist in any Cloudflare catalogue |
| `@cf/qwen/qwen2.5-coder-32b-instruct` as the general fallback | it is a **code-specific** model; a poor last resort for Shona/Ndebele legal and tax questions |

`kimi-k3` is real — Moonshot's flagship, in the unified catalogue at
`/ai/models/moonshotai/kimi-k3/`. It is **not** on Workers AI, so it is
only reachable via a custom provider or OpenRouter. Workers AI carries
`kimi-k2.6` and `kimi-k2.7-code` instead.

## Text generation on `workersai`

Verified ids, current generation only. Full list has 46 entries, many
deprecated.

| Model id | Notes |
|---|---|
| `@cf/qwen/qwen3-30b-a3b-fp8` | Qwen3 MoE. Reasoning, function calling, batch. Cheap per token — the economy shape |
| `@cf/qwen/qwen3.8-27b` | Qwen 3.8. Listed as Image-Text-to-Text: **vision plus** text and agentic |
| `@cf/qwen/qwq-32b` | Qwen reasoning specialist |
| `@cf/moonshotai/kimi-k2.6` | Kimi K2.6. Reasoning, function calling |
| `@cf/moonshotai/kimi-k2.7-code` | Kimi, code-specialised |
| `@cf/zai-org/glm-5.2` | GLM 5.2 flagship. Reasoning, function calling |
| `@cf/zai-org/glm-5.3-flash` | GLM 5.3 Flash. Fast tier |
| `@cf/zai-org/glm-4.7-flash` | GLM 4.7 Flash |
| `@cf/deepseek/deepseek-v4-pro-0813` | 1M context, agentic |
| `@cf/deepseek/deepseek-v4-flash-0731` | Faster DeepSeek V4 |
| `@cf/mistralai/mistral-small-3.1-24b-instruct` | Function calling |
| `@cf/google/gemma-4-26b-a4b-it` | Reasoning, function calling |
| `@cf/nvidia/nemotron-3-120b-a12b` | Also does Image-to-Text |
| `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | Function calling, batch |
| `@cf/meta/llama-4-scout-17b-16e-instruct` | Function calling, batch |
| `@cf/openai/gpt-oss-120b`, `gpt-oss-20b` | OpenAI's **open-weight** release — not the API models. Licence is not the OpenAI API terms; confirm before treating as `open_weight` |

## Embeddings — locked, do not change

`@cf/baai/bge-m3`, 1024 dimensions. Multilingual, which is why it was
chosen: it handles Shona and Ndebele. It matches the live
`ground_vector_search` index and the 23,218 embedded documents in
`news.articles`. Changing it means re-embedding two corpora and rebuilding
two indexes, and `ingest_ground.py` hard-fails on a dimension mismatch.

Alternatives exist (`@cf/qwen/qwen3-embedding-0.6b`,
`@cf/google/embeddinggemma-300m`, the `bge-*-en-v1.5` family) and none of
them is worth that migration.

**`@cf/baai/bge-reranker-base` is the one additive win here.** A reranker
takes the query and each candidate chunk and scores relevance directly,
rather than comparing vectors. It slots in after `$rankFusion` in
`core/main.py::ground_search` without touching the embedding or either
index — the highest-value retrieval improvement available for free.

## Speech

Speech to text:

| Model id | Notes |
|---|---|
| `@cf/openai/whisper-large-v3-turbo` | Broadest language coverage |
| `@cf/openai/whisper` | Base |
| `@cf/openai/whisper-tiny-en` | English only |
| `@cf/deepgram/nova-3` | Partner, real-time |
| `@cf/deepgram/flux` | Partner, real-time |

Text to speech:

| Model id | Languages |
|---|---|
| `@cf/deepgram/aura-1` | English |
| `@cf/deepgram/aura-2-en` | English |
| `@cf/deepgram/aura-2-es` | Spanish |
| `@cf/myshell-ai/melotts` | Multi, does not include Shona or Ndebele |

**There is no Shona or Ndebele text-to-speech in the catalogue.** Voice
output in either language cannot be served from Cloudflare today. Whisper
has some Shona in its training mix, so speech *input* is worth measuring
before assuming it is unusable — measure it, do not assume either way.

## Vision and images

Image in:

| Model id | Notes |
|---|---|
| `@cf/qwen/qwen3.8-27b` | Image-Text-to-Text — the vision path, same family as the text tier |
| `@cf/nvidia/nemotron-3-120b-a12b` | Image-to-Text |
| `@cf/llava-hf/llava-1.5-7b-hf` | Image-to-Text |

Image out: `flux-1-schnell`, `flux-2-dev`, `flux-2-klein-4b`,
`flux-2-klein-9b` (Black Forest Labs), `stable-diffusion-xl-base-1.0`,
`stable-diffusion-xl-lightning`, `lucid-origin` and `phoenix-1.0`
(Leonardo), plus the SD 1.5 img2img and inpainting variants.

FLUX licences differ sharply by variant — schnell is permissive, `dev` is
not. Read the licence per variant before stamping `licenseClass`.

## Two things that must hold before voice or image ships

**Rule 1 gets harder, not easier.** The scope gate in `gateway/src/scope.ts`
guards `/v1/chat/completions` only. A voice note and a photo are the most
personal data a user will ever send — a clinic recording, a payslip, a
child. Any new endpoint has to go through `parseScope` and
`decideDestination` before a byte reaches a provider, or rule 1 is broken
by the feature that looks least like text.

**Rule 2 needs per-model provenance.** `licenseClass` is currently derived
from the tier in `router.ts`. Deepgram Aura and the Leonardo image models
are proprietary partner models; FLUX `dev` is restricted; Whisper is
permissive. A single tier-level stamp cannot express that, so adding these
means stamping per model, not per tier.

## No African models

None of Cloudflare's 21 unified-catalogue vendors is African: alibaba,
anthropic, assemblyai, black-forest-labs, bytedance, deepseek, elevenlabs,
google, inworld, krea, lightricks, minimax, moonshotai, openai, pixverse,
pruna, recraft, runwayml, thinkingmachines, vidu, xai. No entry in the
catalogue mentions an African language.

This is the gap Shamwari Mind exists to fill, and it is the strongest
version of the line in CLAUDE.md: we train Shamwari Mind, we route
Shamwari Cloud. Nothing routable speaks Shona or Ndebele as a first-class
language.

Outside Cloudflare, the nearest prior art is Lelapa AI's InkubaLM — a 0.4B
model trained from scratch on isiZulu, Yoruba, Hausa, Swahili and isiXhosa,
reported to beat SmolLM-1.7B and Llama-3-8B on AfriXNLI across those five.
It does **not** cover Shona or Ndebele. Zimbabwean Ndebele descends from
isiZulu and is largely mutually intelligible with it, so InkubaLM's isiZulu
may partially transfer — that is an inference worth testing, not a claim.
