import { existsSync } from "node:fs";

import { defineConfig } from "vitest/config";

// Mirrors drizzle.config.ts: DB-backed tests (agent-execution-service, agent-executions routes)
// need DATABASE_URL. Load it from .env the same way `db:migrate`/`db:generate` do, rather than
// requiring every test invocation to pass --env-file explicitly.
if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
