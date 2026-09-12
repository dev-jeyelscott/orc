import {
  and,
  asc,
  eq,
  inArray,
  ne,
  or,
  sql,
} from "drizzle-orm";

import type {
  Agent,
  AgentRoute,
  AgentWithRoutes,
  CreateAgent,
  CreateAgentRoute,
  Department,
  UpdateAgent,
  UpdateAgentRoute,
} from "@orc/shared";

import {
  db,
} from "../db/client.js";
import {
  agents,
  agentRoutes,
  departments,
  runs,
  teamMembers,
  teams,
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
 * API representation, including the resolved effective runtime configuration.
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
    teamId:
      row.teamId,
    slug:
      row.slug,
    name:
      row.name,
    layer:
      row.layer,
    executionOrder:
      row.executionOrder,
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
 * Converts an agent route database row into the shared API representation.
 */
function serializeRoute(
  row:
    typeof agentRoutes.$inferSelect,
): AgentRoute {
  return {
    ...row,
    targetAgentId:
      row.targetAgentId ??
      null,
    terminalAction:
      row.terminalAction ??
      null,
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
        "An agent slug, Team layer/order slot, or route outcome already exists",
        409,
      );
    }

    if (
      code ===
      "23503"
    ) {
      throw new AgentServiceError(
        "The referenced Team, Department, or agent does not exist",
        400,
      );
    }

    if (
      code ===
      "23514"
    ) {
      throw new AgentServiceError(
        "The agent or route configuration is invalid",
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
 * Ensures a Team exists before an Agent is assigned to it.
 */
async function assertTeamExists(
  teamId:
    string,
) {
  const [team] =
    await db
      .select({
        id:
          teams.id,
      })
      .from(teams)
      .where(
        eq(
          teams.id,
          teamId,
        ),
      );

  if (
    !team
  ) {
    throw new AgentServiceError(
      "The selected Team does not exist",
      400,
    );
  }
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
 * Lists every configured agent using deterministic Team and workflow ordering.
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
          agents.teamId,
        ),
        asc(
          agents.layer,
        ),
        asc(
          agents.executionOrder,
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
 * Returns one agent together with its configured routing records.
 */
export async function getAgent(
  id:
    string,
): Promise<
  AgentWithRoutes | null
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

  const routes =
    await db
      .select()
      .from(
        agentRoutes,
      )
      .where(
        eq(
          agentRoutes.sourceAgentId,
          id,
        ),
      );

  return {
    ...serializeAgent(
      row.agents,
      row.departments,
      row.team_members?.teamId ??
        null,
    ),
    routes:
      routes.map(
        serializeRoute,
      ),
  };
}

/**
 * Creates a new dynamic worker-agent configuration inside an existing Team,
 * inheriting its reusable runtime defaults from the selected Department.
 */
export async function createAgent(
  input:
    CreateAgent,
): Promise<Agent> {
  try {
    await assertTeamExists(
      input.teamId,
    );

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
          teamId:
            input.teamId,
          slug:
            input.slug,
          name:
            input.name,
          layer:
            input.layer,
          executionOrder:
            input.executionOrder,
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
 * Updates agent configuration and validates routing before Team reassignment or target deactivation.
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
        input.teamId !==
        undefined
          ? {
              teamId:
                input.teamId,
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
        input.layer !==
        undefined
          ? {
              layer:
                input.layer,
            }
          : {}
      ),
      ...(
        input.executionOrder !==
        undefined
          ? {
              executionOrder:
                input.executionOrder,
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

    const requiresRouteValidation =
      input.teamId !==
        undefined ||
      input.enabled ===
        false;

    if (
      !requiresRouteValidation
    ) {
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
    }

    return await db.transaction(
      async (
        tx,
      ) => {
        await tx.execute(
          sql`LOCK TABLE ${agents} IN SHARE ROW EXCLUSIVE MODE`,
        );

        await tx.execute(
          sql`LOCK TABLE ${agentRoutes} IN SHARE ROW EXCLUSIVE MODE`,
        );

        const [existing] =
          await tx
            .select()
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

        const destinationTeamId =
          input.teamId ??
          existing.teamId;

        const destinationLayer =
          input.layer ??
          existing.layer;

        const destinationExecutionOrder =
          input.executionOrder ??
          existing.executionOrder;

        const [destinationTeam] =
          await tx
            .select({
              id:
                teams.id,
            })
            .from(teams)
            .where(
              eq(
                teams.id,
                destinationTeamId,
              ),
            );

        if (
          !destinationTeam
        ) {
          throw new AgentServiceError(
            "The destination Team does not exist",
            400,
          );
        }

        const [slotConflict] =
          destinationLayer !== null &&
          destinationExecutionOrder !== null
            ? await tx
                .select({
                  id:
                    agents.id,
                })
                .from(agents)
                .where(
                  and(
                    eq(
                      agents.teamId,
                      destinationTeamId,
                    ),
                    eq(
                      agents.layer,
                      destinationLayer,
                    ),
                    eq(
                      agents.executionOrder,
                      destinationExecutionOrder,
                    ),
                    ne(
                      agents.id,
                      id,
                    ),
                  ),
                )
                .limit(1)
            : [];

        if (
          slotConflict
        ) {
          throw new AgentServiceError(
            `The destination Team already has an agent in layer ${destinationLayer}, execution order ${destinationExecutionOrder}`,
            409,
          );
        }

        if (
          input.enabled ===
            false &&
          existing.enabled
        ) {
          const [enabledIncomingRoute] =
            await tx
              .select({
                id:
                  agentRoutes.id,
              })
              .from(
                agentRoutes,
              )
              .where(
                and(
                  eq(
                    agentRoutes.targetAgentId,
                    id,
                  ),
                  eq(
                    agentRoutes.enabled,
                    true,
                  ),
                ),
              )
              .limit(1);

          if (
            enabledIncomingRoute
          ) {
            throw new AgentServiceError(
              "Disable incoming enabled routes before disabling this target agent",
              409,
            );
          }
        }

        if (
          destinationTeamId !==
          existing.teamId
        ) {
          const relatedRoutes =
            await tx
              .select()
              .from(
                agentRoutes,
              )
              .where(
                or(
                  eq(
                    agentRoutes.sourceAgentId,
                    id,
                  ),
                  eq(
                    agentRoutes.targetAgentId,
                    id,
                  ),
                ),
              );

          const relatedAgentIds =
            new Set<string>();

          for (
            const route of
            relatedRoutes
          ) {
            if (
              route.sourceAgentId ===
                id &&
              route.targetAgentId
            ) {
              relatedAgentIds.add(
                route.targetAgentId,
              );
            }

            if (
              route.targetAgentId ===
              id
            ) {
              relatedAgentIds.add(
                route.sourceAgentId,
              );
            }
          }

          const relatedAgents =
            relatedAgentIds.size >
            0
              ? await tx
                  .select({
                    id:
                      agents.id,
                    teamId:
                      agents.teamId,
                  })
                  .from(
                    agents,
                  )
                  .where(
                    inArray(
                      agents.id,
                      [
                        ...relatedAgentIds,
                      ],
                    ),
                  )
              : [];

          const teamByAgentId =
            new Map(
              relatedAgents.map(
                (
                  agent,
                ) => [
                  agent.id,
                  agent.teamId,
                ],
              ),
            );

          const incompatibleRoute =
            relatedRoutes.find(
              (
                route,
              ) => {
                if (
                  route.sourceAgentId ===
                    id &&
                  route.targetAgentId
                ) {
                  return (
                    teamByAgentId.get(
                      route.targetAgentId,
                    ) !==
                    destinationTeamId
                  );
                }

                if (
                  route.targetAgentId ===
                  id
                ) {
                  return (
                    teamByAgentId.get(
                      route.sourceAgentId,
                    ) !==
                    destinationTeamId
                  );
                }

                return false;
              },
            );

          if (
            incompatibleRoute
          ) {
            throw new AgentServiceError(
              "Agent cannot move Teams because an incoming or outgoing route would become cross-Team",
              409,
            );
          }
        }

        const [agent] =
          await tx
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

        const [departmentRow] =
          await tx
            .select()
            .from(departments)
            .where(
              eq(
                departments.id,
                agent.departmentId,
              ),
            );

        if (
          !departmentRow
        ) {
          throw new AgentServiceError(
            "The selected Department does not exist",
            400,
          );
        }

        const [currentMember] =
          await tx
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
          departmentRow,
          currentMember?.teamId ??
            null,
        );
      },
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
 * routes and null historical execution references.
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
 * Creates an explicit outcome route while enforcing Team and enabled-target invariants.
 */
export async function createAgentRoute(
  sourceAgentId:
    string,
  input:
    CreateAgentRoute,
): Promise<AgentRoute> {
  try {
    return await db.transaction(
      async (
        tx,
      ) => {
        await tx.execute(
          sql`LOCK TABLE ${agents} IN SHARE ROW EXCLUSIVE MODE`,
        );

        await tx.execute(
          sql`LOCK TABLE ${agentRoutes} IN SHARE ROW EXCLUSIVE MODE`,
        );

        const [source] =
          await tx
            .select({
              id:
                agents.id,
              teamId:
                agents.teamId,
            })
            .from(agents)
            .where(
              eq(
                agents.id,
                sourceAgentId,
              ),
            );

        if (
          !source
        ) {
          throw new AgentServiceError(
            "The source agent does not exist",
            404,
          );
        }

        if (
          input.targetAgentId
        ) {
          const [target] =
            await tx
              .select({
                id:
                  agents.id,
                teamId:
                  agents.teamId,
                enabled:
                  agents.enabled,
              })
              .from(agents)
              .where(
                eq(
                  agents.id,
                  input.targetAgentId,
                ),
              );

          if (
            !target
          ) {
            throw new AgentServiceError(
              "The target agent does not exist",
              400,
            );
          }

          if (
            target.teamId !==
            source.teamId
          ) {
            throw new AgentServiceError(
              "Routes cannot target an agent in another Team",
              400,
            );
          }

          if (
            input.enabled &&
            !target.enabled
          ) {
            throw new AgentServiceError(
              "Enabled routes cannot target a disabled agent",
              400,
            );
          }
        }

        const [route] =
          await tx
            .insert(
              agentRoutes,
            )
            .values({
              ...input,
              sourceAgentId,
            })
            .returning();

        return serializeRoute(
          route,
        );
      },
    );
  } catch (error) {
    return translateDatabaseError(
      error,
    );
  }
}

/**
 * Updates an existing route while preserving destination, Team, and enabled-target rules.
 */
export async function updateAgentRoute(
  agentId:
    string,
  routeId:
    string,
  input:
    UpdateAgentRoute,
): Promise<
  AgentRoute | null
> {
  try {
    return await db.transaction(
      async (
        tx,
      ) => {
        await tx.execute(
          sql`LOCK TABLE ${agents} IN SHARE ROW EXCLUSIVE MODE`,
        );

        await tx.execute(
          sql`LOCK TABLE ${agentRoutes} IN SHARE ROW EXCLUSIVE MODE`,
        );

        const [existing] =
          await tx
            .select()
            .from(
              agentRoutes,
            )
            .where(
              and(
                eq(
                  agentRoutes.id,
                  routeId,
                ),
                eq(
                  agentRoutes.sourceAgentId,
                  agentId,
                ),
              ),
            );

        if (
          !existing
        ) {
          return null;
        }

        const merged = {
          ...existing,
          ...input,
        };

        if (
          (
            merged.targetAgentId ===
            null
          ) ===
          (
            merged.terminalAction ===
            null
          )
        ) {
          throw new AgentServiceError(
            "Set exactly one target agent or terminal action",
            400,
          );
        }

        const [source] =
          await tx
            .select({
              teamId:
                agents.teamId,
            })
            .from(agents)
            .where(
              eq(
                agents.id,
                agentId,
              ),
            );

        if (
          !source
        ) {
          throw new AgentServiceError(
            "The source agent does not exist",
            404,
          );
        }

        if (
          merged.targetAgentId
        ) {
          const [target] =
            await tx
              .select({
                teamId:
                  agents.teamId,
                enabled:
                  agents.enabled,
              })
              .from(agents)
              .where(
                eq(
                  agents.id,
                  merged.targetAgentId,
                ),
              );

          if (
            !target
          ) {
            throw new AgentServiceError(
              "The target agent does not exist",
              400,
            );
          }

          if (
            target.teamId !==
            source.teamId
          ) {
            throw new AgentServiceError(
              "Routes cannot target an agent in another Team",
              400,
            );
          }

          if (
            merged.enabled &&
            !target.enabled
          ) {
            throw new AgentServiceError(
              "Enabled routes cannot target a disabled agent",
              400,
            );
          }
        }

        const [route] =
          await tx
            .update(
              agentRoutes,
            )
            .set({
              ...input,
              updatedAt:
                new Date(),
            })
            .where(
              eq(
                agentRoutes.id,
                routeId,
              ),
            )
            .returning();

        return route
          ? serializeRoute(
              route,
            )
          : null;
      },
    );
  } catch (error) {
    return translateDatabaseError(
      error,
    );
  }
}

/**
 * Removes one route owned by the requested source agent.
 */
export async function deleteAgentRoute(
  agentId:
    string,
  routeId:
    string,
): Promise<boolean> {
  const deleted =
    await db
      .delete(
        agentRoutes,
      )
      .where(
        and(
          eq(
            agentRoutes.id,
            routeId,
          ),
          eq(
            agentRoutes.sourceAgentId,
            agentId,
          ),
        ),
      )
      .returning({
        id:
          agentRoutes.id,
      });

  return (
    deleted.length >
    0
  );
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
          agents.teamId,
        ),
        asc(
          agents.layer,
        ),
        asc(
          agents.executionOrder,
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
