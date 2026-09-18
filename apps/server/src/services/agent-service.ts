import {
  and,
  asc,
  eq,
  inArray,
  sql,
} from "drizzle-orm";

import type {
  Agent,
  CreateAgent,
  Department,
  Skill,
  UpdateAgent,
} from "@orc/shared";

import { env } from "../config/env.js";
import {
  ConfigConflictError,
  ConfigReferentialError,
  ConfigValidationError,
  deleteAgentFile,
  writeAgentFile,
} from "../config/config-mutation-service.js";
import { markConfigOutOfSync } from "../config/health-state.js";
import { loadConfigGraph } from "../config/loader.js";
import {
  removeAgentProjection,
  syncAgentProjection,
  syncAgentSkillAssignments,
} from "../config/projection-sync.js";
import type { AgentConfig } from "../config/schemas.js";
import {
  db,
} from "../db/client.js";
import {
  agents,
  agentSkills,
  departments,
  runs,
  teamMembers,
} from "../db/schema.js";
import { getSkillsByIds } from "./skill-service.js";
import {
  resolveEffectiveAgentConfig,
} from "./agent-config-resolver.js";

export class AgentServiceError extends Error {
  /**
   * Creates an Agent service error carrying its HTTP status.
   */
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}

/** Converts a known config-mutation-service error into the stable Agent service error shape. */
function translateConfigError(error: unknown): never {
  if (
    error instanceof ConfigConflictError ||
    error instanceof ConfigReferentialError ||
    error instanceof ConfigValidationError
  ) {
    throw new AgentServiceError(error.message, error.statusCode);
  }
  throw error;
}

/** Builds the canonical `.orc/agents/<slug>/agent.yaml` shape from flat API input. */
function toAgentConfig(
  input: CreateAgent,
  departmentSlug: string,
  skillSlugs: string[],
): AgentConfig {
  return {
    version: 1,
    slug: input.slug,
    name: input.name,
    department: departmentSlug,
    enabled: input.enabled ?? true,
    runtime: {
      harness: input.harnessOverride ?? null,
      model: input.modelOverride ?? null,
      reasoning: input.reasoningOverride ?? null,
    },
    permissions: {
      write: input.canWriteOverride ?? null,
      commands: input.canRunCommandsOverride ?? null,
      sandboxMode: input.sandboxModeOverride ?? null,
      commit: input.canCommitOverride ?? null,
    },
    skills: [...skillSlugs].sort(),
  };
}

/** Converts a Department database row into the shared API representation. */
function serializeDepartment(
  row:
    typeof departments.$inferSelect,
): Department {
  return {
    ...row,
    agentCount:
      0,
    configRevision: "",
    createdAt:
      row.createdAt.toISOString(),
    updatedAt:
      row.updatedAt.toISOString(),
  };
}

/**
 * Converts an agent database row and its owning Department into the shared
 * API representation, including the resolved effective runtime configuration
 * and the Agent's current Team assignment resolved from `team_members`.
 */
export function serializeAgent(
  row:
    typeof agents.$inferSelect,
  departmentRow:
    typeof departments.$inferSelect,
  currentTeamId:
    string | null = null,
  skills: Skill[] = [],
  configRevision = "",
): Agent {
  const department =
    serializeDepartment(
      departmentRow,
    );

  const effective =
    resolveEffectiveAgentConfig(
      row,
      department,
    );

  return {
    id:
      row.id,
    departmentId:
      row.departmentId,
    slug:
      row.slug,
    name:
      row.name,
    enabled:
      row.enabled,
    harnessOverride: row.harnessOverride ?? null,
    hasHarnessOverride: row.harnessOverride != null,
    canWriteOverride: row.canWriteOverride ?? null,
    hasCanWriteOverride: row.canWriteOverride != null,
    canRunCommandsOverride: row.canRunCommandsOverride ?? null,
    hasCanRunCommandsOverride: row.canRunCommandsOverride != null,
    sandboxModeOverride: row.sandboxModeOverride ?? null,
    hasSandboxModeOverride: row.sandboxModeOverride != null,
    canCommitOverride: row.canCommitOverride ?? null,
    hasCanCommitOverride: row.canCommitOverride != null,
    modelOverride:
      row.modelOverride ??
      null,
    reasoningOverride:
      row.reasoningOverride ??
      null,
    additionalPrompt:
      row.additionalPrompt,
    department,
    effective,
    currentTeamId,
    skills,
    configRevision,
    hasModelOverride:
      row.modelOverride !==
        null &&
      row.modelOverride !==
        undefined,
    hasReasoningOverride:
      row.reasoningOverride !==
        null &&
      row.reasoningOverride !==
        undefined,
    createdAt:
      row.createdAt.toISOString(),
    updatedAt:
      row.updatedAt.toISOString(),
  };
}

