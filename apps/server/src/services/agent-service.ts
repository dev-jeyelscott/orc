import { and, asc, eq, inArray, sql } from "drizzle-orm";

import type {
  Agent,
  AgentRoute,
  AgentWithRoutes,
  CreateAgent,
  CreateAgentRoute,
  UpdateAgent,
  UpdateAgentRoute,
} from "@orc/shared";

import { db } from "../db/client.js";
import { agents, agentRoutes, runs } from "../db/schema.js";

export class AgentServiceError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
  }
}

/**
 * Converts an agent database row into the shared API representation.
 */
function serializeAgent(row: typeof agents.$inferSelect): Agent {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Converts an agent route database row into the shared API representation.
 */
function serializeRoute(row: typeof agentRoutes.$inferSelect): AgentRoute {
  return {
    ...row,
    targetAgentId: row.targetAgentId ?? null,
    terminalAction: row.terminalAction ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Maps expected PostgreSQL constraint errors into stable service errors.
 */
function translateDatabaseError(error: unknown): never {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: string }).code;

    if (code === "23505") {
      throw new AgentServiceError(
        "An agent slug, layer/order, or route outcome already exists",
        409,
      );
    }

    if (code === "23503") {
      throw new AgentServiceError("The referenced agent does not exist", 400);
    }

    if (code === "23514") {
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
  snapshot: unknown,
  agentId: string,
): boolean {
  if (
    typeof snapshot !== "object" ||
    snapshot === null ||
    !("agents" in snapshot)
  ) {
    return false;
  }

  const snapshotAgents = (snapshot as { agents?: unknown }).agents;
  if (!Array.isArray(snapshotAgents)) return false;

  return snapshotAgents.some(
    (candidate) =>
      typeof candidate === "object" &&
      candidate !== null &&
      "id" in candidate &&
      candidate.id === agentId,
  );
}

/**
 * Ensures a route target exists and is currently available for new runs.
 */
async function assertAvailableTarget(targetAgentId: string | null) {
  if (!targetAgentId) return;

  const [target] = await db
    .select({ enabled: agents.enabled })
    .from(agents)
    .where(eq(agents.id, targetAgentId));

  if (!target) {
    throw new AgentServiceError("The target agent does not exist", 400);
  }

  if (!target.enabled) {
    throw new AgentServiceError(
      "Routes cannot target a disabled agent",
      400,
    );
  }
}

/**
 * Lists every configured agent using deterministic workflow ordering.
 */
export async function listAgents(): Promise<Agent[]> {
  return (
    await db
      .select()
      .from(agents)
      .orderBy(asc(agents.layer), asc(agents.executionOrder))
  ).map(serializeAgent);
}

/**
 * Returns one agent together with its configured routing records.
 */
export async function getAgent(id: string): Promise<AgentWithRoutes | null> {
  const [agent] = await db.select().from(agents).where(eq(agents.id, id));
  if (!agent) return null;

  const routes = await db
    .select()
    .from(agentRoutes)
    .where(eq(agentRoutes.sourceAgentId, id));

  return {
    ...serializeAgent(agent),
    routes: routes.map(serializeRoute),
  };
}

/**
 * Creates a new dynamic worker-agent configuration.
 */
export async function createAgent(input: CreateAgent): Promise<Agent> {
  try {
    const [agent] = await db.insert(agents).values(input).returning();
    return serializeAgent(agent);
  } catch (error) {
    return translateDatabaseError(error);
  }
}

/**
 * Updates agent configuration without mutating persisted route enabled states.
 */
export async function updateAgent(
  id: string,
  input: UpdateAgent,
): Promise<Agent | null> {
  try {
    const [agent] = await db
      .update(agents)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(agents.id, id))
      .returning();

    return agent ? serializeAgent(agent) : null;
  } catch (error) {
    return translateDatabaseError(error);
  }
}

/**
 * Permanently deletes an agent only when no active workflow snapshot contains it.
 *
 * A short SHARE lock prevents new or transitioning workflow rows from racing
 * the active-snapshot check. Historical workflow snapshots are never updated.
 * Database foreign keys remove routes and null historical execution references.
 */
export async function deleteAgent(id: string): Promise<boolean> {
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`LOCK TABLE ${runs} IN SHARE MODE`);

      const [existing] = await tx
        .select({ id: agents.id })
        .from(agents)
        .where(eq(agents.id, id));

      if (!existing) return false;

      const activeRuns = await tx
        .select({
          id: runs.id,
          workflowSnapshot: runs.workflowSnapshot,
        })
        .from(runs)
        .where(inArray(runs.status, ["pending", "running"]));

      const conflictingRun = activeRuns.find((run) =>
        workflowSnapshotContainsAgent(run.workflowSnapshot, id),
      );

      if (conflictingRun) {
        throw new AgentServiceError(
          `Agent cannot be deleted because active run ${conflictingRun.id} contains it in its workflow snapshot`,
          409,
        );
      }

      const [deleted] = await tx
        .delete(agents)
        .where(eq(agents.id, id))
        .returning({ id: agents.id });

      return Boolean(deleted);
    });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "23503"
    ) {
      throw new AgentServiceError(
        "Agent cannot be deleted because related data still references it",
        409,
      );
    }

    return translateDatabaseError(error);
  }
}

