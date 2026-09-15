import { and, eq, inArray } from "drizzle-orm";

import type {
  AgentRouteOutcome,
  TerminalAction,
  WorkflowGraph,
  WorkflowGraphEdge,
  WorkflowGraphNode,
  WorkflowValidationIssue,
} from "@orc/shared";

import { db } from "../db/client.js";
import { agents, departments, teamMemberRoutes, teamMembers, teams } from "../db/schema.js";
import { orderWorkflowAgents } from "./workflow-service.js";
import { getOrCreateDraft, publishDraft, saveDraftGraph } from "./workflow-graph-service.js";

export type BackfillTeamResult =
  | { teamId: string; status: "converted"; publishedVersion: number }
  | { teamId: string; status: "skipped_no_agents" }
  | { teamId: string; status: "aborted"; errors: WorkflowValidationIssue[]; reason?: string };

export type BackfillSummary = {
  converted: Extract<BackfillTeamResult, { status: "converted" }>[];
  skipped: Extract<BackfillTeamResult, { status: "skipped_no_agents" }>[];
  aborted: Extract<BackfillTeamResult, { status: "aborted" }>[];
};

/**
 * Deterministically converts one Team's current `team_members`/
 * `team_member_routes` state into an equivalent Draft + Published v1
 * explicit-node graph, reproducing exactly what `resolveWorkflowTransition`
 * (in `workflow-service.ts`) currently computes for a legacy Run -- no
 * route is invented beyond what old runtime semantics would have applied.
 *
 * Precedence mirrors `resolveWorkflowTransition` exactly:
 *   1. an explicit `team_member_routes` row becomes an explicit edge
 *   2. `completed`/`approved` with no explicit route become the default
 *      next-executable-Agent edge (or Complete Run for the last Agent)
 *   3. `changes_requested`/`blocked`/`failed` with no explicit route are
 *      left unconfigured -- a `missing_outcome_edge` warning only, never a
 *      fabricated terminal edge, since that fallback existed at runtime
 *      only because the route was missing in the first place.
 */
