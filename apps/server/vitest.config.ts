import { existsSync } from "node:fs";

import { defineConfig } from "vitest/config";

import { resolveTestDatabaseUrl } from "./src/test-support/test-database.js";

// Mirrors drizzle.config.ts: load connection settings from .env the same way
// db:migrate and db:generate do.
if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

// Tests never touch the development database. They run against a dedicated
// `*_test` database (TEST_DATABASE_URL, or DATABASE_URL + "_test") that
// global-setup.ts rebuilds from migrations on every run.
process.env.DATABASE_URL = resolveTestDatabaseUrl(process.env);

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    globalSetup: ["src/test-support/global-setup.ts"],
    // Restores the post-migration baseline after each test file.
    setupFiles: ["src/test-support/reset-database.ts"],

    // Integration tests share the test database and enforce one active
    // task-backed workflow globally. Run test files sequentially so
    // independent integration tests cannot race against that invariant.
    fileParallelism: false,
  },
});
