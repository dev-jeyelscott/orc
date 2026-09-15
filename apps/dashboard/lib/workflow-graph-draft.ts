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

const AGENT_NODE_WIDTH = 220;
const AGENT_NODE_HEIGHT = 88;
const TERMINAL_NODE_WIDTH = 160;
const TERMINAL_NODE_HEIGHT = 56;
const RANK_SEPARATION = 96;
const NODE_SEPARATION = 48;

/**
 * Applies a left-to-right Dagre layered layout (Start on the left, ranked
 * by edge distance, terminals on the right). Only invoked as an explicit
 * "Auto arrange" action -- never automatically on every render -- since
 * the operator's own manual positioning must never be silently
 * overwritten. Reuses the repository's existing `@dagrejs/dagre`
 * dependency rather than a hand-rolled layout.
 */
export function autoLayoutGraph(graph: WorkflowGraph): WorkflowGraph {
  const layoutGraph = new dagre.graphlib.Graph();
  layoutGraph.setGraph({
    rankdir: "LR",
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

  for (const edge of graph.edges) {
    layoutGraph.setEdge(edge.sourceNodeId, edge.targetNodeId);
  }

  dagre.layout(layoutGraph);

  return {
    nodes: graph.nodes.map((node) => {
      const positioned = layoutGraph.node(node.id) as { x: number; y: number } | undefined;

      if (!positioned) {
        return node;
      }

      const width = node.kind === "terminal" ? TERMINAL_NODE_WIDTH : AGENT_NODE_WIDTH;
      const height = node.kind === "terminal" ? TERMINAL_NODE_HEIGHT : AGENT_NODE_HEIGHT;

      return {
        ...node,
        position: boundedPosition(positioned.x - width / 2, positioned.y - height / 2),
      };
    }),
    edges: graph.edges,
  };
}
