import { defineConfig } from "vitest/config";

// HTTP-level end-to-end tests against a running server (see tests/e2e/workflow.test.js).
export default defineConfig({
  test: { include: ["tests/e2e/**/*.test.js"], environment: "node", fileParallelism: false, sequence: { concurrent: false }, testTimeout: 30000, hookTimeout: 60000 },
});
