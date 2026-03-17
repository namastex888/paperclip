import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globalSetup: ["src/__tests__/helpers/global-setup.ts"],
    fileParallelism: false,
    pool: "threads",
    poolOptions: {
      threads: {
        maxThreads: 1,
        minThreads: 1,
      },
    },
    teardownTimeout: 30_000,
  },
});