export async function backfillTeamWorkflow(teamId: string): Promise<BackfillTeamResult> {
  const memberRows = await db
    .select()
    .from(teamMembers)
    .innerJoin(agents, eq(agents.id, teamMembers.agentId))
    .innerJoin(departments, eq(agents.departmentId, departments.id))
    .where(eq(teamMembers.teamId, teamId));

  const executableMembers = orderWorkflowAgents(
    memberRows
      .filter((row) => row.agents.enabled && row.departments.enabled)
      .map((row) => ({
        teamMemberId: row.team_members.id,
        agentId: row.agents.id,
        layer: row.team_members.layer,
        executionOrder: row.team_members.executionOrder,
      })),
  );

  if (executableMembers.length === 0) {
    return { teamId, status: "skipped_no_agents" };
  }

  const memberIds = memberRows.map((row) => row.team_members.id);
  const routeRows = memberIds.length
    ? await db
        .select()
        .from(teamMemberRoutes)
        .where(and(inArray(teamMemberRoutes.sourceTeamMemberId, memberIds), eq(teamMemberRoutes.enabled, true)))
    : [];

  const agentIdByMemberId = new Map(memberRows.map((row) => [row.team_members.id, row.agents.id]));

  const draft = await getOrCreateDraft(teamId);
  const start = draft.graph.nodes.find((node): node is Extract<WorkflowGraphNode, { kind: "start" }> => node.kind === "start")!;
  const terminalNodes = draft.graph.nodes.filter(
    (node): node is Extract<WorkflowGraphNode, { kind: "terminal" }> => node.kind === "terminal",
  );
  const terminalNodeByAction = new Map(terminalNodes.map((node) => [node.terminalAction, node]));
  const completeRun = terminalNodeByAction.get("complete_run")!;

  const agentNodes: Extract<WorkflowGraphNode, { kind: "agent" }>[] = executableMembers.map((member, index) => ({
    id: crypto.randomUUID(),
    kind: "agent",
    agentId: member.agentId,
    position: { x: 240 * (index + 1), y: 0 },
  }));
  const agentNodeByAgentId = new Map(agentNodes.map((node) => [node.agentId, node]));

  const edges: WorkflowGraphEdge[] = [
    { id: crypto.randomUUID(), sourceNodeId: start.id, targetNodeId: agentNodes[0].id, outcome: null },
  ];

  const explicitOutcomesByAgentId = new Map<string, Set<AgentRouteOutcome>>();

  for (const route of routeRows) {
    const sourceAgentId = agentIdByMemberId.get(route.sourceTeamMemberId);
    const sourceNode = sourceAgentId ? agentNodeByAgentId.get(sourceAgentId) : undefined;
    if (!sourceAgentId || !sourceNode) continue;

    let targetNode: WorkflowGraphNode | undefined;
    if (route.terminalAction) {
      targetNode = terminalNodeByAction.get(route.terminalAction as TerminalAction);
    } else if (route.targetTeamMemberId) {
      const targetAgentId = agentIdByMemberId.get(route.targetTeamMemberId);
      targetNode = targetAgentId ? agentNodeByAgentId.get(targetAgentId) : undefined;
    }

    // A route whose target is not itself executable/resolvable cannot be
    // reproduced as a real edge without inventing behavior -- leave it
    // unconfigured rather than guessing, exactly as instructed.
    if (!targetNode) continue;

    edges.push({ id: crypto.randomUUID(), sourceNodeId: sourceNode.id, targetNodeId: targetNode.id, outcome: route.outcome });

    const seen = explicitOutcomesByAgentId.get(sourceAgentId) ?? new Set<AgentRouteOutcome>();
    seen.add(route.outcome);
    explicitOutcomesByAgentId.set(sourceAgentId, seen);
  }

  for (let index = 0; index < agentNodes.length; index += 1) {
    const agentId = executableMembers[index].agentId;
    const explicitOutcomes = explicitOutcomesByAgentId.get(agentId) ?? new Set<AgentRouteOutcome>();

    for (const outcome of ["completed", "approved"] as const) {
      if (explicitOutcomes.has(outcome)) continue;

      const nextNode = agentNodes[index + 1] ?? completeRun;
      edges.push({ id: crypto.randomUUID(), sourceNodeId: agentNodes[index].id, targetNodeId: nextNode.id, outcome });
    }
  }

  const graph: WorkflowGraph = { nodes: [...draft.graph.nodes, ...agentNodes], edges };

  const saveResult = await saveDraftGraph(teamId, graph);

  if (!saveResult.validation.publishable) {
    return { teamId, status: "aborted", errors: saveResult.validation.errors };
  }

  const publishResult = await publishDraft(teamId);

  return { teamId, status: "converted", publishedVersion: publishResult.revision.version };
}

/**
 * Runs `backfillTeamWorkflow` for every Team, never letting one Team's
 * failure block the rest -- each Team's Draft save + publish is its own
 * pair of transactions, so one bad Team's conversion is fully isolated.
 */
export async function backfillAllTeams(): Promise<BackfillSummary> {
  const teamRows = await db.select({ id: teams.id }).from(teams);
  const results: BackfillTeamResult[] = [];

  for (const team of teamRows) {
    try {
      results.push(await backfillTeamWorkflow(team.id));
    } catch (error) {
      results.push({
        teamId: team.id,
        status: "aborted",
        errors: [],
        reason: error instanceof Error ? error.message : "Unknown backfill failure",
      });
    }
  }

  return {
    converted: results.filter((result): result is Extract<BackfillTeamResult, { status: "converted" }> => result.status === "converted"),
    skipped: results.filter((result): result is Extract<BackfillTeamResult, { status: "skipped_no_agents" }> => result.status === "skipped_no_agents"),
    aborted: results.filter((result): result is Extract<BackfillTeamResult, { status: "aborted" }> => result.status === "aborted"),
  };
}
