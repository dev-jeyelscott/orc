import { and, desc, eq, sql } from "drizzle-orm";

import type {
  AgentRouteOutcome,
  PublishWorkflowResponse,
  TerminalAction,
  WorkflowAggregate,
  WorkflowDraft,
  WorkflowGraph,
  WorkflowGraphEdge,
  WorkflowGraphNode,
  WorkflowPublishedRevision,
  WorkflowPublishedRevisionSummary,
  WorkflowValidationIssue,
  WorkflowValidationResult,
} from "@orc/shared";

import { db } from "../db/client.js";
import { teams, workflowEdges, workflowNodes, workflowRevisions } from "../db/schema.js";
import {
  resolveExecutableTeamAgents,
  resolveTeamMemberAgentIds,
} from "./team-membership.js";

export class WorkflowGraphServiceError extends Error {
  /**
   * Creates a workflow graph service error carrying its HTTP status and,
   * for publish rejections, the full structured validation result so
   * callers can render blocking issues rather than only a message string.
   */
  constructor(
    message: string,
    readonly statusCode: number,
    readonly validation?: WorkflowValidationResult,
  ) {
    super(message);
  }
}

type Tx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

const FIXED_OUTCOMES: readonly AgentRouteOutcome[] = [
  "completed",
  "approved",
  "changes_requested",
  "blocked",
  "failed",
];

function terminalLabel(action: TerminalAction): string {
  switch (action) {
    case "complete_run":
      return "Complete Run";
    case "block_run":
      return "Block Run";
    case "fail_run":
      return "Fail Run";
  }
}

function nodeRowToGraphNode(row: typeof workflowNodes.$inferSelect): WorkflowGraphNode {
  const position = { x: row.positionX, y: row.positionY };
  if (row.kind === "start") {
    return { id: row.id, kind: "start", position };
  }
  if (row.kind === "agent") {
    return { id: row.id, kind: "agent", agentId: row.agentId as string, position };
  }
  return { id: row.id, kind: "terminal", terminalAction: row.terminalAction as TerminalAction, position };
}

function edgeRowToGraphEdge(row: typeof workflowEdges.$inferSelect): WorkflowGraphEdge {
  return {
    id: row.id,
    sourceNodeId: row.sourceNodeId,
    targetNodeId: row.targetNodeId,
    outcome: row.outcome ?? null,
  };
}

async function loadGraph(tx: Tx, revisionId: string): Promise<WorkflowGraph> {
  const [nodeRows, edgeRows] = await Promise.all([
    tx.select().from(workflowNodes).where(eq(workflowNodes.revisionId, revisionId)),
    tx.select().from(workflowEdges).where(eq(workflowEdges.revisionId, revisionId)),
  ]);

  return {
    nodes: nodeRows.map(nodeRowToGraphNode),
    edges: edgeRows.map(edgeRowToGraphEdge),
  };
}

/**
 * Inserts the four non-deletable system nodes (Start + 3 terminals) that
 * every new Draft revision starts with, at fixed default positions the
 * builder UI can freely reposition afterward.
 */
async function seedSystemNodes(tx: Tx, revisionId: string) {
  await tx.insert(workflowNodes).values([
    { revisionId, kind: "start", positionX: 0, positionY: 0 },
    { revisionId, kind: "terminal", terminalAction: "fail_run", positionX: -200, positionY: 400 },
    { revisionId, kind: "terminal", terminalAction: "complete_run", positionX: 0, positionY: 400 },
    { revisionId, kind: "terminal", terminalAction: "block_run", positionX: 200, positionY: 400 },
  ]);
}

async function getOrCreateDraftRow(tx: Tx, teamId: string) {
  const [team] = await tx.select({ id: teams.id }).from(teams).where(eq(teams.id, teamId));

  if (!team) {
    throw new WorkflowGraphServiceError("The selected Team does not exist", 404);
  }

  let [draftRow] = await tx
    .select()
    .from(workflowRevisions)
    .where(and(eq(workflowRevisions.teamId, teamId), eq(workflowRevisions.state, "draft")));

  if (!draftRow) {
    [draftRow] = await tx.insert(workflowRevisions).values({ teamId, state: "draft" }).returning();
    await seedSystemNodes(tx, draftRow.id);
  }

  return draftRow;
}

