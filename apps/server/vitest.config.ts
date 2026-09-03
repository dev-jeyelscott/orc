import { existsSync } from "node:fs";

import { defineConfig } from "vitest/config";

// Mirrors drizzle.config.ts: DB-backed tests need DATABASE_URL.
// Load it from .env the same way db:migrate and db:generate do.
if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],

    // Server integration tests share one PostgreSQL database and enforce
    // one active task-backed workflow globally. Run test files sequentially
    // so independent integration tests cannot race against that invariant.
    fileParallelism: false,
  },
});
