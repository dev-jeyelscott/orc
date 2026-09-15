import dagre from "@dagrejs/dagre";

import type {
  Agent,
  AgentRouteOutcome,
  TerminalAction,
  WorkflowGraph,
  WorkflowGraphEdge,
  WorkflowGraphNode,
  WorkflowValidationIssue,
} from "@orc/shared";

export const WORKFLOW_OUTCOMES: readonly AgentRouteOutcome[] = [
  "completed",
  "approved",
  "changes_requested",
  "blocked",
  "failed",
];

export const OUTCOME_LABELS: Record<AgentRouteOutcome, string> = {
  completed: "completed",
  approved: "approved",
  changes_requested: "changes requested",
  blocked: "blocked",
  failed: "failed",
};

export const TERMINAL_LABELS: Record<TerminalAction, string> = {
  complete_run: "Complete Run",
  block_run: "Block Run",
  fail_run: "Fail Run",
};

const MIN_COORDINATE = -100_000;
const MAX_COORDINATE = 100_000;

export type AgentGraphNode = Extract<WorkflowGraphNode, { kind: "agent" }>;
export type TerminalGraphNode = Extract<WorkflowGraphNode, { kind: "terminal" }>;
export type StartGraphNode = Extract<WorkflowGraphNode, { kind: "start" }>;

/** Team Agents not yet represented as a node in the Draft graph. */
export function buildPaletteAgents(
  teamAgents: readonly Agent[],
  graph: WorkflowGraph,
): Agent[] {
  const placedAgentIds = new Set(
    graph.nodes
      .filter((node): node is AgentGraphNode => node.kind === "agent")
      .map((node) => node.agentId),
  );

  return teamAgents.filter((agent) => !placedAgentIds.has(agent.id));
}

/** Whether an Agent can still be added as a new node (not already placed). */
export function canAddAgentNode(agentId: string, graph: WorkflowGraph): boolean {
  return !graph.nodes.some((node) => node.kind === "agent" && node.agentId === agentId);
}

/**
 * The five fixed-outcome rows for one Agent node, each resolved to its
 * configured destination or `null` when no edge exists ("Not configured").
 * Never derives a fake edge -- absence is represented as `targetLabel: null`.
 */
export type OutcomeRow = {
  outcome: AgentRouteOutcome;
  edgeId: string | null;
  targetNodeId: string | null;
  targetLabel: string;
  configured: boolean;
};

/**
 * Sets exactly one explicit Agent outcome route. A missing destination removes
 * that route; it never creates a null-target placeholder edge.
 */
export function setOutcomeRoute(
  graph: WorkflowGraph,
  sourceNodeId: string,
  outcome: AgentRouteOutcome,
  targetNodeId: string | null,
  createEdgeId: () => string,
): WorkflowGraph {
  const existing = graph.edges.find(
    (edge) => edge.sourceNodeId === sourceNodeId && edge.outcome === outcome,
  );

  if (!targetNodeId) {
    return {
      ...graph,
      edges: graph.edges.filter((edge) => edge !== existing),
    };
  }

  if (existing) {
    return {
      ...graph,
      edges: graph.edges.map((edge) =>
        edge === existing ? { ...edge, targetNodeId } : edge,
      ),
    };
  }

  return {
    ...graph,
    edges: [
      ...graph.edges,
      { id: createEdgeId(), sourceNodeId, targetNodeId, outcome },
    ],
  };
}

export function outcomesForSourceNode(
  sourceNodeId: string,
  graph: WorkflowGraph,
  labelForNode: (nodeId: string) => string,
): OutcomeRow[] {
  const edgesFromSource = graph.edges.filter((edge) => edge.sourceNodeId === sourceNodeId);

  return WORKFLOW_OUTCOMES.map((outcome) => {
    const edge = edgesFromSource.find((candidate) => candidate.outcome === outcome);

    if (!edge) {
      return {
        outcome,
        edgeId: null,
        targetNodeId: null,
        targetLabel: "Not configured",
        configured: false,
      };
    }

    return {
      outcome,
      edgeId: edge.id,
      targetNodeId: edge.targetNodeId,
      targetLabel: labelForNode(edge.targetNodeId),
      configured: true,
    };
  });
}

/** Outcomes not already assigned an edge from this source -- for the new-edge outcome picker. */
export function availableOutcomesForNewEdge(
  sourceNodeId: string,
  graph: WorkflowGraph,
): AgentRouteOutcome[] {
  const assigned = new Set(
    graph.edges
      .filter((edge) => edge.sourceNodeId === sourceNodeId && edge.outcome !== null)
      .map((edge) => edge.outcome as AgentRouteOutcome),
  );

  return WORKFLOW_OUTCOMES.filter((outcome) => !assigned.has(outcome));
}

/** Clamps a dropped/dragged position to the bounded coordinate range the server accepts. */
export function boundedPosition(x: number, y: number): { x: number; y: number } {
  const clamp = (value: number) =>
    Math.round(Math.min(MAX_COORDINATE, Math.max(MIN_COORDINATE, Number.isNaN(value) ? 0 : value)));

  return { x: clamp(x), y: clamp(y) };
}

