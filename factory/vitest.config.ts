import { defineConfig } from "vitest/config";

// Node environment, not the Workers pool, as in gateway/. The logic lives in
// modules that take their bindings as interfaces (router, gate, session,
// egress, opencode, workspace-core); the thin runtime classes (workspace.ts,
// outbound.ts, refresh-do.ts, index.ts) import `cloudflare:workers` and are
// checked by the type check, not run here.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