/** Loads assigned Skills without duplicating Agent rows in read-model queries. */
async function loadSkillsByAgentId(agentIds: string[]): Promise<Map<string, Skill[]>> {
  const result = new Map<string, Skill[]>();
  if (!agentIds.length) return result;
  const assignments = await db.select().from(agentSkills).where(inArray(agentSkills.agentId, agentIds));
  const skillsById = new Map((await getSkillsByIds(assignments.map((assignment) => assignment.skillId))).map((skill) => [skill.id, skill]));
  for (const assignment of assignments) {
    const skill = skillsById.get(assignment.skillId);
    if (skill) result.set(assignment.agentId, [...(result.get(assignment.agentId) ?? []), skill]);
  }
  for (const assigned of result.values()) assigned.sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
  return result;
}

/**
 * Replaces an Agent's Skill assignments. `agent.yaml.skills` is the
 * canonical assignment (roadmap Vertical Spec 3): the selected Skill DB ids
 * are resolved to slugs, written into the Agent's canonical file first, then
 * the `agent_skills` projection is synchronized to match.
 */
export async function replaceAgentSkills(
  agentId: string,
  skillIds: string[],
  configRoot: string = env.ORC_CONFIG_ROOT,
): Promise<Agent | null> {
  if (new Set(skillIds).size !== skillIds.length) throw new AgentServiceError("Each Skill may only be assigned once", 400);

  const [existing] = await db.select().from(agents).where(eq(agents.id, agentId));
  if (!existing) return null;

  const assignedSkills = skillIds.length ? await getSkillsByIds(skillIds) : [];
  if (assignedSkills.length !== skillIds.length) throw new AgentServiceError("One or more selected Skills do not exist", 400);

  const [department] = await db.select().from(departments).where(eq(departments.id, existing.departmentId));
  if (!department) throw new AgentServiceError("The selected Department does not exist", 400);

  const graph = await loadConfigGraph(configRoot);
  const existingResource = graph.agents.find((resource) => resource.data.slug === existing.slug);
  const currentSkillSlugs = (await loadSkillsByAgentId([agentId])).get(agentId)?.map((skill) => skill.slug) ?? [];

  const baseConfig: AgentConfig = existingResource
    ? existingResource.data
    : toAgentConfig(
        {
          departmentId: existing.departmentId,
          slug: existing.slug,
          name: existing.name,
          enabled: existing.enabled,
          harnessOverride: existing.harnessOverride,
          modelOverride: existing.modelOverride,
          reasoningOverride: existing.reasoningOverride,
          canWriteOverride: existing.canWriteOverride,
          canRunCommandsOverride: existing.canRunCommandsOverride,
          sandboxModeOverride: existing.sandboxModeOverride,
          canCommitOverride: existing.canCommitOverride,
          additionalPrompt: existing.additionalPrompt,
        },
        department.slug,
        currentSkillSlugs,
      );
  const instructions = existingResource?.instructions ?? existing.additionalPrompt;

  const merged: AgentConfig = { ...baseConfig, skills: [...new Set(assignedSkills.map((skill) => skill.slug))].sort() };

  let written;
  try {
    written = await writeAgentFile(configRoot, merged, instructions, {
      previousSlug: existingResource ? existing.slug : null,
      expectedRevision: null,
    });
  } catch (error) {
    translateConfigError(error);
  }

  try {
    return await db.transaction(async (tx) => {
      await syncAgentSkillAssignments(agentId, written.data.skills, tx);
      return serializeAgent(
        existing,
        department,
        (await tx.select({ teamId: teamMembers.teamId }).from(teamMembers).where(eq(teamMembers.agentId, agentId)))[0]?.teamId ?? null,
        assignedSkills,
        written.configRevision,
      );
    });
  } catch (error) {
    markConfigOutOfSync({ reason: "Agent Skill assignment projection sync failed after canonical file write", resourceType: "agent", resourceId: existing.slug });
    return translateDatabaseError(error);
  }
}