function publishedRevisionSummary(
  row: typeof workflowRevisions.$inferSelect,
  nodeCount: number,
  edgeCount: number,
): WorkflowPublishedRevisionSummary {
  return {
    id: row.id,
    teamId: row.teamId,
    version: row.version as number,
    publishedAt: (row.publishedAt as Date).toISOString(),
    nodeCount,
    edgeCount,
  };
}

/**
 * Rejects a submitted Draft payload that is malformed at the cross-node
 * level -- duplicate node ids, or an edge referencing a node absent from
 * the same request -- per roadmap section 14's "still rejected on save"
 * list. Per-field structural validation (uuids, bounds, kinds, outcomes)
 * is already enforced by the shared Zod schema before this runs.
 */
function assertStructurallySafeDraft(graph: WorkflowGraph) {
  const nodeIds = new Set<string>();
  const agentIds = new Set<string>();
  const terminalActions = new Set<TerminalAction>();

  for (const node of graph.nodes) {
    if (nodeIds.has(node.id)) {
      throw new WorkflowGraphServiceError(`Duplicate node id in submitted Draft: ${node.id}`, 400);
    }
    nodeIds.add(node.id);

    // The database enforces at most one node per Agent/terminal action per
    // revision; reject duplicates here with a clean 400 instead of letting
    // a raw constraint-violation error surface from the insert below.
    if (node.kind === "agent") {
      if (agentIds.has(node.agentId)) {
        throw new WorkflowGraphServiceError(
          `Agent ${node.agentId} appears more than once in the submitted Draft`,
          400,
        );
      }
      agentIds.add(node.agentId);
    } else if (node.kind === "terminal") {
      if (terminalActions.has(node.terminalAction)) {
        throw new WorkflowGraphServiceError(
          `Terminal action ${node.terminalAction} appears more than once in the submitted Draft`,
          400,
        );
      }
      terminalActions.add(node.terminalAction);
    }
  }

  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.sourceNodeId) || !nodeIds.has(edge.targetNodeId)) {
      throw new WorkflowGraphServiceError(
        `Edge ${edge.id} references a node not present in the submitted Draft`,
        400,
      );
    }
  }
}

/**
 * Depth-first cycle detection over Agent-node outgoing edges. Cycles are
 * valid graph topology (loops/backward routes) and never block publish --
 * this only feeds the non-blocking `workflow_advisory` warning.
 */
function hasCycle(nodeIds: readonly string[], edgesBySource: Map<string, WorkflowGraphEdge[]>): boolean {
  const state = new Map<string, "visiting" | "done">();

  function visit(id: string): boolean {
    const status = state.get(id);
    if (status === "visiting") return true;
    if (status === "done") return false;

    state.set(id, "visiting");
    for (const edge of edgesBySource.get(id) ?? []) {
      if (visit(edge.targetNodeId)) return true;
    }
    state.set(id, "done");
    return false;
  }

  return nodeIds.some((id) => visit(id));
}

export type WorkflowGraphValidationContext = {
  /** Every Agent currently assigned to the Team, enabled or not. */
  memberAgentIds: Set<string>;
  /** Team Agents that are currently runnable: enabled Agent AND enabled Department. */
  executableAgentIds: Set<string>;
};

/**
 * Pure, DB-free implementation of every publish rule in roadmap section 7,
 * mapped 1:1 onto the issue codes exported from `@orc/shared`. Used both
 * by Draft save (to report readiness) and by Publish (to gate it).
 */
