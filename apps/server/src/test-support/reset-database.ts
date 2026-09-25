import fs from "node:fs/promises";
import path from "node:path";

import { afterAll } from "vitest";
import postgres from "postgres";

import { BASELINE_CONFIG_DIR, BASELINE_SCHEMA } from "./test-database.js";

/*
 * Vitest setup file: after every test file, restore the test database to the
 * post-migration snapshot taken by global-setup.ts, and the temporary `.orc/`
 * tree to its exported baseline. Whatever a file created, updated, or deleted
 * is undone, so no test depends on (or leaks into) another.
 */
afterAll(async () => {
  const configRoot = process.env.ORC_CONFIG_ROOT!;
  await fs.rm(configRoot, { recursive: true, force: true });
  await fs.cp(path.join(path.dirname(configRoot), BASELINE_CONFIG_DIR), configRoot, { recursive: true });

  const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });

  try {
    const tables = (await sql<{ name: string }[]>`
      select tablename as name from pg_tables where schemaname = 'public'
    `).map(({ name }) => name);

    const references = await sql<{ child: string; parent: string }[]>`
      select child.relname as child, parent.relname as parent
      from pg_constraint c
      join pg_class child on child.oid = c.conrelid
      join pg_class parent on parent.oid = c.confrelid
      join pg_namespace n on n.oid = child.relnamespace
      where c.contype = 'f' and n.nspname = 'public' and child.relname <> parent.relname
    `;

    const order = insertionOrder(tables, references);
    const quoted = (name: string) => `"${name}"`;

    await sql.begin(async (tx) => {
      await tx.unsafe(`truncate ${tables.map((name) => `public.${quoted(name)}`).join(", ")} restart identity`);

      for (const name of order) {
        await tx.unsafe(
          `insert into public.${quoted(name)} select * from ${BASELINE_SCHEMA}.${quoted(name)}`,
        );
      }
    });
  } finally {
    await sql.end();
  }
});

/** Orders tables so every foreign-key parent is restored before its children. */
function insertionOrder(
  tables: string[],
  references: { child: string; parent: string }[],
): string[] {
  const ordered: string[] = [];
  const remaining = new Set(tables);

  while (remaining.size > 0) {
    const ready = [...remaining].filter((table) =>
      references.every((ref) => ref.child !== table || !remaining.has(ref.parent)),
    );

    if (ready.length === 0) {
      throw new Error(
        `Cannot restore the test baseline: foreign-key cycle among ${[...remaining].join(", ")}.`,
      );
    }

    for (const table of ready.sort()) {
      ordered.push(table);
      remaining.delete(table);
    }
  }

  return ordered;
}