/**
 * Maps expected PostgreSQL constraint errors into stable service errors.
 */
function translateDatabaseError(
  error: unknown,
): never {
  if (
    error instanceof
    AgentServiceError
  ) {
    throw error;
  }

  if (
    typeof error ===
      "object" &&
    error !== null &&
    "code" in error
  ) {
    const code =
      (
        error as {
          code?: string;
        }
      ).code;

    if (
      code ===
      "23505"
    ) {
      throw new AgentServiceError(
        "An agent slug already exists",
        409,
      );
    }

    if (
      code ===
      "23503"
    ) {
      throw new AgentServiceError(
        "The referenced Department does not exist",
        400,
      );
    }

    if (
      code ===
      "23514"
    ) {
      throw new AgentServiceError(
        "The agent configuration is invalid",
        400,
      );
    }
  }

  throw error;
}

/**
 * Returns whether a persisted workflow snapshot contains the requested agent.
 */
function workflowSnapshotContainsAgent(
  snapshot:
    unknown,
  agentId:
    string,
): boolean {
  if (
    typeof snapshot !==
      "object" ||
    snapshot ===
      null ||
    !(
      "agents" in
      snapshot
    )
  ) {
    return false;
  }

  const snapshotAgents =
    (
      snapshot as {
        agents?: unknown;
      }
    ).agents;

  if (
    !Array.isArray(
      snapshotAgents,
    )
  ) {
    return false;
  }

  return snapshotAgents.some(
    (
      candidate,
    ) =>
      typeof candidate ===
        "object" &&
      candidate !==
        null &&
      "id" in
        candidate &&
      candidate.id ===
        agentId,
  );
}

/**
 * Loads the Department a new or updated Agent must belong to.
 */
async function loadDepartmentOrThrow(
  departmentId:
    string,
): Promise<
  typeof departments.$inferSelect
> {
  const [department] =
    await db
      .select()
      .from(departments)
      .where(
        eq(
          departments.id,
          departmentId,
        ),
      );

  if (
    !department
  ) {
    throw new AgentServiceError(
      "The selected Department does not exist",
      400,
    );
  }

  return department;
}

/**
 * Lists every configured agent in deterministic Department/name order.
 */
export async function listAgents(configRoot: string = env.ORC_CONFIG_ROOT): Promise<
  Agent[]
> {
  const rows =
    await db
      .select()
      .from(agents)
      .innerJoin(
        departments,
        eq(
          agents.departmentId,
          departments.id,
        ),
      )
      .leftJoin(
        teamMembers,
        eq(
          teamMembers.agentId,
          agents.id,
        ),
      )
      .orderBy(
        asc(
          departments.name,
        ),
        asc(
          agents.name,
        ),
      );

  const [skillsByAgentId, graph] = await Promise.all([
    loadSkillsByAgentId(rows.map((row) => row.agents.id)),
    loadConfigGraph(configRoot),
  ]);
  const revisionBySlug = new Map(graph.agents.map((resource) => [resource.data.slug, resource.contentHash]));

  return rows.map(
    (row) =>
      serializeAgent(
        row.agents,
        row.departments,
        row.team_members?.teamId ??
          null,
        skillsByAgentId.get(row.agents.id) ?? [],
        revisionBySlug.get(row.agents.slug) ?? "",
      ),
  );
}