export function validateGraph(
  graph: WorkflowGraph,
  context: WorkflowGraphValidationContext,
): WorkflowValidationResult {
  const errors: WorkflowValidationIssue[] = [];
  const warnings: WorkflowValidationIssue[] = [];

  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const startNodes = graph.nodes.filter((node) => node.kind === "start");
  const agentNodes = graph.nodes.filter(
    (node): node is Extract<WorkflowGraphNode, { kind: "agent" }> => node.kind === "agent",
  );
  const terminalNodes = graph.nodes.filter(
    (node): node is Extract<WorkflowGraphNode, { kind: "terminal" }> => node.kind === "terminal",
  );

  const edgesBySource = new Map<string, WorkflowGraphEdge[]>();
  for (const edge of graph.edges) {
    const list = edgesBySource.get(edge.sourceNodeId) ?? [];
    list.push(edge);
    edgesBySource.set(edge.sourceNodeId, list);
  }

  // Rule 6 (defense-in-depth): an edge referencing a node outside this graph.
  for (const edge of graph.edges) {
    if (!nodesById.has(edge.sourceNodeId) || !nodesById.has(edge.targetNodeId)) {
      errors.push({
        severity: "error",
        code: "cross_revision_edge",
        message: "This connection references a node outside the current workflow.",
        edgeId: edge.id,
      });
    }
  }

  // Rule 1: Start missing or duplicated.
  if (startNodes.length === 0) {
    errors.push({ severity: "error", code: "missing_start", message: "The workflow has no Start node." });
  } else if (startNodes.length > 1) {
    errors.push({
      severity: "error",
      code: "missing_start",
      message: "The workflow has more than one Start node.",
    });
  }

  const start = startNodes[0];

  if (start) {
    const startEdges = edgesBySource.get(start.id) ?? [];

    // Rules 2/3: Start must have exactly one outgoing edge, targeting an Agent.
    if (startEdges.length !== 1) {
      errors.push({
        severity: "error",
        code: "invalid_start_edge",
        message: "Start must have exactly one outgoing connection.",
        nodeId: start.id,
      });
    } else {
      const [startEdge] = startEdges;

      // Rule 15: Start's edge must not carry an outcome.
      if (startEdge.outcome !== null) {
        errors.push({
          severity: "error",
          code: "invalid_start_edge",
          message: "The Start connection must not carry an outcome.",
          edgeId: startEdge.id,
        });
      }

      const target = nodesById.get(startEdge.targetNodeId);
      if (!target || target.kind !== "agent") {
        errors.push({
          severity: "error",
          code: "invalid_start_edge",
          message: "Start must connect to an Agent node.",
          edgeId: startEdge.id,
        });
      }
    }
  }

  // Rule 4: no edge may target Start.
  if (start) {
    for (const edge of graph.edges) {
      if (edge.targetNodeId === start.id) {
        errors.push({
          severity: "error",
          code: "invalid_start_edge",
          message: "No connection may target the Start node.",
          edgeId: edge.id,
        });
      }
    }
  }

  // Rule 5: terminal nodes cannot have outgoing edges.
  for (const terminal of terminalNodes) {
    if ((edgesBySource.get(terminal.id) ?? []).length > 0) {
      errors.push({
        severity: "error",
        code: "terminal_has_outgoing_edge",
        message: `${terminalLabel(terminal.terminalAction)} cannot have an outgoing connection.`,
        nodeId: terminal.id,
      });
    }
  }

  // Rule 16: terminal action duplicated as a system node.
  const terminalActionCounts = new Map<TerminalAction, number>();
  for (const terminal of terminalNodes) {
    terminalActionCounts.set(terminal.terminalAction, (terminalActionCounts.get(terminal.terminalAction) ?? 0) + 1);
  }
  for (const [action, count] of terminalActionCounts) {
    if (count > 1) {
      errors.push({
        severity: "error",
        code: "terminal_action_invalid",
        message: `${terminalLabel(action)} is defined more than once.`,
      });
    }
  }

  // Group Agent nodes by referenced Agent id for membership/duplication rules.
  const agentNodesByAgentId = new Map<string, typeof agentNodes>();
  for (const node of agentNodes) {
    const list = agentNodesByAgentId.get(node.agentId) ?? [];
    list.push(node);
    agentNodesByAgentId.set(node.agentId, list);
  }

  for (const [agentId, nodesForAgent] of agentNodesByAgentId) {
    // Rule 9: the same Agent appears more than once.
    if (nodesForAgent.length > 1) {
      for (const node of nodesForAgent) {
        errors.push({
          severity: "error",
          code: "duplicate_agent_node",
          message: "This Agent appears more than once in the workflow.",
          nodeId: node.id,
        });
      }
    }

    // Rule 7: Agent is not a Team member.
    if (!context.memberAgentIds.has(agentId)) {
      for (const node of nodesForAgent) {
        errors.push({
          severity: "error",
          code: "agent_not_team_member",
          message: "This Agent is not a member of the Team.",
          nodeId: node.id,
        });
      }
    } else if (!context.executableAgentIds.has(agentId)) {
      // Rule 8: Agent or its Department is disabled.
      for (const node of nodesForAgent) {
        errors.push({
          severity: "error",
          code: "agent_disabled",
          message: "This Agent (or its Department) is disabled.",
          nodeId: node.id,
        });
      }
    }
  }

  // Rules 10/17: every enabled executable Team Agent must appear exactly once.
  if (context.executableAgentIds.size === 0) {
    errors.push({
      severity: "error",
      code: "missing_team_agent_node",
      message: "The Team has no enabled executable Agents, so Start cannot target a valid Agent.",
    });
  } else {
    for (const agentId of context.executableAgentIds) {
      if (!agentNodesByAgentId.has(agentId)) {
        errors.push({
          severity: "error",
          code: "missing_team_agent_node",
          message: "This enabled Team Agent is missing from the workflow.",
        });
      }
    }
  }

  // Per-Agent outcome edge rules (11, 12) and missing-outcome warnings.
  for (const node of agentNodes) {
    const edgesFromNode = edgesBySource.get(node.id) ?? [];
    const seenOutcomes = new Set<AgentRouteOutcome>();

    for (const edge of edgesFromNode) {
      if (edge.outcome === null) {
        errors.push({
          severity: "error",
          code: "invalid_edge_outcome",
          message: "An Agent connection must specify one outcome.",
          edgeId: edge.id,
        });
        continue;
      }

      if (!FIXED_OUTCOMES.includes(edge.outcome)) {
        errors.push({
          severity: "error",
          code: "invalid_edge_outcome",
          message: `Unsupported outcome "${edge.outcome}".`,
          edgeId: edge.id,
        });
        continue;
      }

      if (seenOutcomes.has(edge.outcome)) {
        errors.push({
          severity: "error",
          code: "duplicate_outcome_edge",
          message: `More than one connection is configured for outcome "${edge.outcome}".`,
          nodeId: node.id,
          outcome: edge.outcome,
        });
      }

      seenOutcomes.add(edge.outcome);
    }

    const missingOutcomes = FIXED_OUTCOMES.filter((outcome) => !seenOutcomes.has(outcome));
    if (missingOutcomes.length) {
      warnings.push({
        severity: "warning",
        code: "missing_outcome_edge",
        message: `${missingOutcomes.length} unconfigured outcome route${missingOutcomes.length > 1 ? "s" : ""} (${missingOutcomes.join(", ")}).`,
        nodeId: node.id,
      });
    }

    for (const edge of edgesFromNode) {
      if (edge.targetNodeId === node.id) {
        warnings.push({
          severity: "warning",
          code: "workflow_advisory",
          message: "This Agent routes an outcome back to itself.",
          edgeId: edge.id,
        });
      }
    }

    const targetCounts = new Map<string, number>();
    for (const edge of edgesFromNode) {
      targetCounts.set(edge.targetNodeId, (targetCounts.get(edge.targetNodeId) ?? 0) + 1);
    }
    if ([...targetCounts.values()].some((count) => count > 1)) {
      warnings.push({
        severity: "warning",
        code: "workflow_advisory",
        message: "Multiple outcomes route to the same target from this Agent.",
        nodeId: node.id,
      });
    }
  }

  // Rule 13: every Agent node must be reachable from Start.
  const reachable = new Set<string>();
  if (start) {
    const queue = (edgesBySource.get(start.id) ?? []).map((edge) => edge.targetNodeId);
    while (queue.length) {
      const current = queue.shift() as string;
      if (reachable.has(current)) continue;
      reachable.add(current);

      const node = nodesById.get(current);
      if (!node || node.kind !== "agent") continue;

      for (const edge of edgesBySource.get(current) ?? []) {
        if (!reachable.has(edge.targetNodeId)) {
          queue.push(edge.targetNodeId);
        }
      }
    }
  }
  for (const node of agentNodes) {
    if (!reachable.has(node.id)) {
      errors.push({
        severity: "error",
        code: "unreachable_agent",
        message: "This Agent is not reachable from Start.",
        nodeId: node.id,
      });
    }
  }

  // Advisory: a cycle exists somewhere in the graph (loops are valid topology).
  if (hasCycle(agentNodes.map((node) => node.id), edgesBySource)) {
    warnings.push({
      severity: "warning",
      code: "workflow_advisory",
      message: "The workflow graph contains a loop.",
    });
  }

  // Advisory: a terminal node has no incoming connections.
  const targetedNodeIds = new Set(graph.edges.map((edge) => edge.targetNodeId));
  for (const terminal of terminalNodes) {
    if (!targetedNodeIds.has(terminal.id)) {
      warnings.push({
        severity: "warning",
        code: "workflow_advisory",
        message: `${terminalLabel(terminal.terminalAction)} has no incoming connections.`,
        nodeId: terminal.id,
      });
    }
  }

  return { errors, warnings, publishable: errors.length === 0 };
}

