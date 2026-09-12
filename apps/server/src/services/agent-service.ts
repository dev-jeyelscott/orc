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
  UpdateAgent,
} from "@orc/shared";

import {
  db,
} from "../db/client.js";
import {
  agents,
  departments,
  runs,
  teamMembers,
} from "../db/schema.js";
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

/** Converts a Department database row into the shared API representation. */
function serializeDepartment(
  row:
    typeof departments.$inferSelect,
): Department {
  return {
    ...row,
    agentCount:
      0,
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
export async function listAgents(): Promise<
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

  return rows.map(
    (row) =>
      serializeAgent(
        row.agents,
        row.departments,
        row.team_members?.teamId ??
          null,
      ),
  );
}

/**
 * Returns one agent together with its resolved current Team assignment.
 */
export async function getAgent(
  id:
    string,
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

  return serializeAgent(
    row.agents,
    row.departments,
    row.team_members?.teamId ??
      null,
  );
}

/**
 * Creates a new Department-scoped worker-agent instance. Team placement is
 * assigned separately by saving the owning Team's workflow.
 */
export async function createAgent(
  input:
    CreateAgent,
): Promise<Agent> {
  try {
    const department =
      await loadDepartmentOrThrow(
        input.departmentId,
      );

    const [agent] =
      await db
        .insert(agents)
        .values({
          departmentId:
            input.departmentId,
          slug:
            input.slug,
          name:
            input.name,
          enabled:
            input.enabled,
          modelOverride:
            input.modelOverride ??
            null,
          reasoningOverride:
            input.reasoningOverride ??
            null,
          additionalPrompt:
            input.additionalPrompt,
        })
        .returning();

    return serializeAgent(
      agent,
      department,
    );
  } catch (error) {
    return translateDatabaseError(
      error,
    );
  }
}

/**
 * Updates agent configuration in place. Team placement is never modified
 * here; it is owned exclusively by the Team workflow resource.
 */
export async function updateAgent(
  id:
    string,
  input:
    UpdateAgent,
): Promise<
  Agent | null
> {
  try {
    if (
      input.departmentId !==
      undefined
    ) {
      await loadDepartmentOrThrow(
        input.departmentId,
      );
    }

    const patch = {
      ...(
        input.departmentId !==
        undefined
          ? {
              departmentId:
                input.departmentId,
            }
          : {}
      ),
      ...(
        input.slug !==
        undefined
          ? {
              slug:
                input.slug,
            }
          : {}
      ),
      ...(
        input.name !==
        undefined
          ? {
              name:
                input.name,
            }
          : {}
      ),
      ...(
        input.enabled !==
        undefined
          ? {
              enabled:
                input.enabled,
            }
          : {}
      ),
      ...(
        input.modelOverride !==
        undefined
          ? {
              modelOverride:
                input.modelOverride,
            }
          : {}
      ),
      ...(
        input.reasoningOverride !==
        undefined
          ? {
              reasoningOverride:
                input.reasoningOverride,
            }
          : {}
      ),
      ...(
        input.additionalPrompt !==
        undefined
          ? {
              additionalPrompt:
                input.additionalPrompt,
            }
          : {}
      ),
    };

    const [agent] =
      await db
        .update(agents)
        .set({
          ...patch,
          updatedAt:
            new Date(),
        })
        .where(
          eq(
            agents.id,
            id,
          ),
        )
        .returning();

    if (
      !agent
    ) {
      return null;
    }

    const department =
      await loadDepartmentOrThrow(
        agent.departmentId,
      );

    const [currentMember] =
      await db
        .select({
          teamId:
            teamMembers.teamId,
        })
        .from(teamMembers)
        .where(
          eq(
            teamMembers.agentId,
            agent.id,
          ),
        );

    return serializeAgent(
      agent,
      department,
      currentMember?.teamId ??
        null,
    );
  } catch (error) {
    return translateDatabaseError(
      error,
    );
  }
}

/**
 * Permanently deletes an agent only when no active workflow snapshot contains it.
 *
 * Historical workflow snapshots are never updated. Database foreign keys remove
 * Team membership/routes and null historical execution references.
 */
export async function deleteAgent(
  id:
    string,
): Promise<boolean> {
  try {
    return await db.transaction(
      async (
        tx,
      ) => {
        await tx.execute(
          sql`LOCK TABLE ${runs} IN SHARE MODE`,
        );

        const [existing] =
          await tx
            .select({
              id:
                agents.id,
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
          return false;
        }

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

        const [deleted] =
          await tx
            .delete(agents)
            .where(
              eq(
                agents.id,
                id,
              ),
            )
            .returning({
              id:
                agents.id,
            });

        return Boolean(
          deleted,
        );
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

  return rows.map(
    (row) =>
      serializeAgent(
        row.agents,
        row.departments,
        row.team_members?.teamId ??
          null,
      ),
  );
}