/**
 * Returns one agent together with its resolved current Team assignment.
 */
export async function getAgent(
  id:
    string,
  configRoot: string = env.ORC_CONFIG_ROOT,
): Promise<
  Agent | null
> {
  const [row] =
    await db
      .select()
      .from(agents)
      .innerJoin(
        departments,
        eq(
          agents.departmentId,
          departments.id,
        ),
      )
      .leftJoin(
        teamMembers,
        eq(
          teamMembers.agentId,
          agents.id,
        ),
      )
      .where(
        eq(
          agents.id,
          id,
        ),
      );

  if (
    !row
  ) {
    return null;
  }

  const [skillsByAgentId, graph] = await Promise.all([
    loadSkillsByAgentId([id]),
    loadConfigGraph(configRoot),
  ]);
  const revision = graph.agents.find((resource) => resource.data.slug === row.agents.slug)?.contentHash ?? "";

  return serializeAgent(
    row.agents,
    row.departments,
    row.team_members?.teamId ??
      null,
    skillsByAgentId.get(id) ?? [],
    revision,
  );
}

/**
 * Creates a new Department-scoped worker-agent instance. Team placement is
 * assigned separately by saving the owning Team's workflow. Canonical
 * mutation order: write the `.orc/agents/<slug>/agent.yaml` file first, then
 * synchronize its PostgreSQL projection.
 */
export async function createAgent(
  input:
    CreateAgent,
  configRoot: string = env.ORC_CONFIG_ROOT,
): Promise<Agent> {
  const department =
    await loadDepartmentOrThrow(
      input.departmentId,
    );

  const config = toAgentConfig(input, department.slug, []);
  const instructions = input.additionalPrompt ?? "";

  let written;
  try {
    written = await writeAgentFile(configRoot, config, instructions, { previousSlug: null, expectedRevision: null });
  } catch (error) {
    translateConfigError(error);
  }

  try {
    const row = await db.transaction(async (tx) => {
      const inserted = await syncAgentProjection(written.data, written.instructions, tx);
      await syncAgentSkillAssignments(inserted.id, written.data.skills, tx);
      return inserted;
    });
    return serializeAgent(row, department, null, [], written.configRevision);
  } catch (error) {
    markConfigOutOfSync({ reason: "Agent projection sync failed after canonical file write", resourceType: "agent", resourceId: config.slug });
    return translateDatabaseError(error);
  }
}

/**
 * Updates agent configuration in place. Team placement is never modified
 * here; it is owned exclusively by the Team workflow resource. The full
 * canonical resource is rebuilt from the current file plus the supplied
 * partial edit, then written and projected.
 */