async function validationContext(tx: Tx, teamId: string): Promise<WorkflowGraphValidationContext> {
  const [executableAgents, memberAgentIds] = await Promise.all([
    resolveExecutableTeamAgents(tx, teamId),
    resolveTeamMemberAgentIds(tx, teamId),
  ]);

  return {
    executableAgentIds: new Set(executableAgents.map((agent) => agent.agentId)),
    memberAgentIds,
  };
}

/** Returns the Team's Draft workflow, creating an empty seeded one if none exists yet. */
export async function getOrCreateDraft(teamId: string): Promise<WorkflowDraft> {
  return db.transaction(async (tx) => {
    const draftRow = await getOrCreateDraftRow(tx, teamId);
    const graph = await loadGraph(tx, draftRow.id);

    return { id: draftRow.id, teamId, graph, updatedAt: draftRow.updatedAt.toISOString() };
  });
}

/**
 * Atomically replaces the Team's entire Draft graph (bounded whole-graph
 * replace, no incremental mutation endpoints per roadmap section 15).
 * Incomplete graphs are allowed; only malformed/cross-referential input is
 * rejected. Always returns fresh validation so the UI can show readiness.
 */
export async function saveDraftGraph(
  teamId: string,
  graph: WorkflowGraph,
): Promise<{ draft: WorkflowDraft; validation: WorkflowValidationResult }> {
  assertStructurallySafeDraft(graph);

  return db.transaction(async (tx) => {
    await tx.execute(sql`LOCK TABLE ${workflowRevisions} IN SHARE ROW EXCLUSIVE MODE`);

    const draftRow = await getOrCreateDraftRow(tx, teamId);

    await tx.delete(workflowEdges).where(eq(workflowEdges.revisionId, draftRow.id));
    await tx.delete(workflowNodes).where(eq(workflowNodes.revisionId, draftRow.id));

    if (graph.nodes.length) {
      await tx.insert(workflowNodes).values(
        graph.nodes.map((node) => ({
          id: node.id,
          revisionId: draftRow.id,
          kind: node.kind,
          agentId: node.kind === "agent" ? node.agentId : null,
          terminalAction: node.kind === "terminal" ? node.terminalAction : null,
          positionX: node.position.x,
          positionY: node.position.y,
        })),
      );
    }

    if (graph.edges.length) {
      await tx.insert(workflowEdges).values(
        graph.edges.map((edge) => ({
          id: edge.id,
          revisionId: draftRow.id,
          sourceNodeId: edge.sourceNodeId,
          targetNodeId: edge.targetNodeId,
          outcome: edge.outcome,
        })),
      );
    }

    await tx
      .update(workflowRevisions)
      .set({ updatedAt: new Date() })
      .where(eq(workflowRevisions.id, draftRow.id));

    const [updatedDraftRow] = await tx
      .select()
      .from(workflowRevisions)
      .where(eq(workflowRevisions.id, draftRow.id));

    const persistedGraph = await loadGraph(tx, draftRow.id);
    const validation = validateGraph(persistedGraph, await validationContext(tx, teamId));

    return {
      draft: {
        id: draftRow.id,
        teamId,
        graph: persistedGraph,
        updatedAt: updatedDraftRow.updatedAt.toISOString(),
      },
      validation,
    };
  });
}

