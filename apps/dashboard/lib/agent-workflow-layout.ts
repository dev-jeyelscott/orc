import dagre from "@dagrejs/dagre";
import type {
  Edge,
  Node,
} from "@xyflow/react";

import type {
  AgentRouteOutcome,
  AgentWithRoutes,
  TerminalAction,
} from "@orc/shared";

import {
  formatIdentifier,
  groupAgentsByLayer,
  type AgentWorkflowEdge,
} from "./agent-presentation";

export const AGENT_NODE_WIDTH =
  224;

export const AGENT_NODE_HEIGHT =
  88;

export const TERMINAL_NODE_WIDTH =
  184;

export const TERMINAL_NODE_HEIGHT =
  64;

const NODE_HORIZONTAL_GAP =
  56;

const LAYER_VERTICAL_GAP =
  40;

const TERMINAL_VERTICAL_GAP =
  48;

const CANVAS_PADDING =
  24;

export type AgentWorkflowAgentNodeData = {
  agent: AgentWithRoutes;
};

export type AgentWorkflowTerminalNodeData = {
  terminalAction:
    TerminalAction;
};

export type AgentWorkflowGraphEdgeData = {
  kind:
    AgentWorkflowEdge["kind"];
  outcome:
    AgentRouteOutcome | null;
  enabled: boolean;
  active: boolean;
  color: string;
};

export type AgentWorkflowAgentNode =
  Node<
    AgentWorkflowAgentNodeData,
    "agent"
  >;

export type AgentWorkflowTerminalNode =
  Node<
    AgentWorkflowTerminalNodeData,
    "terminal"
  >;

export type AgentWorkflowGraphNode =
  | AgentWorkflowAgentNode
  | AgentWorkflowTerminalNode;

export type AgentWorkflowGraphEdge =
  Edge<AgentWorkflowGraphEdgeData>;

export type AgentWorkflowLayout = {
  nodes:
    AgentWorkflowGraphNode[];
  edges:
    AgentWorkflowGraphEdge[];
  contentHeight: number;
  topologyKey: string;
};

/**
 * Returns a collision-safe React Flow node identifier for one terminal action.
 */
export function terminalWorkflowNodeId(
  action: TerminalAction,
): string {
  return `terminal:${action}`;
}

/**
 * Orders agents deterministically according to the runtime layer and execution-order contract.
 */
function compareAgents(
  left: AgentWithRoutes,
  right: AgentWithRoutes,
): number {
  return (
    left.layer -
      right.layer ||
    left.executionOrder -
      right.executionOrder ||
    left.id.localeCompare(
      right.id,
    )
  );
}

/**
 * Returns the existing semantic design token used to render one explicit route outcome.
 */
function outcomeColor(
  outcome:
    AgentRouteOutcome | null,
): string {
  switch (outcome) {
    case "completed":
    case "approved":
    case "changes_requested":
      return "var(--status-success)";

    case "blocked":
      return "var(--status-warning)";

    case "failed":
      return "var(--status-error)";

    default:
      return "var(--text-muted)";
  }
}

/**
 * Builds evenly spaced horizontal centers around a Dagre-derived graph center.
 */
function horizontalCenters(
  count: number,
  nodeWidth: number,
  centerX: number,
): number[] {
  if (count <= 0) {
    return [];
  }

  const totalWidth =
    count * nodeWidth +
    Math.max(
      0,
      count - 1,
    ) *
      NODE_HORIZONTAL_GAP;

  const firstCenter =
    centerX -
    totalWidth / 2 +
    nodeWidth / 2;

  return Array.from(
    {
      length: count,
    },
    (
      _value,
      index,
    ) =>
      firstCenter +
      index *
        (
          nodeWidth +
          NODE_HORIZONTAL_GAP
        ),
  );
}

/**
 * Resolves the appropriate hidden React Flow handles for one workflow edge.
 */
function edgeHandles(
  edge: AgentWorkflowEdge,
  agentsById:
    Map<
      string,
      AgentWithRoutes
    >,
): {
  sourceHandle: string;
  targetHandle: string;
} {
  if (edge.terminalAction) {
    return {
      sourceHandle:
        "bottom-source",
      targetHandle:
        "top-target",
    };
  }

  const source =
    agentsById.get(
      edge.sourceAgentId,
    );

  const target =
    edge.targetAgentId
      ? agentsById.get(
          edge.targetAgentId,
        )
      : null;

  if (
    source &&
    target &&
    source.layer ===
      target.layer
  ) {
    return {
      sourceHandle:
        "right-source",
      targetHandle:
        "left-target",
    };
  }

  if (
    source &&
    target &&
    target.layer <
      source.layer
  ) {
    return {
      sourceHandle:
        "right-source",
      targetHandle:
        "right-target",
    };
  }

  return {
    sourceHandle:
      "bottom-source",
    targetHandle:
      "top-target",
  };
}

