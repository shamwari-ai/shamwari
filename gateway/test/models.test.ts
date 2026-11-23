// GET /v1/models lists the model ids a caller may name. The list is derived
// from the router (routing-policy.json aliases, filtered by targets()), so
// these tests pin that it cannot drift from routing and can never advertise
// premium or anything restricted (Rule 2), and that it is authenticated like
// the rest of /v1 without being metered.
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { modelList, publicModelIds } from "../src/models";
import { policy, route, targets } from "../src/router";
import type { Env } from "../src/types";

const AUTH = {
  apiKeyId: "k1",
  ownerEntityId: "e1",
  ownerPersonId: null,
  keyType: "standard",
  tier: "community",
  monthlyTokenCap: 100_000,
};

const KEY = "sk_shamwari_test_0123456789abcdef";

function makeEnv(
  over: Partial<Record<keyof Env, unknown>> = {},
  cached: unknown = AUTH,
): Env {
  return {
    AUTH_CACHE: { get: async () => cached, put: async () => {} },
    AUTH_CACHE_TTL: "60",
    CORE_URL: "https://core.example",
    SHAMWARI_CORE_TOKEN: "t",
    ECONOMY_MODEL: "@cf/zai-org/glm-5.3-flash",
    STANDARD_MODEL: "@cf/zai-org/glm-5.3",
    ...over,
  } as unknown as Env;
}

const ctx = { waitUntil: () => {} } as unknown as ExecutionContext;

const get = (
  env: Env,
  headers: Record<string, string> = { Authorization: `Bearer ${KEY}` },
  method = "GET",
) =>
  worker.fetch(
    new Request("https://gw.example/v1/models", { method, headers }),
    env,
    ctx,
  );

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the list is the router, not a copy of it", () => {
  it("is exactly the policy aliases for configured, open-weight tiers", () => {
    const env = makeEnv();
    const t = targets(env);
    const expected = Object.entries(policy.model_aliases)
      .filter(
        ([, tier]) =>
          tier !== "premium" &&
          t[tier].licenseClass === "open_weight" &&
          t[tier].model !== "",
      )
      .map(([alias]) => alias)
      .sort();
    expect(publicModelIds(env)).toEqual(expected);
    // Today's policy, pinned so a change to what is offered is a visible diff.
    expect(publicModelIds(env)).toEqual([
      "shamwari-economy",
      "shamwari-standard",
    ]);
  });

  it("lists only ids the router pins to their own tier", () => {
    const env = makeEnv();
    for (const id of publicModelIds(env)) {
      const target = route([{ role: "user", content: "hello" }], id, env);
      expect(target.tier, id).toBe(policy.model_aliases[id]);
      expect(target.licenseClass, id).toBe("open_weight");
      expect(target.provider, id).not.toBe("unconfigured");
    }
  });

  it("never lists premium or a restricted tier, even if an alias for it is added", () => {
    const aliases = policy.model_aliases as Record<string, string>;
    aliases["shamwari-premium"] = "premium";
    try {
      const env = makeEnv();
      expect(targets(env).premium.licenseClass).toBe("restricted");
      expect(publicModelIds(env)).not.toContain("shamwari-premium");
      for (const id of publicModelIds(env))
        expect(policy.model_aliases[id]).not.toBe("premium");
    } finally {
      delete aliases["shamwari-premium"];
    }
  });

  it("drops a tier whose model is not configured", () => {
    expect(publicModelIds(makeEnv({ STANDARD_MODEL: "" }))).toEqual([
      "shamwari-economy",
    ]);
    expect(
      publicModelIds(makeEnv({ ECONOMY_MODEL: " ", STANDARD_MODEL: "" })),
    ).toEqual([]);
  });

  it("has the OpenAI list shape", () => {
    const list = modelList(makeEnv());
    expect(list.object).toBe("list");
    for (const m of list.data)
      expect(m).toEqual({ id: m.id, object: "model", owned_by: "shamwari" });
  });
});

describe("GET /v1/models", () => {
  it("answers an authenticated caller with the list", async () => {
    const env = makeEnv();
    const res = await get(env);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(await res.json()).toEqual(modelList(env));
  });

  it("is not metered: no quota rollup, no key service call when the key is cached", async () => {
    const fetchSpy = vi.fn(async () => Response.json({}));
    vi.stubGlobal("fetch", fetchSpy);
    const res = await get(makeEnv());
    expect(res.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses a missing or invalid key like the chat endpoint does", async () => {
    const env = makeEnv({}, "invalid");
    expect((await get(env, {})).status).toBe(401);
    const res = await get(env);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "invalid_api_key" });
  });

  it("is a 503 with Retry-After, not a 401, when keys cannot be checked", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("down");
    });
    const res = await get(makeEnv({}, null));
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("5");
    expect(await res.json()).toEqual({ error: "auth_unavailable" });
  });

  it("only answers GET", async () => {
    const res = await get(
      makeEnv(),
      { Authorization: `Bearer ${KEY}` },
      "POST",
    );
    expect(res.status).toBe(404);
  });

  it("carries no CORS headers: only the chat endpoint is readable from a browser", async () => {
    const res = await get(makeEnv(), {
      Authorization: `Bearer ${KEY}`,
      Origin: "https://shamwari.ai",
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});