/**
 * Publishes the Team's current Draft as a new immutable Published
 * revision. Rejects on any blocking validation error; missing outcome
 * edges and other warnings never block publish. The Draft row is left
 * untouched after publishing.
 */
export async function publishDraft(teamId: string): Promise<PublishWorkflowResponse> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`LOCK TABLE ${workflowRevisions} IN SHARE ROW EXCLUSIVE MODE`);

    const [team] = await tx.select({ id: teams.id }).from(teams).where(eq(teams.id, teamId));
    if (!team) {
      throw new WorkflowGraphServiceError("The selected Team does not exist", 404);
    }

    const [draftRow] = await tx
      .select()
      .from(workflowRevisions)
      .where(and(eq(workflowRevisions.teamId, teamId), eq(workflowRevisions.state, "draft")));
    if (!draftRow) {
      throw new WorkflowGraphServiceError("The Team has no Draft workflow to publish", 404);
    }

    const graph = await loadGraph(tx, draftRow.id);
    const validation = validateGraph(graph, await validationContext(tx, teamId));

    if (!validation.publishable) {
      throw new WorkflowGraphServiceError(
        "The Draft workflow has blocking validation errors and cannot be published",
        400,
        validation,
      );
    }

    const [{ maxVersion }] = await tx
      .select({ maxVersion: sql<number | null>`max(${workflowRevisions.version})` })
      .from(workflowRevisions)
      .where(and(eq(workflowRevisions.teamId, teamId), eq(workflowRevisions.state, "published")));

    const nextVersion = (maxVersion ?? 0) + 1;

    const [publishedRow] = await tx
      .insert(workflowRevisions)
      .values({ teamId, state: "published", version: nextVersion, publishedAt: new Date() })
      .returning();

    const nodeIdMap = new Map<string, string>();

    if (graph.nodes.length) {
      const insertedNodes = await tx
        .insert(workflowNodes)
        .values(
          graph.nodes.map((node) => ({
            revisionId: publishedRow.id,
            kind: node.kind,
            agentId: node.kind === "agent" ? node.agentId : null,
            terminalAction: node.kind === "terminal" ? node.terminalAction : null,
            positionX: node.position.x,
            positionY: node.position.y,
          })),
        )
        .returning();

      graph.nodes.forEach((node, index) => nodeIdMap.set(node.id, insertedNodes[index].id));
    }

    if (graph.edges.length) {
      await tx.insert(workflowEdges).values(
        graph.edges.map((edge) => ({
          revisionId: publishedRow.id,
          sourceNodeId: nodeIdMap.get(edge.sourceNodeId) as string,
          targetNodeId: nodeIdMap.get(edge.targetNodeId) as string,
          outcome: edge.outcome,
        })),
      );
    }

    return {
      revision: publishedRevisionSummary(publishedRow, graph.nodes.length, graph.edges.length),
      validation,
    };
  });
}