export async function updateAgent(
  id: string,
  input: UpdateAgent,
  expectedRevision: string | null = null,
  configRoot: string = env.ORC_CONFIG_ROOT,
): Promise<Agent | null> {
  // Read-only guard: matches Team workflow's membership lock so a Department
  // change cannot race a concurrent Team assignment. The canonical file write
  // that follows happens outside this transaction because filesystem writes
  // are not part of the PostgreSQL transaction boundary.
  const guard = await db.transaction(async (tx) => {
    await tx.execute(sql`LOCK TABLE ${teamMembers} IN SHARE ROW EXCLUSIVE MODE`);
    const [existing] = await tx.select().from(agents).where(eq(agents.id, id));
    if (!existing) return null;
    const [member] = await tx.select({ teamId: teamMembers.teamId }).from(teamMembers).where(eq(teamMembers.agentId, id));
    if (input.departmentId !== undefined && input.departmentId !== existing.departmentId && member) {
      throw new AgentServiceError("Remove the Agent from its Team before changing Department", 409);
    }
    const [department] = await tx.select().from(departments).where(eq(departments.id, input.departmentId ?? existing.departmentId));
    if (!department) throw new AgentServiceError("The selected Department does not exist", 400);
    return { existing, department, teamId: member?.teamId ?? null };
  });

  if (!guard) return null;
  const { existing, department, teamId } = guard;

  const graph = await loadConfigGraph(configRoot);
  const existingResource = graph.agents.find((resource) => resource.data.slug === existing.slug);
  const currentSkillSlugs = (await loadSkillsByAgentId([id])).get(id)?.map((skill) => skill.slug) ?? [];

  const baseConfig: AgentConfig = existingResource
    ? existingResource.data
    : toAgentConfig(
        {
          departmentId: existing.departmentId,
          slug: existing.slug,
          name: existing.name,
          enabled: existing.enabled,
          harnessOverride: existing.harnessOverride,
          modelOverride: existing.modelOverride,
          reasoningOverride: existing.reasoningOverride,
          canWriteOverride: existing.canWriteOverride,
          canRunCommandsOverride: existing.canRunCommandsOverride,
          sandboxModeOverride: existing.sandboxModeOverride,
          canCommitOverride: existing.canCommitOverride,
          additionalPrompt: existing.additionalPrompt,
        },
        department.slug,
        currentSkillSlugs,
      );
  const baseInstructions = existingResource?.instructions ?? existing.additionalPrompt;

  const merged: AgentConfig = {
    version: 1,
    slug: input.slug ?? baseConfig.slug,
    name: input.name ?? baseConfig.name,
    department: department.slug,
    enabled: input.enabled ?? baseConfig.enabled,
    runtime: {
      harness: input.harnessOverride !== undefined ? input.harnessOverride : baseConfig.runtime.harness,
      model: input.modelOverride !== undefined ? input.modelOverride : baseConfig.runtime.model,
      reasoning: input.reasoningOverride !== undefined ? input.reasoningOverride : baseConfig.runtime.reasoning,
    },
    permissions: {
      write: input.canWriteOverride !== undefined ? input.canWriteOverride : baseConfig.permissions.write,
      commands: input.canRunCommandsOverride !== undefined ? input.canRunCommandsOverride : baseConfig.permissions.commands,
      sandboxMode: input.sandboxModeOverride !== undefined ? input.sandboxModeOverride : baseConfig.permissions.sandboxMode,
      commit: input.canCommitOverride !== undefined ? input.canCommitOverride : baseConfig.permissions.commit,
    },
    // Canonical assignment lives in `agent.yaml.skills`; `updateAgent` never
    // changes it (only `replaceAgentSkills` does), so it carries the current
    // file value forward unchanged even for a first-write Agent (`toAgentConfig`
    // above seeds it from the current DB projection in that case).
    skills: baseConfig.skills,
  };
  const mergedInstructions = input.additionalPrompt ?? baseInstructions;

  // An Agent row synced before its canonical file existed (or drifted after
  // a manual delete) has no matching file resource; treat that as a first
  // write rather than an edit of a file that was never there.
  let written;
  try {
    written = await writeAgentFile(configRoot, merged, mergedInstructions, {
      previousSlug: existingResource ? existing.slug : null,
      expectedRevision: existingResource ? expectedRevision : null,
    });
  } catch (error) {
    translateConfigError(error);
  }

  try {
    const row = await db.transaction(async (tx) => {
      const updated = await syncAgentProjection(written.data, written.instructions, tx);
      await syncAgentSkillAssignments(id, written.data.skills, tx);
      return updated;
    });
    const skillsByAgentId = await loadSkillsByAgentId([id]);
    return serializeAgent(row, department, teamId, skillsByAgentId.get(id) ?? [], written.configRevision);
  } catch (error) {
    markConfigOutOfSync({ reason: "Agent projection sync failed after canonical file write", resourceType: "agent", resourceId: merged.slug });
    return translateDatabaseError(error);
  }
}

/**
 * Permanently deletes an unassigned Agent only when no active Run snapshot contains it.
 *
 * Historical workflow snapshots are never updated. Team membership must be
 * removed beforehand. Safety guards run against PostgreSQL first (the
 * authoritative source for membership/Run state), then the canonical file is
 * removed, then its projection row.
 */
