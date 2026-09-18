import { eq, inArray } from "drizzle-orm";

import { db } from "../db/client.js";
import { agents, agentSkills, departments, skills } from "../db/schema.js";
import type { AgentConfig, DepartmentConfig, SkillConfig } from "./schemas.js";

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
 * Upserts one canonical Skill file into its PostgreSQL projection row, keyed
 * by slug. `instructions` is the resource's optional `SKILL.md` content --
 * only its presence (`hasInstructions`) is projected, since `search_skills`/
 * `load_skill` read frozen Run-owned content rather than this row.
 */
export async function syncSkillProjection(
  config: SkillConfig,
  instructions: string | null,
  tx: DbOrTx = db,
): Promise<typeof skills.$inferSelect> {
  const values = {
    slug: config.slug,
    name: config.name,
    description: config.description,
    enabled: config.enabled,
    tags: config.tags,
    domains: config.domains,
    hasInstructions: instructions !== null && instructions.trim().length > 0,
  };

  const [row] = await tx
    .insert(skills)
    .values(values)
    .onConflictDoUpdate({ target: skills.slug, set: { ...values, updatedAt: new Date() } })
    .returning();

  return row;
}

/** Removes a Skill's PostgreSQL projection row by slug. A no-op if it was never synced. */
export async function removeSkillProjection(slug: string, tx: DbOrTx = db): Promise<void> {
  await tx.delete(skills).where(eq(skills.slug, slug));
}

/**
 * Replaces one Agent's Skill assignment projection to match `agent.yaml.skills`
 * exactly, resolving each canonical slug to its projected Skill row. Every
 * referenced slug must already be projected -- callers sync Skills before
 * Agents, per the roadmap's deterministic sync ordering.
 */
export async function syncAgentSkillAssignments(
  agentId: string,
  skillSlugs: readonly string[],
  tx: DbOrTx = db,
): Promise<void> {
  await tx.delete(agentSkills).where(eq(agentSkills.agentId, agentId));
  if (!skillSlugs.length) return;

  const rows = await tx.select({ id: skills.id, slug: skills.slug }).from(skills).where(inArray(skills.slug, [...skillSlugs]));
  const idBySlug = new Map(rows.map((row) => [row.slug, row.id]));

  const missing = skillSlugs.filter((slug) => !idBySlug.has(slug));
  if (missing.length) {
    throw new Error(`Cannot project Agent Skill assignment: Skill(s) not synced yet: ${missing.join(", ")}`);
  }

  await tx.insert(agentSkills).values(skillSlugs.map((slug) => ({ agentId, skillId: idBySlug.get(slug)! })));
}

/**
 * Upserts one canonical Agent file into its PostgreSQL projection row. The
 * owning Department must already be projected (its row is looked up by
 * slug). Skill assignment projection is a separate step
 * (`syncAgentSkillAssignments`) so a caller can run both inside one
 * transaction after the Agent row exists.
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