/**
 * Returns the Team's Draft graph, latest Published summary, full Published
 * history, and current Draft validation -- the response shape backing
 * the dashboard's aggregate read. Returns null when the Team does not
 * exist. Does not touch the legacy `GET /api/teams/:teamId/workflow`
 * response shape, which remains layer/order-oriented until the dashboard
 * cuts over to this aggregate.
 */
export async function getWorkflowAggregate(teamId: string): Promise<WorkflowAggregate | null> {
  return db.transaction(async (tx) => {
    const [team] = await tx.select({ id: teams.id }).from(teams).where(eq(teams.id, teamId));
    if (!team) {
      return null;
    }

    const draftRow = await getOrCreateDraftRow(tx, teamId);
    const draftGraph = await loadGraph(tx, draftRow.id);

    const publishedRows = await tx
      .select()
      .from(workflowRevisions)
      .where(and(eq(workflowRevisions.teamId, teamId), eq(workflowRevisions.state, "published")))
      .orderBy(desc(workflowRevisions.version));

    const publishedSummaries: WorkflowPublishedRevisionSummary[] = [];
    for (const row of publishedRows) {
      const [[{ nodeCount }], [{ edgeCount }]] = await Promise.all([
        tx.select({ nodeCount: sql<number>`count(*)` }).from(workflowNodes).where(eq(workflowNodes.revisionId, row.id)),
        tx.select({ edgeCount: sql<number>`count(*)` }).from(workflowEdges).where(eq(workflowEdges.revisionId, row.id)),
      ]);
      publishedSummaries.push(publishedRevisionSummary(row, Number(nodeCount), Number(edgeCount)));
    }

    const validation = validateGraph(draftGraph, await validationContext(tx, teamId));

    return {
      teamId,
      draft: { id: draftRow.id, teamId, graph: draftGraph, updatedAt: draftRow.updatedAt.toISOString() },
      published: publishedSummaries[0] ?? null,
      publishedRevisionHistory: publishedSummaries,
      validation,
    };
  });
}