export async function deleteAgent(
  id:
    string,
  expectedRevision: string | null = null,
  configRoot: string = env.ORC_CONFIG_ROOT,
): Promise<boolean> {
  let slug: string | null;
  try {
    slug = await db.transaction(
      async (
        tx,
      ) => {
        await tx.execute(
          sql`LOCK TABLE ${runs} IN SHARE MODE`,
        );

        await tx.execute(sql`LOCK TABLE ${teamMembers} IN SHARE ROW EXCLUSIVE MODE`);

        const [existing] =
          await tx
            .select({
              id:
                agents.id,
              slug:
                agents.slug,
            })
            .from(agents)
            .where(
              eq(
                agents.id,
                id,
              ),
            );

        if (
          !existing
        ) {
          return null;
        }

        const [member] = await tx.select({ id: teamMembers.id }).from(teamMembers).where(eq(teamMembers.agentId, id));
        if (member) throw new AgentServiceError("Remove the Agent from its Team before deleting it", 409);

        const activeRuns =
          await tx
            .select({
              id:
                runs.id,
              workflowSnapshot:
                runs.workflowSnapshot,
            })
            .from(runs)
            .where(
              inArray(
                runs.status,
                [
                  "pending",
                  "running",
                ],
              ),
            );

        const conflictingRun =
          activeRuns.find(
            (
              run,
            ) =>
              workflowSnapshotContainsAgent(
                run.workflowSnapshot,
                id,
              ),
          );

        if (
          conflictingRun
        ) {
          throw new AgentServiceError(
            `Agent cannot be deleted because active run ${conflictingRun.id} contains it in its workflow snapshot`,
            409,
          );
        }

        return existing.slug;
      },
    );
  } catch (error) {
    if (
      typeof error ===
        "object" &&
      error !==
        null &&
      "code" in error &&
      (
        error as {
          code?: string;
        }
      ).code ===
        "23503"
    ) {
      throw new AgentServiceError(
        "Agent cannot be deleted because related data still references it",
        409,
      );
    }

    return translateDatabaseError(
      error,
    );
  }

  if (slug === null) {
    return false;
  }

  try {
    await deleteAgentFile(configRoot, slug, expectedRevision);
  } catch (error) {
    translateConfigError(error);
  }

  try {
    await removeAgentProjection(slug);
    return true;
  } catch (error) {
    markConfigOutOfSync({ reason: "Agent projection removal failed after canonical file delete", resourceType: "agent", resourceId: slug });
    return translateDatabaseError(error);
  }
}

/**
 * Returns only agents currently enabled for future run configuration, using
 * both Department and Agent enabled state.
 */
export async function listEnabledAgentsForFutureRuns(): Promise<
  Agent[]
> {
  const rows =
    await db
      .select()
      .from(agents)
      .innerJoin(
        departments,
        eq(
          agents.departmentId,
          departments.id,
        ),
      )
      .leftJoin(
        teamMembers,
        eq(
          teamMembers.agentId,
          agents.id,
        ),
      )
      .where(
        and(
          eq(
            agents.enabled,
            true,
          ),
          eq(
            departments.enabled,
            true,
          ),
        ),
      )
      .orderBy(
        asc(
          departments.name,
        ),
        asc(
          agents.name,
        ),
      );

  const skillsByAgentId = await loadSkillsByAgentId(rows.map((row) => row.agents.id));

  return rows.map(
    (row) =>
      serializeAgent(
        row.agents,
        row.departments,
        row.team_members?.teamId ??
          null,
        skillsByAgentId.get(row.agents.id) ?? [],
      ),
  );
}

/** Resolves a draft without saving Agent or Department configuration. */
export async function previewAgent(input: Omit<CreateAgent, "name" | "slug">) {
  const department = await loadDepartmentOrThrow(input.departmentId);
  return resolveEffectiveAgentConfig({ ...input, modelOverride: input.modelOverride ?? null, reasoningOverride: input.reasoningOverride ?? null }, department);
}
