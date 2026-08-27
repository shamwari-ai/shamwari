import { defineConfig } from 'vitest/config';

// Node environment, not the Workers pool. These tests cover the pure
// decision logic — the scope gate, tier routing and licenceClass
// assignment, language tagging — none of which touches a Worker binding.
// The request path needs `wrangler dev` and a reachable Core, so it is
// verified there rather than here.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
