import { eq } from "drizzle-orm";

import { db } from "../db/client.js";
import { agents, departments } from "../db/schema.js";
import type { AgentConfig, DepartmentConfig } from "./schemas.js";

/** Accepts either the top-level `db` handle or an in-flight `db.transaction` callback's `tx`. */
type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Upserts one canonical Department file into its PostgreSQL projection row,
 * keyed by slug (never a DB UUID, per roadmap invariant #6). Runs inside the
 * caller's transaction when one is supplied so a Department + dependent
 * Agent sync stay atomic together.
 */
export async function syncDepartmentProjection(
  config: DepartmentConfig,
  prompt: string,
  tx: DbOrTx = db,
): Promise<typeof departments.$inferSelect> {
  const values = {
    slug: config.slug,
    name: config.name,
    role: config.role,
    description: config.description,
    enabled: config.enabled,
    harness: config.runtime.harness,
    defaultModel: config.runtime.model,
    defaultReasoning: config.runtime.reasoning,
    systemPrompt: prompt,
    canWrite: config.permissions.write,
    canRunCommands: config.permissions.commands,
    sandboxMode: config.permissions.sandboxMode,
    canCommit: config.permissions.commit,
  };

  const [row] = await tx
    .insert(departments)
    .values(values)
    .onConflictDoUpdate({ target: departments.slug, set: { ...values, updatedAt: new Date() } })
    .returning();

  return row;
}

/** Removes a Department's PostgreSQL projection row by slug. A no-op if it was never synced. */
export async function removeDepartmentProjection(slug: string, tx: DbOrTx = db): Promise<void> {
  await tx.delete(departments).where(eq(departments.slug, slug));
}

/**
 * Upserts one canonical Agent file into its PostgreSQL projection row. The
 * owning Department must already be projected (its row is looked up by
 * slug). Skill assignment projection is intentionally out of scope here: it
 * remains owned by the existing `/api/agents/:id/skills` DB-direct path
 * until Skills become file-authoritative (roadmap Vertical Spec 3).
 */
export async function syncAgentProjection(
  config: AgentConfig,
  instructions: string,
  tx: DbOrTx = db,
): Promise<typeof agents.$inferSelect> {
  const [department] = await tx.select().from(departments).where(eq(departments.slug, config.department));
  if (!department) {
    throw new Error(`Cannot project Agent "${config.slug}": Department "${config.department}" has not been synced yet`);
  }

  const values = {
    departmentId: department.id,
    slug: config.slug,
    name: config.name,
    enabled: config.enabled,
    harnessOverride: config.runtime.harness,
    modelOverride: config.runtime.model,
    reasoningOverride: config.runtime.reasoning,
    canWriteOverride: config.permissions.write,
    canRunCommandsOverride: config.permissions.commands,
    sandboxModeOverride: config.permissions.sandboxMode,
    canCommitOverride: config.permissions.commit,
    additionalPrompt: instructions,
  };

  const [row] = await tx
    .insert(agents)
    .values(values)
    .onConflictDoUpdate({ target: agents.slug, set: { ...values, updatedAt: new Date() } })
    .returning();

  return row;
}

/** Removes an Agent's PostgreSQL projection row by slug. A no-op if it was never synced. */
export async function removeAgentProjection(slug: string, tx: DbOrTx = db): Promise<void> {
  await tx.delete(agents).where(eq(agents.slug, slug));
}