export type RunnableWorkflow = {
  revisionId: string;
  version: number;
  graph: WorkflowGraph;
};

/**
 * Resolves the single source of truth for "can this Team start a new Run
 * right now": the latest Published revision must exist, its Agent nodes
 * must exactly match the Team's current executable membership (an
 * enabled/disabled or added/removed Agent since publish makes the
 * Published graph stale), and it must still pass structural validation.
 * Returns null rather than throwing so callers choose their own error
 * shape (manual `409` vs. an Auto Mode not-ready state) per roadmap
 * section 20 -- both call sites must share this one readiness function.
 */
export async function resolveRunnablePublishedWorkflow(
  tx: Tx,
  teamId: string,
): Promise<RunnableWorkflow | null> {
  const [publishedRow] = await tx
    .select()
    .from(workflowRevisions)
    .where(and(eq(workflowRevisions.teamId, teamId), eq(workflowRevisions.state, "published")))
    .orderBy(desc(workflowRevisions.version))
    .limit(1);

  if (!publishedRow) {
    return null;
  }

  const graph = await loadGraph(tx, publishedRow.id);
  const context = await validationContext(tx, teamId);

  const graphAgentIds = new Set(
    graph.nodes
      .filter((node): node is Extract<WorkflowGraphNode, { kind: "agent" }> => node.kind === "agent")
      .map((node) => node.agentId),
  );

  const membershipMatches =
    graphAgentIds.size === context.executableAgentIds.size &&
    [...context.executableAgentIds].every((agentId) => graphAgentIds.has(agentId));

  if (!membershipMatches) {
    return null;
  }

  const validation = validateGraph(graph, context);
  if (!validation.publishable) {
    return null;
  }

  return { revisionId: publishedRow.id, version: publishedRow.version as number, graph };
}

/** Read-only lookup of one immutable Published revision, 404-equivalent as null. */
export async function getPublishedRevision(
  teamId: string,
  revisionId: string,
): Promise<WorkflowPublishedRevision | null> {
  const [row] = await db
    .select()
    .from(workflowRevisions)
    .where(
      and(
        eq(workflowRevisions.id, revisionId),
        eq(workflowRevisions.teamId, teamId),
        eq(workflowRevisions.state, "published"),
      ),
    );

  if (!row) {
    return null;
  }

  const graph = await loadGraph(db, row.id);

  return { ...publishedRevisionSummary(row, graph.nodes.length, graph.edges.length), graph };
}
