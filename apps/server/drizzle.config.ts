import { existsSync } from "node:fs";

import { defineConfig } from "drizzle-kit";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required to run drizzle-kit commands");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
