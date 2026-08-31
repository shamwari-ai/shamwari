# The degradation probe

## What it is for

"Cloudflare is an enhancement, never a dependency" is a claim about three
inference paths in `gateway/src/gateway.ts`:

| Step | Path | Reached when |
|---|---|---|
| 1 | `gateway` | always tried first |
| 2 | `direct` | step 1 failed |
| 3 | `workers-ai` | steps 1 and 2 failed |

The claim is only true while steps 2 and 3 work. **On a healthy day nothing
reaches them.** That is the whole problem: they can be broken for months —
a rotated provider key, a changed direct URL, a model id retired from the
catalogue — and every user request still succeeds through step 1, so nothing
looks wrong until the outage that finally needs them.

This used to be handled by an instruction in `CLAUDE.md`: *break the Gateway
credential deliberately once a month*. That is a manual chore. It will be
skipped, and **skipping it looks exactly like passing it.**

## What replaced it

A weekly cron (`triggers.crons` in `gateway/wrangler.jsonc`, Mondays 06:00
UTC) runs `probe()`, which exercises all three paths **independently** and
writes one row to `platform.serviceHealth`.

Independently is the load-bearing word. `infer()` stops at the first success,
so a probe built on `infer()` would only ever report on the gateway. That is
why `gateway.ts` exposes `viaGateway` / `viaDirect` / `viaWorkersAI` as
separate functions and `infer()` composes them — the probe calls each one
directly, so there is no second copy of the logic to drift.

### Two details that would otherwise make it lie

- **`cf-aig-skip-cache: true` on the gateway step.** The probe prompt is
  constant, which is what makes latency comparable week to week — and also
  makes it maximally cacheable. Without the header the gateway step would
  keep answering from cache long after the provider behind it started
  refusing every request.
- **A thrown step is a failed step, not a failed probe.** Each path is timed
  and caught separately, so one exploding DNS lookup still yields a reading
  on the other two.

## Reading the result

One document per run in `platform.serviceHealth`:

```js
{
  service: 'shamwari-gateway',
  check: 'inference-degradation',
  tier: 'economy',
  allPathsHealthy: false,   // every path answered
  serviceable: true,        // at least one answered
  gatewayOk: true,
  directOk: false,          // <- rotted, and invisible to users
  workersAiOk: true,
  paths: [ { path, ok, latencyMs, served, error }, ... ],
  startedAt, createdAt
}
```

`gatewayOk` / `directOk` / `workersAiOk` are hoisted out of `paths` so the
alert you actually want is an equality match rather than an array traversal.

### What to alert on

- `serviceable: false` — page someone. No path answered; the next user
  request fails.
- `directOk: false` or `workersAiOk: false` for **two consecutive weeks** —
  a fallback has rotted. Not urgent, and not user-visible, which is exactly
  why it needs an alert rather than a dashboard nobody opens. One week alone
  is more likely a provider blip than rot.
- A step's `latencyMs` moving by more than roughly 2× against its own recent
  baseline. The prompt is constant, so this means something changed
  upstream.

The probe deliberately does **not** decide any of this. It records what
happened; alerting belongs where the data is.

## What it does not carry

The probe reaches three third-party providers on a schedule and its metadata
lands in Cloudflare's logs, so it sends nothing personal:

- a fixed, dull prompt (`Reply with the single word: ok`)
- `scope: platform` and `ownerEntityId: __probe__` in the AI Gateway metadata
- no conversation document, only the `serviceHealth` row

Tests in `gateway/test/probe.test.ts` assert each of these, including that no
message content reaches the health row.

## Cost

Three small completions a week. If that ever becomes a number worth
discussing, the fallback paths are not being relied on enough to be worth
keeping.
