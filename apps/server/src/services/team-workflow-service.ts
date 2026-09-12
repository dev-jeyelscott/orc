import {
  and,
  asc,
  eq,
  inArray,
  ne,
  sql,
} from "drizzle-orm";

import type {
  AgentRouteOutcome,
  TeamWorkflow,
  TeamWorkflowInput,
} from "@orc/shared";

import {
  db,
} from "../db/client.js";
import {
  agents,
  departments,
  teamMemberRoutes,
  teamMembers,
  teams,
} from "../db/schema.js";
import {
  serializeAgent,
} from "./agent-service.js";

export class TeamWorkflowServiceError extends Error {
  /**
   * Creates a Team workflow service error carrying its HTTP status.
   */
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}

const EXCEPTIONAL_OUTCOMES: readonly AgentRouteOutcome[] = [
  "changes_requested",
  "blocked",
  "failed",
];

type Tx =
  Parameters<
    Parameters<typeof db.transaction>[0]
  >[0];

type DbClient = typeof db | Tx;

/**
 * Loads one Team's persisted workflow (members, resolved Agent/Department
 * configuration, and outbound routes) ordered by layer then execution order.
 */
async function loadTeamWorkflow(
  tx: DbClient,
  teamId: string,
): Promise<TeamWorkflow> {
  const memberRows =
    await tx
      .select()
      .from(teamMembers)
      .innerJoin(
        agents,
        eq(teamMembers.agentId, agents.id),
      )
      .innerJoin(
        departments,
        eq(agents.departmentId, departments.id),
      )
      .where(eq(teamMembers.teamId, teamId))
      .orderBy(
        asc(teamMembers.layer),
        asc(teamMembers.executionOrder),
      );

  const memberIds =
    memberRows.map((row) => row.team_members.id);

  const agentIdByMemberId =
    new Map(
      memberRows.map((row) => [
        row.team_members.id,
        row.team_members.agentId,
      ]),
    );

  const routeRows =
    memberIds.length
      ? await tx
          .select()
          .from(teamMemberRoutes)
          .where(
            inArray(
              teamMemberRoutes.sourceTeamMemberId,
              memberIds,
            ),
          )
      : [];

  const routesBySource =
    new Map<
      string,
      typeof routeRows
    >();

  for (const route of routeRows) {
    const existing =
      routesBySource.get(route.sourceTeamMemberId) ?? [];

    existing.push(route);
    routesBySource.set(route.sourceTeamMemberId, existing);
  }

  return {
    teamId,
    members: memberRows.map((row) => ({
      id: row.team_members.id,
      teamId: row.team_members.teamId,
      departmentId: row.team_members.departmentId,
      agentId: row.team_members.agentId,
      agent: serializeAgent(
        row.agents,
        row.departments,
        row.team_members.teamId,
      ),
      layer: row.team_members.layer,
      executionOrder: row.team_members.executionOrder,
      routes: (routesBySource.get(row.team_members.id) ?? []).map(
        (route) => ({
          id: route.id,
          sourceTeamMemberId: route.sourceTeamMemberId,
          outcome: route.outcome,
          targetTeamMemberId: route.targetTeamMemberId ?? null,
          targetAgentId:
            route.targetTeamMemberId
              ? (agentIdByMemberId.get(route.targetTeamMemberId) ?? null)
              : null,
          terminalAction: route.terminalAction ?? null,
        }),
      ),
    })),
  };
}

/**
 * Returns one Team's persisted workflow, or null when the Team does not exist.
 */
export async function getTeamWorkflow(
  teamId: string,
): Promise<TeamWorkflow | null> {
  const [team] =
    await db
      .select({ id: teams.id })
      .from(teams)
      .where(eq(teams.id, teamId));

  if (!team) {
    return null;
  }

  return loadTeamWorkflow(db, teamId);
}

/**
 * Atomically validates and replaces one Team's entire workflow (composition,
 * layer/order placement, and outcome routing) so a partial save can never
 * leave invalid composition or dangling routes.
 */
