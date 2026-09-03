"use client";

import type {
  AgentRouteOutcome,
  AgentWithRoutes,
  TerminalAction,
} from "@orc/shared";

import {
  deriveWorkflowEdges,
  formatIdentifier,
  groupAgentsByLayer,
  type AgentWorkflowEdge,
} from "@/lib/agent-presentation";
import {
  cn,
} from "@/lib/utils";

import {
  Badge,
} from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const LABEL_WIDTH = 92;
const NODE_WIDTH = 156;
const NODE_HEIGHT = 56;
const NODE_GAP = 28;
const LANE_HEIGHT = 96;
const CANVAS_PADDING = 18;

type Point = {
  x: number;
  y: number;
};

type AgentWorkflowViewProps = {
  agents:
    AgentWithRoutes[];
  selectedAgentId:
    string | null;
  onSelectAgent:
    (agentId: string) => void;
};

/**
 * Returns the semantic route color for one explicit result outcome.
 */
function outcomeColor(
  outcome:
    AgentRouteOutcome | null,
): string {
  switch (outcome) {
    case "changes_requested":
    case "approved":
    case "completed":
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
 * Returns the arrow marker identifier matching one workflow edge.
 */
function markerForEdge(
  edge:
    AgentWorkflowEdge,
): string {
  if (
    edge.kind ===
    "default"
  ) {
    return "agent-arrow-neutral";
  }

  switch (edge.outcome) {
    case "blocked":
      return "agent-arrow-warning";
    case "failed":
      return "agent-arrow-error";
    case "changes_requested":
    case "approved":
    case "completed":
      return "agent-arrow-success";
    default:
      return "agent-arrow-neutral";
  }
}

/**
 * Resolves every rendered agent to its top-left canvas position.
 */
function buildAgentPositions(
  groups:
    ReturnType<
      typeof groupAgentsByLayer
    >,
): Map<string, Point> {
  const positions =
    new Map<
      string,
      Point
    >();

  groups.forEach(
    (
      group,
      laneIndex,
    ) => {
      group.agents.forEach(
        (
          agent,
          agentIndex,
        ) => {
          positions.set(
            agent.id,
            {
              x:
                LABEL_WIDTH +
                CANVAS_PADDING +
                agentIndex *
                  (
                    NODE_WIDTH +
                    NODE_GAP
                  ),
              y:
                laneIndex *
                  LANE_HEIGHT +
                20,
            },
          );
        },
      );
    },
  );

  return positions;
}

/**
 * Builds a readable connector path between two agent nodes.
 */
function agentPath(
  source: Point,
  target: Point,
  explicit: boolean,
): string {
  if (
    source.x ===
      target.x &&
    source.y ===
      target.y
  ) {
    const right =
      source.x +
      NODE_WIDTH;

    const centerY =
      source.y +
      NODE_HEIGHT / 2;

    return [
      `M ${right} ${centerY}`,
      `C ${right + 55} ${centerY - 45}`,
      `${right + 55} ${centerY + 45}`,
      `${right} ${centerY + 8}`,
    ].join(" ");
  }

  if (!explicit) {
    const startX =
      source.x +
      NODE_WIDTH;

    const startY =
      source.y +
      NODE_HEIGHT / 2;

    const endX =
      target.x;

    const endY =
      target.y +
      NODE_HEIGHT / 2;

    const middle =
      (startX + endX) /
      2;

    return [
      `M ${startX} ${startY}`,
      `C ${middle} ${startY}`,
      `${middle} ${endY}`,
      `${endX} ${endY}`,
    ].join(" ");
  }

  const startX =
    source.x +
    NODE_WIDTH / 2;

  const startY =
    source.y +
    NODE_HEIGHT;

  const endX =
    target.x +
    NODE_WIDTH / 2;

  const endY =
    target.y;

  const bend =
    Math.max(
      28,
      Math.abs(
        endY - startY,
      ) / 2,
    );

  return [
    `M ${startX} ${startY}`,
    `C ${startX} ${startY + bend}`,
    `${endX} ${endY - bend}`,
    `${endX} ${endY}`,
  ].join(" ");
}

/**
 * Builds an explicit route connector from one agent to a terminal pseudo-node.
 */
function terminalPath(
  source: Point,
  target: Point,
): string {
  const startX =
    source.x +
    NODE_WIDTH / 2;

  const startY =
    source.y +
    NODE_HEIGHT;

  const endX =
    target.x +
    NODE_WIDTH / 2;

  const endY =
    target.y;

  const middleY =
    startY +
    Math.max(
      28,
      (
        endY -
        startY
      ) / 2,
    );

  return [
    `M ${startX} ${startY}`,
    `C ${startX} ${middleY}`,
    `${endX} ${middleY}`,
    `${endX} ${endY}`,
  ].join(" ");
}

/**
 * Extracts the unique explicit terminal nodes required by persisted route configuration.
 */
function terminalActionsInUse(
  agents:
    AgentWithRoutes[],
): TerminalAction[] {
  const values =
    new Set<
      TerminalAction
    >();

  for (const agent of agents) {
    for (
      const route of
      agent.routes
    ) {
      if (
        route.terminalAction
      ) {
        values.add(
          route.terminalAction,
        );
      }
    }
  }

  return [
    ...values,
  ].sort();
}

/**
 * Renders the current generic agent configuration as a non-editable layered route diagram.
 */
export function AgentWorkflowView({
  agents,
  selectedAgentId,
  onSelectAgent,
}: AgentWorkflowViewProps) {
  const groups =
    groupAgentsByLayer(
      agents,
    );

  const positions =
    buildAgentPositions(
      groups,
    );

  const edges =
    deriveWorkflowEdges(
      agents,
    );

  const terminals =
    terminalActionsInUse(
      agents,
    );

  const terminalY =
    groups.length *
      LANE_HEIGHT +
    26;

  const terminalPositions =
    new Map<
      TerminalAction,
      Point
    >(
      terminals.map(
        (
          action,
          index,
        ) => [
          action,
          {
            x:
              LABEL_WIDTH +
              CANVAS_PADDING +
              index *
                (
                  NODE_WIDTH +
                  NODE_GAP
                ),
            y:
              terminalY,
          },
        ],
      ),
    );

  const maxLaneAgents =
    Math.max(
      1,
      ...groups.map(
        (group) =>
          group.agents.length,
      ),
      terminals.length,
    );

  const canvasWidth =
    LABEL_WIDTH +
    CANVAS_PADDING * 2 +
    maxLaneAgents *
      NODE_WIDTH +
    Math.max(
      0,
      maxLaneAgents - 1,
    ) *
      NODE_GAP;

  const canvasHeight =
    groups.length *
      LANE_HEIGHT +
    (
      terminals.length > 0
        ? NODE_HEIGHT + 72
        : 24
    );

  return (
    <Card
      size="sm"
      className="min-h-[38rem]"
    >
      <CardHeader className="border-b border-divider">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>
            Workflow /
            Layered Routes
          </CardTitle>

          <div className="flex flex-wrap items-center gap-3 text-[11px] text-text-muted">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-px w-5 bg-text-muted" />
              Normal
            </span>

            <span className="inline-flex items-center gap-1.5">
              <span className="w-5 border-t border-dashed border-status-success" />
              Explicit
            </span>
          </div>
        </div>
      </CardHeader>

      <CardContent className="min-h-0 p-0">
        {agents.length ===
        0 ? (
          <div className="p-8 text-sm text-text-muted">
            No agents are
            configured.
          </div>
        ) : (
          <div className="overflow-auto">
            <div
              className="relative"
              style={{
                width:
                  canvasWidth,
                height:
                  canvasHeight,
                minWidth:
                  canvasWidth,
              }}
            >
              {groups.map(
                (
                  group,
                  laneIndex,
                ) => (
                  <div
                    key={
                      group.layer
                    }
                    className="absolute inset-x-0 border-b border-divider bg-surface-interactive/20"
                    style={{
                      top:
                        laneIndex *
                        LANE_HEIGHT,
                      height:
                        LANE_HEIGHT,
                    }}
                  >
                    <div className="absolute left-3 top-4 w-20">
                      <p className="text-xs font-semibold text-text-primary">
                        Layer{" "}
                        {
                          group.layer
                        }
                      </p>

                      <p className="mt-1 text-[10px] text-text-muted">
                        {
                          group.agents
                            .length
                        }{" "}
                        agent
                        {group.agents
                          .length ===
                        1
                          ? ""
                          : "s"}
                      </p>
                    </div>
                  </div>
                ),
              )}

              <svg
                className="pointer-events-none absolute inset-0 overflow-visible"
                width={
                  canvasWidth
                }
                height={
                  canvasHeight
                }
                aria-hidden="true"
              >
                <defs>
                  <marker
                    id="agent-arrow-neutral"
                    markerWidth="8"
                    markerHeight="8"
                    refX="7"
                    refY="4"
                    orient="auto"
                  >
                    <path
                      d="M 0 0 L 8 4 L 0 8 z"
                      fill="var(--text-muted)"
                    />
                  </marker>

                  <marker
                    id="agent-arrow-success"
                    markerWidth="8"
                    markerHeight="8"
                    refX="7"
                    refY="4"
                    orient="auto"
                  >
                    <path
                      d="M 0 0 L 8 4 L 0 8 z"
                      fill="var(--status-success)"
                    />
                  </marker>

                  <marker
                    id="agent-arrow-warning"
                    markerWidth="8"
                    markerHeight="8"
                    refX="7"
                    refY="4"
                    orient="auto"
                  >
                    <path
                      d="M 0 0 L 8 4 L 0 8 z"
                      fill="var(--status-warning)"
                    />
                  </marker>

                  <marker
                    id="agent-arrow-error"
                    markerWidth="8"
                    markerHeight="8"
                    refX="7"
                    refY="4"
                    orient="auto"
                  >
                    <path
                      d="M 0 0 L 8 4 L 0 8 z"
                      fill="var(--status-error)"
                    />
                  </marker>
                </defs>

                {edges.map(
                  (edge) => {
                    const source =
                      positions.get(
                        edge.sourceAgentId,
                      );

                    if (!source) {
                      return null;
                    }

                    const target =
                      edge.targetAgentId
                        ? positions.get(
                            edge.targetAgentId,
                          )
                        : edge.terminalAction
                          ? terminalPositions.get(
                              edge.terminalAction,
                            )
                          : undefined;

                    if (!target) {
                      return null;
                    }

                    const path =
                      edge.terminalAction
                        ? terminalPath(
                            source,
                            target,
                          )
                        : agentPath(
                            source,
                            target,
                            edge.kind ===
                              "explicit",
                          );

                    const stroke =
                      edge.kind ===
                      "default"
                        ? "var(--text-muted)"
                        : outcomeColor(
                            edge.outcome,
                          );

                    const labelX =
                      (
                        source.x +
                        NODE_WIDTH /
                          2 +
                        target.x +
                        NODE_WIDTH /
                          2
                      ) /
                      2;

                    const labelY =
                      (
                        source.y +
                        NODE_HEIGHT +
                        target.y
                      ) /
                      2;

                    return (
                      <g
                        key={
                          edge.id
                        }
                        opacity={
                          edge.active
                            ? 0.9
                            : 0.3
                        }
                      >
                        <path
                          d={
                            path
                          }
                          fill="none"
                          stroke={
                            stroke
                          }
                          strokeWidth={
                            edge.kind ===
                            "explicit"
                              ? 1.6
                              : 1.2
                          }
                          strokeDasharray={
                            edge.kind ===
                            "explicit"
                              ? "5 5"
                              : undefined
                          }
                          markerEnd={`url(#${markerForEdge(
                            edge,
                          )})`}
                        />

                        {edge.kind ===
                          "explicit" &&
                        edge.outcome ? (
                          <text
                            x={
                              labelX
                            }
                            y={
                              labelY -
                              4
                            }
                            textAnchor="middle"
                            fontSize="10"
                            fill={
                              stroke
                            }
                          >
                            {
                              edge.outcome
                            }
                          </text>
                        ) : null}
                      </g>
                    );
                  },
                )}
              </svg>

              {groups.flatMap(
                (group) =>
                  group.agents,
              ).map(
                (agent) => {
                  const position =
                    positions.get(
                      agent.id,
                    )!;

                  return (
                    <button
                      key={
                        agent.id
                      }
                      type="button"
                      onClick={() =>
                        onSelectAgent(
                          agent.id,
                        )
                      }
                      aria-pressed={
                        selectedAgentId ===
                        agent.id
                      }
                      className={cn(
                        "absolute z-10 flex flex-col items-start justify-center rounded-md border bg-surface-elevated px-3 text-left shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring",
                        selectedAgentId ===
                          agent.id
                          ? "border-status-running ring-1 ring-status-running/30"
                          : "border-border-default hover:border-border-strong hover:bg-surface-interactive",
                        !agent.enabled &&
                          "opacity-45",
                      )}
                      style={{
                        left:
                          position.x,
                        top:
                          position.y,
                        width:
                          NODE_WIDTH,
                        height:
                          NODE_HEIGHT,
                      }}
                    >
                      <span className="max-w-full truncate text-xs font-medium text-text-primary">
                        {
                          agent.name
                        }
                      </span>

                      <span className="mt-1 font-mono text-[10px] text-text-muted">
                        L
                        {
                          agent.layer
                        }.
                        {
                          agent.executionOrder
                        }
                      </span>
                    </button>
                  );
                },
              )}

              {terminals.map(
                (action) => {
                  const position =
                    terminalPositions.get(
                      action,
                    )!;

                  const variant =
                    action ===
                    "fail_run"
                      ? "error"
                      : action ===
                          "block_run"
                        ? "warning"
                        : "success";

                  return (
                    <div
                      key={
                        action
                      }
                      className="absolute z-10 flex items-center justify-center rounded-md border border-border-default bg-surface-elevated"
                      style={{
                        left:
                          position.x,
                        top:
                          position.y,
                        width:
                          NODE_WIDTH,
                        height:
                          NODE_HEIGHT,
                      }}
                    >
                      <Badge
                        variant={
                          variant
                        }
                      >
                        {formatIdentifier(
                          action,
                        )}
                      </Badge>
                    </div>
                  );
                },
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
