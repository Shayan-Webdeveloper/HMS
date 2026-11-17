import { defineConfig } from "vitest/config";
import path from "node:path";

// Database integration tests: start a disposable embedded PostgreSQL (no external database needed).
export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "."), "server-only": path.resolve(import.meta.dirname, "tests/stubs/server-only.js") } },
  test: { include: ["tests/integration/**/*.db.test.js"], environment: "node", fileParallelism: false, testTimeout: 60000, hookTimeout: 300000 },
});
