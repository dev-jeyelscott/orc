import { and, eq, inArray, ne, sql } from "drizzle-orm";

import type { TeamMembership } from "@orc/shared";

import { db } from "../db/client.js";
import { agents, departments, teamMembers, teams } from "../db/schema.js";
import { serializeAgent } from "./agent-service.js";

export class TeamMembershipServiceError extends Error {
  /**
   * Creates a Team membership service error carrying its HTTP status.
   */
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}

type Tx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export type ExecutableTeamAgent = {
  agentId: string;
  agent: typeof agents.$inferSelect;
  department: typeof departments.$inferSelect;
};

/**
 * Resolves a Team's currently executable Agents -- enabled Agent AND
 * enabled Department -- using the same effective-enabled semantics the
 * runtime already applies in `workflow-service.ts`'s
 * `loadTeamWorkflowTopology`. Shared here so graph validation/publish,
 * the legacy runtime, and (once Slice 3 lands) the membership API never
 * re-derive this join independently.
 */
export async function resolveExecutableTeamAgents(
  tx: Tx,
  teamId: string,
): Promise<ExecutableTeamAgent[]> {
  const rows = await tx
    .select()
    .from(teamMembers)
    .innerJoin(agents, eq(agents.id, teamMembers.agentId))
    .innerJoin(departments, eq(agents.departmentId, departments.id))
    .where(eq(teamMembers.teamId, teamId));

  return rows
    .filter((row) => row.agents.enabled && row.departments.enabled)
    .map((row) => ({
      agentId: row.agents.id,
      agent: row.agents,
      department: row.departments,
    }));
}

/**
 * Resolves every Agent (enabled or not) currently belonging to a Team, for
 * callers -- like publish validation's "Agent is not a member of the Team"
 * check -- that must distinguish "not a member" from "member but disabled".
 */
export async function resolveTeamMemberAgentIds(
  tx: Tx,
  teamId: string,
): Promise<Set<string>> {
  const rows = await tx
    .select({ agentId: teamMembers.agentId })
    .from(teamMembers)
    .where(eq(teamMembers.teamId, teamId));

  return new Set(rows.map((row) => row.agentId));
}

async function loadTeamMembership(tx: Tx, teamId: string): Promise<TeamMembership> {
  const rows = await tx
    .select()
    .from(teamMembers)
    .innerJoin(agents, eq(agents.id, teamMembers.agentId))
    .innerJoin(departments, eq(agents.departmentId, departments.id))
    .where(eq(teamMembers.teamId, teamId));

  return {
    teamId,
    members: rows.map((row) => ({
      agentId: row.agents.id,
      agent: serializeAgent(row.agents, row.departments, teamId),
    })),
  };
}

/** Returns one Team's membership (Agent IDs only), or null if the Team does not exist. */
export async function getTeamMembers(teamId: string): Promise<TeamMembership | null> {
  const [team] = await db.select({ id: teams.id }).from(teams).where(eq(teams.id, teamId));

  if (!team) {
    return null;
  }

  return loadTeamMembership(db, teamId);
}

/**
 * Atomically replaces one Team's composition -- Agent IDs only. Never
 * touches `workflow_nodes`/`workflow_edges`: membership and workflow
 * topology are deliberately independent, and a membership change never
 * auto-adds or auto-removes a graph node. Reimplements only the
 * composition invariants of the legacy `replaceTeamWorkflow` (agent
 * exclusivity across Teams, one Agent per Department, existence), with no
 * layer/executionOrder/route handling. `team_members.layer`/
 * `execution_order` stay `NOT NULL` until the legacy cleanup slice, so
 * this assigns synthetic monotonic placeholder values that become dead as
 * soon as the graph runtime cutover lands.
 */
export async function replaceTeamMembers(
  teamId: string,
  agentIds: readonly string[],
): Promise<TeamMembership> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`LOCK TABLE ${teamMembers} IN SHARE ROW EXCLUSIVE MODE`);

    const [team] = await tx.select({ id: teams.id }).from(teams).where(eq(teams.id, teamId));

    if (!team) {
      throw new TeamMembershipServiceError("The selected Team does not exist", 404);
    }

    const uniqueAgentIds = new Set(agentIds);

    if (uniqueAgentIds.size !== agentIds.length) {
      throw new TeamMembershipServiceError("An Agent can only appear once in a Team", 400);
    }

    const agentRows = uniqueAgentIds.size
      ? await tx
          .select()
          .from(agents)
          .innerJoin(departments, eq(agents.departmentId, departments.id))
          .where(inArray(agents.id, [...uniqueAgentIds]))
      : [];

    if (agentRows.length !== uniqueAgentIds.size) {
      throw new TeamMembershipServiceError("One or more selected Agents do not exist", 400);
    }

    const departmentIds = new Set<string>();
    for (const row of agentRows) {
      if (departmentIds.has(row.agents.departmentId)) {
        throw new TeamMembershipServiceError("A Team may only select one Agent from each Department", 400);
      }
      departmentIds.add(row.agents.departmentId);
    }

    const existingMemberships = uniqueAgentIds.size
      ? await tx
          .select({ agentId: teamMembers.agentId })
          .from(teamMembers)
          .where(and(inArray(teamMembers.agentId, [...uniqueAgentIds]), ne(teamMembers.teamId, teamId)))
      : [];

    if (existingMemberships.length) {
      throw new TeamMembershipServiceError("One or more selected Agents already belong to another Team", 409);
    }

    // Diff against existing rows rather than delete-and-reinsert everything:
    // `team_member_routes` cascades off `team_members.id`, and the legacy
    // Workflow tab (still live until Slice 7) depends on routes surviving a
    // membership save for Agents that remain on the Team.
    const existingRows = await tx.select().from(teamMembers).where(eq(teamMembers.teamId, teamId));
    const existingAgentIds = new Set(existingRows.map((row) => row.agentId));
    const remainingRows = existingRows.filter((row) => uniqueAgentIds.has(row.agentId));
    const rowsToRemove = existingRows.filter((row) => !uniqueAgentIds.has(row.agentId));
    const rowsToAdd = agentRows.filter((row) => !existingAgentIds.has(row.agents.id));

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
          departmentId: row.agents.departmentId,
          agentId: row.agents.id,
          layer: maxLayer + index + 1,
          executionOrder: 1,
        })),
      );
    }

    return loadTeamMembership(tx, teamId);
  });
}
