import type { Env, Tier } from "./types";
import { policy, targets } from "./router";

/**
 * `GET /v1/models`: the model ids a caller may put in `model`, in the shape of
 * OpenAI's model list, so OpenAI-compatible clients (OpenCode, the OpenAI SDKs)
 * can discover them.
 *
 * Derived, never listed by hand. The ids are the aliases the router honours
 * (`routing-policy.json` `model_aliases`, as validated by `router.ts`), and a
 * tier is offered only when `targets()` has a model configured for it and that
 * model is open weight. So the list cannot drift from routing, and premium
 * (unconfigured, and `restricted` by Rule 2) can never appear here, even if an
 * alias for it is added to the policy file: it would still be routable by the
 * router, but it would not be advertised.
 *
 * `created` is left out on purpose. OpenAI sends the model's creation time;
 * these are aliases with no such date, and a made-up one would be worse than
 * none. `owned_by` is Shamwari because the alias is ours; the model behind it
 * is named in `docs`, not here, since an env var can change it.
 */
export interface ModelEntry {
  id: string;
  object: "model";
  owned_by: "shamwari";
}

export interface ModelList {
  object: "list";
  data: ModelEntry[];
}

/** The tiers that may be advertised: configured, open weight, and never premium. */
function offered(env: Env, tier: Tier): boolean {
  if (tier === "premium") return false;
  const t = targets(env)[tier];
  return (
    t.provider !== "unconfigured" &&
    t.model.trim() !== "" &&
    t.licenseClass === "open_weight"
  );
}

export function publicModelIds(env: Env): string[] {
  return Object.entries(policy.model_aliases)
    .filter(([, tier]) => offered(env, tier))
    .map(([alias]) => alias)
    .sort();
}

export function modelList(env: Env): ModelList {
  return {
    object: "list",
    data: publicModelIds(env).map((id) => ({
      id,
      object: "model",
      owned_by: "shamwari",
    })),
  };
}
