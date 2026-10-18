import { config } from "dotenv";
import path from "node:path";
import { defineConfig } from "vitest/config";

// TEST_ENV_FILE permite usar bancos de teste separados (ex.: execuções em paralelo).
const envFile = process.env.TEST_ENV_FILE ?? ".env.test";
const env = config({ path: envFile, quiet: true }).parsed ?? {};

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "server-only": path.resolve(__dirname, "src/server/empty.ts"),
    },
  },
  test: {
    environment: "node",
    env: { ...env, NODE_ENV: "test" },
    globalSetup: ["./tests/global-setup.ts"],
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