/** Resolves which graph element a validation issue refers to, for click-to-focus. */
export function focusTargetForIssue(
  issue: WorkflowValidationIssue,
): { kind: "node"; id: string } | { kind: "edge"; id: string } | null {
  if (issue.nodeId) {
    return { kind: "node", id: issue.nodeId };
  }

  if (issue.edgeId) {
    return { kind: "edge", id: issue.edgeId };
  }

  return null;
}

/** Finds the Start node's single outgoing edge, if configured. */
export function findStartEdge(graph: WorkflowGraph): WorkflowGraphEdge | undefined {
  const start = graph.nodes.find((node): node is StartGraphNode => node.kind === "start");
  if (!start) return undefined;

  return graph.edges.find((edge) => edge.sourceNodeId === start.id);
}

const AGENT_NODE_WIDTH = 240;
const AGENT_NODE_HEIGHT = 108;
const TERMINAL_NODE_WIDTH = 160;
const TERMINAL_NODE_HEIGHT = 56;
const RANK_SEPARATION = 120;
const NODE_SEPARATION = 64;

/**
 * Applies a top-to-bottom Dagre layout using the deterministic, acyclic
 * success-first backbone. Secondary routes still exist in the persisted
 * graph but do not become equal ranking constraints. This is only invoked as
 * an explicit "Auto arrange" action, so manual positions are never silently
 * overwritten. Reuses the repository's existing `@dagrejs/dagre` dependency.
 */
export function autoLayoutGraph(graph: WorkflowGraph): WorkflowGraph {
  const layoutGraph = new dagre.graphlib.Graph();
  layoutGraph.setGraph({
    rankdir: "TB",
    ranksep: RANK_SEPARATION,
    nodesep: NODE_SEPARATION,
  });
  layoutGraph.setDefaultEdgeLabel(() => ({}));

  for (const node of graph.nodes) {
    const dimensions =
      node.kind === "terminal"
        ? { width: TERMINAL_NODE_WIDTH, height: TERMINAL_NODE_HEIGHT }
        : { width: AGENT_NODE_WIDTH, height: AGENT_NODE_HEIGHT };

    layoutGraph.setNode(node.id, dimensions);
  }

  for (const edge of layoutBackboneEdges(graph)) {
    layoutGraph.setEdge(edge.sourceNodeId, edge.targetNodeId);
  }

  dagre.layout(layoutGraph);

  const nonTerminalBottom = Math.max(
    0,
    ...graph.nodes
      .filter((node) => node.kind !== "terminal")
      .map((node) => ((layoutGraph.node(node.id) as { y: number } | undefined)?.y ?? 0)),
  );

  return {
    nodes: graph.nodes.map((node) => {
      const positioned = layoutGraph.node(node.id) as { x: number; y: number } | undefined;

      if (!positioned) {
        return node;
      }

      const width = node.kind === "terminal" ? TERMINAL_NODE_WIDTH : AGENT_NODE_WIDTH;
      const height = node.kind === "terminal" ? TERMINAL_NODE_HEIGHT : AGENT_NODE_HEIGHT;
      const centerY = node.kind === "terminal"
        ? Math.max(positioned.y, nonTerminalBottom + RANK_SEPARATION)
        : positioned.y;

      return {
        ...node,
        position: boundedPosition(positioned.x - width / 2, centerY - height / 2),
      };
    }),
    edges: graph.edges,
  };
}

/**
 * Builds deterministic, acyclic ranking constraints for Dagre. Actual routes
 * remain untouched: this only prevents loops and secondary routes from
 * distorting the success-oriented visual spine.
 */
export function layoutBackboneEdges(graph: WorkflowGraph): WorkflowGraphEdge[] {
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const start = graph.nodes.find((node): node is StartGraphNode => node.kind === "start");
  if (!start) return [];

  const bySource = new Map<string, WorkflowGraphEdge[]>();
  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.sourceNodeId) || !nodeIds.has(edge.targetNodeId)) continue;
    const sourceEdges = bySource.get(edge.sourceNodeId) ?? [];
    sourceEdges.push(edge);
    bySource.set(edge.sourceNodeId, sourceEdges);
  }

  const priority = new Map<AgentRouteOutcome | null, number>([
    [null, 0],
    ["completed", 1],
    ["approved", 2],
    ["changes_requested", 3],
    ["blocked", 4],
    ["failed", 5],
  ]);
  const compareEdges = (a: WorkflowGraphEdge, b: WorkflowGraphEdge) =>
    (priority.get(a.outcome) ?? 99) - (priority.get(b.outcome) ?? 99) ||
    a.targetNodeId.localeCompare(b.targetNodeId) ||
    a.id.localeCompare(b.id);

  const visited = new Set<string>([start.id]);
  const queue = [start.id];
  const backbone: WorkflowGraphEdge[] = [];
  while (queue.length > 0) {
    const sourceNodeId = queue.shift()!;
    for (const edge of (bySource.get(sourceNodeId) ?? []).sort(compareEdges)) {
      if (visited.has(edge.targetNodeId)) continue;
      visited.add(edge.targetNodeId);
      queue.push(edge.targetNodeId);
      backbone.push(edge);
    }
  }

  return backbone;
}