/**
 * Creates a route for an existing source agent.
 *
 * Source-agent enabled state is deliberately independent from route enabled
 * state so routes can remain configured while the source agent is disabled.
 */
export async function createAgentRoute(
  sourceAgentId: string,
  input: CreateAgentRoute,
): Promise<AgentRoute> {
  try {
    const [source] = await db
      .select({ id: agents.id })
      .from(agents)
      .where(eq(agents.id, sourceAgentId));

    if (!source) {
      throw new AgentServiceError("The source agent does not exist", 404);
    }

    await assertAvailableTarget(input.targetAgentId);

    const [route] = await db
      .insert(agentRoutes)
      .values({ ...input, sourceAgentId })
      .returning();

    return serializeRoute(route);
  } catch (error) {
    return translateDatabaseError(error);
  }
}

/**
 * Updates an existing route while preserving the exactly-one-destination rule.
 *
 * A route that currently points at an unavailable target may still be disabled,
 * but it cannot be enabled or saved as an active route until its target is
 * available again or the destination is changed.
 */
export async function updateAgentRoute(
  agentId: string,
  routeId: string,
  input: UpdateAgentRoute,
): Promise<AgentRoute | null> {
  try {
    const [existing] = await db
      .select()
      .from(agentRoutes)
      .where(
        and(
          eq(agentRoutes.id, routeId),
          eq(agentRoutes.sourceAgentId, agentId),
        ),
      );

    if (!existing) return null;

    const merged = { ...existing, ...input };

    if (
      (merged.targetAgentId === null) ===
      (merged.terminalAction === null)
    ) {
      throw new AgentServiceError(
        "Set exactly one target agent or terminal action",
        400,
      );
    }

    if (input.enabled !== false) {
      await assertAvailableTarget(merged.targetAgentId);
    }

    const [route] = await db
      .update(agentRoutes)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(agentRoutes.id, routeId))
      .returning();

    return serializeRoute(route);
  } catch (error) {
    return translateDatabaseError(error);
  }
}

/**
 * Removes one route owned by the requested source agent.
 */
export async function deleteAgentRoute(
  agentId: string,
  routeId: string,
): Promise<boolean> {
  const deleted = await db
    .delete(agentRoutes)
    .where(
      and(
        eq(agentRoutes.id, routeId),
        eq(agentRoutes.sourceAgentId, agentId),
      ),
    )
    .returning({ id: agentRoutes.id });

  return deleted.length > 0;
}

/**
 * Returns only agents eligible to participate in newly-created workflow runs.
 */
export async function listEnabledAgentsForFutureRuns(): Promise<Agent[]> {
  return (
    await db
      .select()
      .from(agents)
      .where(eq(agents.enabled, true))
      .orderBy(asc(agents.layer), asc(agents.executionOrder))
  ).map(serializeAgent);
}