export async function replaceTeamWorkflow(
  teamId: string,
  input: TeamWorkflowInput,
): Promise<TeamWorkflow> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`LOCK TABLE ${teamMembers} IN SHARE ROW EXCLUSIVE MODE`,
    );

    await tx.execute(
      sql`LOCK TABLE ${teamMemberRoutes} IN SHARE ROW EXCLUSIVE MODE`,
    );

    const [team] =
      await tx
        .select({ id: teams.id })
        .from(teams)
        .where(eq(teams.id, teamId));

    if (!team) {
      throw new TeamWorkflowServiceError(
        "The selected Team does not exist",
        404,
      );
    }

    const agentIds = input.members.map((member) => member.agentId);
    const uniqueAgentIds = new Set(agentIds);

    if (uniqueAgentIds.size !== agentIds.length) {
      throw new TeamWorkflowServiceError(
        "An Agent can only appear once in a Team's workflow",
        400,
      );
    }

    const placements = new Set<string>();

    for (const member of input.members) {
      const placementKey = `${member.layer}:${member.executionOrder}`;

      if (placements.has(placementKey)) {
        throw new TeamWorkflowServiceError(
          `Layer ${member.layer}, execution order ${member.executionOrder} is assigned to more than one Agent`,
          400,
        );
      }

      placements.add(placementKey);
    }

    const agentRows =
      uniqueAgentIds.size
        ? await tx
            .select()
            .from(agents)
            .innerJoin(
              departments,
              eq(agents.departmentId, departments.id),
            )
            .where(inArray(agents.id, [...uniqueAgentIds]))
        : [];

    if (agentRows.length !== uniqueAgentIds.size) {
      throw new TeamWorkflowServiceError(
        "One or more selected Agents do not exist",
        400,
      );
    }

    const departmentIds = new Set<string>();

    for (const row of agentRows) {
      if (departmentIds.has(row.agents.departmentId)) {
        throw new TeamWorkflowServiceError(
          "A Team may only select one Agent from each Department",
          400,
        );
      }

      departmentIds.add(row.agents.departmentId);
    }

    const existingMemberships =
      uniqueAgentIds.size
        ? await tx
            .select({
              agentId: teamMembers.agentId,
              teamId: teamMembers.teamId,
            })
            .from(teamMembers)
            .where(
              and(
                inArray(teamMembers.agentId, [...uniqueAgentIds]),
                ne(teamMembers.teamId, teamId),
              ),
            )
        : [];

    if (existingMemberships.length) {
      throw new TeamWorkflowServiceError(
        "One or more selected Agents already belong to another Team",
        409,
      );
    }

    for (const member of input.members) {
      const outcomes = new Set<string>();

      for (const route of member.routes) {
        if (outcomes.has(route.outcome)) {
          throw new TeamWorkflowServiceError(
            `Agent ${member.agentId} has more than one route configured for outcome ${route.outcome}`,
            400,
          );
        }

        outcomes.add(route.outcome);

        if (
          route.targetAgentId &&
          !uniqueAgentIds.has(route.targetAgentId)
        ) {
          throw new TeamWorkflowServiceError(
            "A route target must be a selected member of the same Team",
            400,
          );
        }
      }

      const missingExceptionalOutcomes = EXCEPTIONAL_OUTCOMES.filter(
        (outcome) => !outcomes.has(outcome),
      );

      if (missingExceptionalOutcomes.length) {
        throw new TeamWorkflowServiceError(
          `Agent ${member.agentId} is missing an explicit route for: ${missingExceptionalOutcomes.join(", ")}`,
          400,
        );
      }
    }

    const existingMemberIds = (
      await tx
        .select({ id: teamMembers.id })
        .from(teamMembers)
        .where(eq(teamMembers.teamId, teamId))
    ).map((row) => row.id);

    if (existingMemberIds.length) {
      await tx
        .delete(teamMemberRoutes)
        .where(
          inArray(
            teamMemberRoutes.sourceTeamMemberId,
            existingMemberIds,
          ),
        );

      await tx
        .delete(teamMembers)
        .where(eq(teamMembers.teamId, teamId));
    }

    const memberIdByAgentId = new Map<string, string>();

    for (const member of input.members) {
      const agentRow = agentRows.find(
        (row) => row.agents.id === member.agentId,
      );

      if (!agentRow) {
        throw new TeamWorkflowServiceError(
          "One or more selected Agents do not exist",
          400,
        );
      }

      const [inserted] =
        await tx
          .insert(teamMembers)
          .values({
            teamId,
            departmentId: agentRow.agents.departmentId,
            agentId: member.agentId,
            layer: member.layer,
            executionOrder: member.executionOrder,
          })
          .returning({ id: teamMembers.id });

      memberIdByAgentId.set(member.agentId, inserted.id);
    }

    const routeValues: Array<typeof teamMemberRoutes.$inferInsert> = [];

    for (const member of input.members) {
      const sourceTeamMemberId = memberIdByAgentId.get(member.agentId);

      if (!sourceTeamMemberId) {
        continue;
      }

      for (const route of member.routes) {
        routeValues.push({
          sourceTeamMemberId,
          outcome: route.outcome,
          targetTeamMemberId: route.targetAgentId
            ? (memberIdByAgentId.get(route.targetAgentId) ?? null)
            : null,
          terminalAction: route.terminalAction ?? null,
        });
      }
    }

    if (routeValues.length) {
      await tx.insert(teamMemberRoutes).values(routeValues);
    }

    return loadTeamWorkflow(tx, teamId);
  });
}
