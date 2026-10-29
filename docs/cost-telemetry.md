# Per-tier cost telemetry

Backlog item 7 on #83. Owner decision (2026-10-29): report **tokens always** (the
fact) and an **estimated** cost in USD from a **versioned price table**, labelled
as an estimate, never billing-grade, kept in config that code review sees, not in
a handler.

## What is recorded

Every usage event already carries `reach`, `routedTier`, `tier`, `inferencePath`,
`provider`, `model`, `inputTokens` and `outputTokens`. It now also carries:

- `costUsdEstimate`: tokens times the price for the model that **actually
  served** (`provider/model`, the same key `provenance.ts` uses), or `null` when
  that model is not in the table. `null` is never `0`: unpriced and free must not
  look alike. Extractive and Mind-retrieval answers make no model call, so they are
  `null` by construction.
- `priceTableVersion`: which table produced it, so an old estimate can be
  recomputed or discounted.

## The price table

`gateway/pricing.json`. Version, source URL, retrieval date, currency, per-model
input and output prices per million tokens. A price change is a reviewed diff with
a new version. Current source: Cloudflare's published Workers AI pricing, retrieved
2026-10-29 (`glm-5.3-flash` 0.15 / 0.50, `glm-5.3` 1.40 / 4.40 USD per million
input / output tokens).

What the estimate is **not**:

- Not billing-grade. Do not invoice from it.
- Input is priced uncached, the upper bound, because cached-input counts are not
  recorded. Real cost is at or below the estimate.
- It excludes the edge embedding of the question and any plan or free allowance.
- A model that is not in the table, for example one a dashboard route swapped in,
  is unpriced (`null`) until someone adds it, and shows up in `unpriced_requests`.

## Reading it

`GET /rollup/by-tier?billing_period=YYYY-MM&owner_entity_id=...` on Core (operator token) returns, per `reach`, `routed_tier` and `inference_path`: requests, input and
output tokens, `cost_usd_estimate` (priced requests only) and `unpriced_requests`.
The response carries the estimate label. This is the per-tier view the $0.20 per
active user per month target needs; dividing by active users is a separate, unbuilt
step, so no per-user figure is claimed here.

With the Servers API flag on, the same fields travel on the usage event
(`costUsdEstimate`, `priceTableVersion` are on the allowlist) and the Servers API
owns the reporting.

## Rules

- Rule 1: only numbers and a version string are added; no content.
- Rule 2: the price table never touches `licenseClass`.