/**
 * Converts persisted agent configuration and derived workflow edges into deterministic React Flow presentation state.
 */
export function buildAgentWorkflowLayout(
  agents: AgentWithRoutes[],
  workflowEdges:
    AgentWorkflowEdge[],
): AgentWorkflowLayout {
  const orderedAgents =
    [
      ...agents,
    ].sort(
      compareAgents,
    );

  const agentsById =
    new Map(
      orderedAgents.map(
        (agent) => [
          agent.id,
          agent,
        ],
      ),
    );

  const orderedEdges =
    [
      ...workflowEdges,
    ].sort(
      (
        left,
        right,
      ) =>
        left.id.localeCompare(
          right.id,
        ),
    );

  const terminalActions =
    [
      ...new Set(
        orderedEdges
          .map(
            (edge) =>
              edge.terminalAction,
          )
          .filter(
            (
              action,
            ): action is TerminalAction =>
              action !== null,
          ),
      ),
    ].sort();

  const agentNodes:
    AgentWorkflowAgentNode[] =
    orderedAgents.map(
      (agent) => ({
        id: agent.id,
        type: "agent",
        position: {
          x: 0,
          y: 0,
        },
        data: {
          agent,
        },
        draggable: false,
        connectable: false,
        selectable: false,
        deletable: false,
      }),
    );

  const terminalNodes:
    AgentWorkflowTerminalNode[] =
    terminalActions.map(
      (
        terminalAction,
      ) => ({
        id:
          terminalWorkflowNodeId(
            terminalAction,
          ),
        type: "terminal",
        position: {
          x: 0,
          y: 0,
        },
        data: {
          terminalAction,
        },
        draggable: false,
        connectable: false,
        selectable: false,
        deletable: false,
      }),
    );

  const allNodes:
    AgentWorkflowGraphNode[] =
    [
      ...agentNodes,
      ...terminalNodes,
    ];

  const nodeIds =
    new Set(
      allNodes.map(
        (node) =>
          node.id,
      ),
    );

  const dagreGraph =
    new dagre.graphlib.Graph(
      {
        multigraph: true,
      },
    );

  dagreGraph.setDefaultEdgeLabel(
    () => ({}),
  );

  dagreGraph.setGraph({
    rankdir: "TB",
    nodesep:
      NODE_HORIZONTAL_GAP,
    ranksep: 72,
    edgesep: 24,
    marginx:
      CANVAS_PADDING,
    marginy:
      CANVAS_PADDING,
  });

  for (
    const node of
    agentNodes
  ) {
    dagreGraph.setNode(
      node.id,
      {
        width:
          AGENT_NODE_WIDTH,
        height:
          AGENT_NODE_HEIGHT,
      },
    );
  }

  for (
    const node of
    terminalNodes
  ) {
    dagreGraph.setNode(
      node.id,
      {
        width:
          TERMINAL_NODE_WIDTH,
        height:
          TERMINAL_NODE_HEIGHT,
      },
    );
  }

  for (
    const edge of
    orderedEdges
  ) {
    const targetId =
      edge.targetAgentId ??
      (
        edge.terminalAction
          ? terminalWorkflowNodeId(
              edge.terminalAction,
            )
          : null
      );

    if (
      !targetId ||
      !nodeIds.has(
        edge.sourceAgentId,
      ) ||
      !nodeIds.has(
        targetId,
      )
    ) {
      continue;
    }

    dagreGraph.setEdge(
      edge.sourceAgentId,
      targetId,
      {
        weight:
          edge.kind ===
          "default"
            ? 4
            : 1,
      },
      edge.id,
    );
  }

  dagre.layout(
    dagreGraph,
  );

  const graphWidth =
    Number(
      dagreGraph.graph()
        .width ??
        AGENT_NODE_WIDTH +
          CANVAS_PADDING *
            2,
    );

  const graphCenterX =
    Math.max(
      graphWidth / 2,
      AGENT_NODE_WIDTH /
        2 +
        CANVAS_PADDING,
    );

  const nodeById =
    new Map(
      allNodes.map(
        (node) => [
          node.id,
          node,
        ],
      ),
    );

  const groups =
    groupAgentsByLayer(
      orderedAgents,
    );

  groups.forEach(
    (
      group,
      layerIndex,
    ) => {
      const orderedGroup =
        [
          ...group.agents,
        ].sort(
          compareAgents,
        );

      const centers =
        horizontalCenters(
          orderedGroup.length,
          AGENT_NODE_WIDTH,
          graphCenterX,
        );

      orderedGroup.forEach(
        (
          agent,
          agentIndex,
        ) => {
          const node =
            nodeById.get(
              agent.id,
            );

          if (!node) {
            return;
          }

          node.position = {
            x:
              centers[
                agentIndex
              ] -
              AGENT_NODE_WIDTH /
                2,
            y:
              CANVAS_PADDING +
              layerIndex *
                (
                  AGENT_NODE_HEIGHT +
                  LAYER_VERTICAL_GAP
                ),
          };
        },
      );
    },
  );

  const terminalY =
    CANVAS_PADDING +
    groups.length *
      (
        AGENT_NODE_HEIGHT +
        LAYER_VERTICAL_GAP
      ) +
    TERMINAL_VERTICAL_GAP;

  const terminalCenters =
    horizontalCenters(
      terminalNodes.length,
      TERMINAL_NODE_WIDTH,
      graphCenterX,
    );

  terminalNodes.forEach(
    (
      node,
      index,
    ) => {
      node.position = {
        x:
          terminalCenters[
            index
          ] -
          TERMINAL_NODE_WIDTH /
            2,
        y: terminalY,
      };
    },
  );

  const renderedEdges:
    AgentWorkflowGraphEdge[] =
    [];

  for (
    const edge of
    orderedEdges
  ) {
    const target =
      edge.targetAgentId ??
      (
        edge.terminalAction
          ? terminalWorkflowNodeId(
              edge.terminalAction,
            )
          : null
      );

    if (
      !target ||
      !nodeIds.has(
        edge.sourceAgentId,
      ) ||
      !nodeIds.has(
        target,
      )
    ) {
      continue;
    }

    const color =
      edge.kind ===
      "default"
        ? "var(--text-muted)"
        : outcomeColor(
            edge.outcome,
          );

    const handles =
      edgeHandles(
        edge,
        agentsById,
      );

    const label =
      edge.kind ===
        "explicit" &&
      edge.outcome
        ? `${formatIdentifier(
            edge.outcome,
          )}${
            edge.enabled
              ? ""
              : " · Disabled"
          }`
        : undefined;

    renderedEdges.push({
      id: edge.id,
      source:
        edge.sourceAgentId,
      target,
      sourceHandle:
        handles.sourceHandle,
      targetHandle:
        handles.targetHandle,
      type: "smoothstep",
      label,
      selectable: false,
      animated: false,
      data: {
        kind: edge.kind,
        outcome:
          edge.outcome,
        enabled:
          edge.enabled,
        active:
          edge.active,
        color,
      },
      style: {
        stroke: color,
        strokeWidth:
          edge.kind ===
          "explicit"
            ? 1.8
            : 1.4,
        strokeDasharray:
          edge.kind ===
          "explicit"
            ? "6 5"
            : undefined,
        opacity:
          edge.active
            ? 0.9
            : 0.35,
      },
      labelStyle: {
        fill: color,
        fontSize: 10,
        fontWeight: 600,
      },
      labelBgStyle: {
        fill:
          "var(--surface-elevated)",
        fillOpacity: 0.96,
      },
      labelBgPadding: [
        5,
        3,
      ],
      labelBgBorderRadius:
        4,
      zIndex:
        edge.kind ===
        "explicit"
          ? 2
          : 1,
    });
  }

  const contentHeight =
    terminalNodes.length >
    0
      ? terminalY +
        TERMINAL_NODE_HEIGHT +
        CANVAS_PADDING
      : groups.length > 0
        ? CANVAS_PADDING +
          (
            groups.length -
            1
          ) *
            (
              AGENT_NODE_HEIGHT +
              LAYER_VERTICAL_GAP
            ) +
          AGENT_NODE_HEIGHT +
          CANVAS_PADDING
        : 352;

  const topologyKey =
    JSON.stringify({
      agents:
        orderedAgents.map(
          (agent) => ({
            id: agent.id,
            layer:
              agent.layer,
            executionOrder:
              agent.executionOrder,
            enabled:
              agent.enabled,
          }),
        ),
      edges:
        orderedEdges.map(
          (edge) => ({
            id: edge.id,
            source:
              edge.sourceAgentId,
            target:
              edge.targetAgentId,
            terminal:
              edge.terminalAction,
            outcome:
              edge.outcome,
            enabled:
              edge.enabled,
            active:
              edge.active,
          }),
        ),
    });

  return {
    nodes: allNodes,
    edges:
      renderedEdges,
    contentHeight,
    topologyKey,
  };
}
