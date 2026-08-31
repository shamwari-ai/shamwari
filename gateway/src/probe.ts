import type { Env, Message, SinkMessage } from './types';
import { targets } from './router';
import { viaGateway, viaDirect, viaWorkersAI } from './gateway';
import type { RequestMetadata } from './gateway';

/**
 * MAKES THE CLAIM CHECKABLE.
 *
 * "Cloudflare is an enhancement, never a dependency" is only true while the
 * fallback paths work, and the fallback paths are unreachable on a healthy
 * day — step 2 runs only when step 1 fails, step 3 only when both do. So
 * they rot silently, and the rot is invisible until the outage that needed
 * them.
 *
 * CLAUDE.md's answer was "break the Gateway credential deliberately once a
 * month". That is a manual chore, it will be skipped, and skipping it looks
 * exactly like passing it. This runs on a cron instead and writes the result
 * to `platform.serviceHealth`, so a rotted path is a row you can query
 * rather than a discipline someone has to remember.
 *
 * What it does NOT do: assert the paths are healthy. It records what
 * happened. Alerting belongs where the data is, not in the Worker.
 */

/**
 * Deliberately dull, deliberately constant, deliberately not a real user's
 * question. It reaches three third-party providers on a schedule and lands
 * in Cloudflare's logs, so it must carry nothing personal — and being
 * constant is what lets a latency change mean something.
 *
 * Constant also means cacheable, which is why the gateway step is probed
 * with `cf-aig-skip-cache`. A cached HIT would report a healthy gateway
 * while the provider behind it was refusing every request.
 */
const PROBE_MESSAGES: Message[] = [
  { role: 'user', content: 'Reply with the single word: ok' },
];

export interface PathResult {
  path: 'gateway' | 'direct' | 'workers-ai';
  ok: boolean;
  latencyMs: number;
  /** What answered, when something did. Null when the step was unavailable. */
  served: string | null;
  /** Set when the step threw rather than merely returning unavailable. */
  error: string | null;
}

export interface ProbeReport {
  probeId: string;
  tier: string;
  startedAt: string;
  results: PathResult[];
  /** True when every step answered. The claim holds only in this case. */
  allPathsHealthy: boolean;
  /** True when at least one step answered: a user request would succeed. */
  serviceable: boolean;
}

async function timed(
  path: PathResult['path'],
  fn: () => Promise<{ provider: string; model: string } | null>,
): Promise<PathResult> {
  const started = Date.now();
  try {
    const r = await fn();
    return {
      path,
      ok: r !== null,
      latencyMs: Date.now() - started,
      served: r ? `${r.provider}/${r.model}` : null,
      error: null,
    };
  } catch (e) {
    // A step that throws is a failed step, not a failed probe. The whole
    // point is to get a reading on all three.
    return {
      path,
      ok: false,
      latencyMs: Date.now() - started,
      served: null,
      error: String(e).slice(0, 300),
    };
  }
}

/**
 * Exercise all three paths independently, in sequence.
 *
 * Sequential rather than parallel: three simultaneous calls to the same
 * provider can trip its own rate limiting and report a fault that the probe
 * itself caused.
 */
export async function probe(env: Env, tier: 'economy' | 'standard' = 'economy'): Promise<ProbeReport> {
  const target = targets(env)[tier];
  const probeId = crypto.randomUUID();
  const startedAt = new Date().toISOString();

  const meta: RequestMetadata = {
    tier: target.tier,
    // Platform scope, and it must stay that way: the probe carries no user
    // data, so it has no business claiming any other scope in the logs.
    scope: 'platform',
    ownerEntityId: '__probe__',
    surface: env.SURFACE,
    requestId: probeId,
  };

  const results: PathResult[] = [
    await timed('gateway', () => viaGateway(env, target, PROBE_MESSAGES, meta, true)),
    await timed('direct', () => viaDirect(env, target, PROBE_MESSAGES)),
    await timed('workers-ai', () => viaWorkersAI(env, target, PROBE_MESSAGES)),
  ];

  return {
    probeId,
    tier: target.tier,
    startedAt,
    results,
    allPathsHealthy: results.every((r) => r.ok),
    serviceable: results.some((r) => r.ok),
  };
}

/**
 * One `platform.serviceHealth` row per probe.
 *
 * A single document rather than one per path: the interesting query is "when
 * did a path last work", and that reads better off a flat set of per-path
 * booleans than off three rows that have to be correlated.
 */
export function healthDoc(report: ProbeReport): SinkMessage {
  const byPath = Object.fromEntries(report.results.map((r) => [r.path, r]));
  return {
    database: 'platform',
    collection: 'serviceHealth',
    doc: {
      service: 'shamwari-gateway',
      check: 'inference-degradation',
      probeId: report.probeId,
      tier: report.tier,
      allPathsHealthy: report.allPathsHealthy,
      serviceable: report.serviceable,
      paths: report.results,
      // Hoisted so the common alert — "a fallback path has rotted" — is an
      // equality match rather than an array traversal.
      gatewayOk: byPath.gateway?.ok ?? false,
      directOk: byPath.direct?.ok ?? false,
      workersAiOk: byPath['workers-ai']?.ok ?? false,
      startedAt: report.startedAt,
      createdAt: new Date().toISOString(),
    },
  };
}
