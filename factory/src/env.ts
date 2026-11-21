import type { FactorySessionRefresh } from "./refresh-do";
import type { FactoryWorkspace } from "./workspace";

/**
 * Bindings, by name. None of the secrets is in wrangler.jsonc or in git; until
 * they are bound every gated path answers 503 and no container starts.
 *
 *   WORKOS_CLIENT_ID      public: the AuthKit application's client id
 *   WORKOS_REDIRECT_URI   public: https://<factory host>/callback
 *   WORKOS_API_KEY        SECRET (Secrets Store binding or .dev.vars)
 *   COOKIE_PASSWORD       SECRET: seals the factory session cookie, 32+ chars.
 *                         Its own value, not the chat's, so neither cookie can
 *                         be opened with the other's key.
 *   GATEWAY_ORIGIN        public: the Shamwari gateway, https://api.shamwari.ai
 */
export type SecretBinding = string | { get(): Promise<string> } | undefined;

export interface Env {
  WORKOS_CLIENT_ID?: string;
  WORKOS_REDIRECT_URI?: string;
  WORKOS_API_KEY?: SecretBinding;
  COOKIE_PASSWORD?: SecretBinding;
  GATEWAY_ORIGIN?: string;
  FACTORY_WORKSPACE: DurableObjectNamespace<FactoryWorkspace>;
  FACTORY_SESSION_REFRESH: DurableObjectNamespace<FactorySessionRefresh>;
}

export const DEFAULT_GATEWAY_ORIGIN = "https://api.shamwari.ai";

export function gatewayOrigin(env: Pick<Env, "GATEWAY_ORIGIN">): string {
  const raw = env.GATEWAY_ORIGIN || DEFAULT_GATEWAY_ORIGIN;
  const u = new URL(raw);
  if (u.protocol !== "https:") throw new Error("GATEWAY_ORIGIN must be https");
  return u.origin;
}

export async function secret(b: SecretBinding): Promise<string | undefined> {
  if (typeof b === "string") return b || undefined;
  if (b && typeof b.get === "function") return (await b.get()) || undefined;
  return undefined;
}
