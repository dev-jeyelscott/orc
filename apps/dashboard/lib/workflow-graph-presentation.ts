import type { AgentRouteOutcome, WorkflowGraph, WorkflowGraphEdge } from "@orc/shared";

const WORKFLOW_OUTCOMES: readonly AgentRouteOutcome[] = [
  "completed",
  "approved",
  "changes_requested",
  "blocked",
  "failed",
];

export type WorkflowPresentationMode = "simplified" | "all_routes";
export type WorkflowPresentationEdgeKind = "start" | "success" | "exception" | "backward" | "terminal";

export type WorkflowPresentationEdge = {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  outcomes: AgentRouteOutcome[];
  underlyingEdgeIds: string[];
  kind: WorkflowPresentationEdgeKind;
  backward: boolean;
};

const SUCCESS_OUTCOMES = new Set<AgentRouteOutcome>(["completed", "approved"]);
const OUTCOME_INDEX = new Map(WORKFLOW_OUTCOMES.map((outcome, index) => [outcome, index]));

/** Dashboard-only visual projection. It never changes or invents canonical routes. */
export function deriveWorkflowPresentation({
  graph,
  mode,
  selectedNodeId,
  focusedEdgeId,
}: {
  graph: WorkflowGraph;
  mode: WorkflowPresentationMode;
  selectedNodeId?: string | null;
  focusedEdgeId?: string | null;
}): WorkflowPresentationEdge[] {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const visible = graph.edges.filter((edge) => {
    if (edge.outcome === null) return true;
    return mode === "all_routes" || SUCCESS_OUTCOMES.has(edge.outcome) ||
      edge.sourceNodeId === selectedNodeId || edge.id === focusedEdgeId;
  });
  const grouped = new Map<string, WorkflowGraphEdge[]>();
  for (const edge of visible) {
    const key = `${edge.sourceNodeId}:${edge.targetNodeId}`;
    const group = grouped.get(key) ?? [];
    group.push(edge);
    grouped.set(key, group);
  }

  return [...grouped.values()].map((edges) => {
    const first = edges[0]!;
    const outcomes = edges
      .map((edge) => edge.outcome)
      .filter((outcome): outcome is AgentRouteOutcome => outcome !== null)
      .sort((a, b) => (OUTCOME_INDEX.get(a) ?? 99) - (OUTCOME_INDEX.get(b) ?? 99));
    const source = nodeById.get(first.sourceNodeId);
    const target = nodeById.get(first.targetNodeId);
    const backward = source !== undefined && target !== undefined && target.position.y <= source.position.y;
    const isTerminal = target?.kind === "terminal";
    const kind: WorkflowPresentationEdgeKind = first.outcome === null
      ? "start"
      : backward
        ? "backward"
        : isTerminal
          ? "terminal"
          : SUCCESS_OUTCOMES.has(first.outcome)
            ? "success"
            : "exception";
    return {
      id: `presentation:${first.sourceNodeId}:${first.targetNodeId}`,
      sourceNodeId: first.sourceNodeId,
      targetNodeId: first.targetNodeId,
      outcomes,
      underlyingEdgeIds: edges.map((edge) => edge.id).sort(),
      kind,
      backward,
    };
  }).sort((a, b) => a.id.localeCompare(b.id));
}

export function routeCountForNode(graph: WorkflowGraph, nodeId: string): number {
  return graph.edges.filter((edge) => edge.sourceNodeId === nodeId && edge.outcome !== null).length;
}
