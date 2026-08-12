import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url))
    }
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    clearMocks: true,
    restoreMocks: true,
    mockReset: true,
    /* PGlite (Postgres-in-WASM) suites contend for CPU when several run in
     * parallel workers; under load a single instance boot can exceed the 5s
     * default. Generous ceilings keep the DB-backed tests deterministic
     * without slowing anything that is already fast. */
    testTimeout: 30_000,
    hookTimeout: 30_000
  }
});
