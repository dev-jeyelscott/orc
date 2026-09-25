import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { BASELINE_CONFIG_DIR, BASELINE_SCHEMA, databaseName } from "./test-database.js";

const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../drizzle",
);

/**
 * Vitest global setup: rebuilds the test database from migrations, then
 * snapshots the migrated rows (fixed seed Teams/Agents, singleton settings)
 * into BASELINE_SCHEMA so reset-database.ts can restore them after each file.
 * Rebuilding here means nothing a previous run left behind survives.
 *
 * It also exports that baseline into a temporary `.orc/` tree and points
 * ORC_CONFIG_ROOT at it, so tests never read or write the operator's real
 * configuration. The returned teardown removes the temporary tree.
 */
export default async function setup() {
  const url = process.env.DATABASE_URL;

  if (!url) {
    throw new Error("DATABASE_URL was not pointed at the test database by vitest.config.ts.");
  }

  const sql = postgres(url, { max: 1, onnotice: () => {} });

  try {
    try {
      await sql`select 1`;
    } catch (error) {
      if ((error as { code?: string }).code === "3D000") {
        const name = databaseName(new URL(url));
        throw new Error(
          `Test database "${name}" does not exist. Create it once, owned by the app role, e.g.\n  sudo -u postgres createdb -O ${new URL(url).username} ${name}`,
        );
      }

      throw error;
    }

    await sql.unsafe(`
      drop schema if exists ${BASELINE_SCHEMA} cascade;
      drop schema if exists drizzle cascade;
      drop schema if exists public cascade;
      create schema public;
    `);

    await migrate(drizzle(sql), { migrationsFolder });

    const tables = await sql<{ name: string }[]>`
      select tablename as name from pg_tables where schemaname = 'public' order by tablename
    `;

    await sql.unsafe(`create schema ${BASELINE_SCHEMA}`);

    for (const { name } of tables) {
      await sql.unsafe(
        `create table ${BASELINE_SCHEMA}."${name}" as select * from public."${name}"`,
      );
    }
  } finally {
    await sql.end();
  }

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "orc-test-config-"));
  const baselineConfigRoot = path.join(tempRoot, BASELINE_CONFIG_DIR);
  const configRoot = path.join(tempRoot, ".orc");

  // Imported only now: these modules read DATABASE_URL when first loaded.
  const { exportConfigFromDatabase } = await import("../config/export.js");
  const { queryClient } = await import("../db/client.js");
  const { env } = await import("../config/env.js");

  try {
    const result = await exportConfigFromDatabase({
      outputRoot: baselineConfigRoot,
      workspaceRoot: env.WORKSPACE_ROOT,
    });

    if (!result.validation.valid) {
      throw new Error(
        `Exported test configuration is invalid: ${result.validation.issues.map((issue) => issue.message).join("; ")}`,
      );
    }
  } finally {
    await queryClient.end();
  }

  await fs.cp(baselineConfigRoot, configRoot, { recursive: true });
  process.env.ORC_CONFIG_ROOT = configRoot;

  return async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  };
}
