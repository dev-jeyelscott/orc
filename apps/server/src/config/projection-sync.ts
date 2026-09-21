import { eq, inArray } from "drizzle-orm";

import { db } from "../db/client.js";
import { agents, agentSkills, departments, projectTeamAssignments, skills, teamMembers, teams } from "../db/schema.js";
import type { AgentConfig, DepartmentConfig, ProjectConfig, SkillConfig, TeamConfig } from "./schemas.js";

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

/**
 * Upserts one canonical Team file's metadata into its PostgreSQL projection
 * row, keyed by slug. Membership itself is a separate projection step (the
 * existing `team_members` diff in `team-membership.ts`) so a metadata-only
 * edit never touches composition.
 */
export async function syncTeamProjection(config: TeamConfig, tx: DbOrTx = db): Promise<typeof teams.$inferSelect> {
  const values = {
    slug: config.slug,
    name: config.name,
    description: config.description,
    enabled: config.enabled,
  };

  const [row] = await tx
    .insert(teams)
    .values(values)
    .onConflictDoUpdate({ target: teams.slug, set: { ...values, updatedAt: new Date() } })
    .returning();

  return row;
}

/** Removes a Team's PostgreSQL projection row by slug. A no-op if it was never synced. */
export async function removeTeamProjection(slug: string, tx: DbOrTx = db): Promise<void> {
  await tx.delete(teams).where(eq(teams.slug, slug));
}

/**
 * Replaces one Team's `team_members` projection to match `team.yaml.members`
 * exactly, resolving each canonical Agent slug to its projected id. Used by
 * full-graph configuration sync (roadmap Vertical Spec 7), which trusts the
 * file was already cross-reference validated at load time -- unlike
 * `replaceTeamMembers` in `team-membership.ts`, this never writes a file and
 * performs no membership-invariant validation of its own.
 */
export async function syncTeamMembershipProjection(
  teamId: string,
  agentSlugs: readonly string[],
  tx: DbOrTx = db,
): Promise<void> {
  const agentRows = agentSlugs.length
    ? await tx
        .select({ id: agents.id, slug: agents.slug, departmentId: agents.departmentId })
        .from(agents)
        .where(inArray(agents.slug, [...agentSlugs]))
    : [];

  const missing = agentSlugs.filter((slug) => !agentRows.some((row) => row.slug === slug));
  if (missing.length) {
    throw new Error(`Cannot project Team membership: Agent(s) not synced yet: ${missing.join(", ")}`);
  }

  const existingRows = await tx.select().from(teamMembers).where(eq(teamMembers.teamId, teamId));
  const wantedAgentIds = new Set(agentRows.map((row) => row.id));
  const existingAgentIds = new Set(existingRows.map((row) => row.agentId));
  const remainingRows = existingRows.filter((row) => wantedAgentIds.has(row.agentId));
  const rowsToRemove = existingRows.filter((row) => !wantedAgentIds.has(row.agentId));
  const rowsToAdd = agentRows.filter((row) => !existingAgentIds.has(row.id));

  if (rowsToRemove.length) {
    await tx.delete(teamMembers).where(
      inArray(
        teamMembers.id,
        rowsToRemove.map((row) => row.id),
      ),
    );
  }

  if (rowsToAdd.length) {
    const maxLayer = remainingRows.reduce((max, row) => Math.max(max, row.layer), 0);
    await tx.insert(teamMembers).values(
      rowsToAdd.map((row, index) => ({
        teamId,
        departmentId: row.departmentId,
        agentId: row.id,
        layer: maxLayer + index + 1,
        executionOrder: 1,
      })),
    );
  }
}

/**
 * Upserts one canonical Project file's static assignment/automation intent
 * into its PostgreSQL projection row, keyed by the Project's canonical
 * absolute filesystem path (the same identity `project-team-assignment-service.ts`
 * has always used). Referenced Teams must already be projected.
 */
export async function syncProjectAssignmentProjection(
  config: ProjectConfig,
  absoluteProjectPath: string,
  tx: DbOrTx = db,
): Promise<void> {
  const resolutionSlug = config.resolutionTeam ?? config.team ?? null;
  const autoModeSlug = config.automation.autoModeTeam ?? (config.automation.autoModeEnabled ? resolutionSlug : null);
  const wantedSlugs = [resolutionSlug, config.developmentTeam, autoModeSlug].filter((slug): slug is string => slug !== null);
  const rows = wantedSlugs.length ? await tx.select({ id: teams.id, slug: teams.slug }).from(teams).where(inArray(teams.slug, wantedSlugs)) : [];
  const idBySlug = new Map(rows.map((row) => [row.slug, row.id]));
  const missing = wantedSlugs.filter((slug) => !idBySlug.has(slug));
  if (missing.length) throw new Error(`Cannot project Project "${config.slug}": Team(s) not synced yet: ${missing.join(", ")}`);

  const values = {
    projectPath: absoluteProjectPath,
    resolutionTeamId: resolutionSlug ? idBySlug.get(resolutionSlug)! : null,
    developmentTeamId: config.developmentTeam ? idBySlug.get(config.developmentTeam)! : null,
    notionDataSourceId: config.automation.notionDataSourceId,
    autoModeEnabled: config.automation.autoModeEnabled,
    autoModeTeamId: autoModeSlug ? idBySlug.get(autoModeSlug)! : null,
  };

  await tx
    .insert(projectTeamAssignments)
    .values(values)
    .onConflictDoUpdate({ target: projectTeamAssignments.projectPath, set: { ...values, updatedAt: new Date() } });
}

/** Removes a Project's PostgreSQL assignment projection row by canonical path. A no-op if it was never synced. */
export async function removeProjectAssignmentProjection(absoluteProjectPath: string, tx: DbOrTx = db): Promise<void> {
  await tx.delete(projectTeamAssignments).where(eq(projectTeamAssignments.projectPath, absoluteProjectPath));
}
