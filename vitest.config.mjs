import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "."), "server-only": path.resolve(import.meta.dirname, "tests/stubs/server-only.js") } },
  test: { include: ["tests/unit/**/*.test.js"], environment: "node" },
});
