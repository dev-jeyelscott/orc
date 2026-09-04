"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
} from "react";
import {
  AlertTriangleIcon,
  BotIcon,
  CheckIcon,
  XIcon,
} from "lucide-react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  useReactFlow,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";

import type {
  AgentWithRoutes,
  TerminalAction,
} from "@orc/shared";

import {
  deriveWorkflowEdges,
  formatIdentifier,
} from "@/lib/agent-presentation";
import {
  AGENT_NODE_HEIGHT,
  AGENT_NODE_WIDTH,
  TERMINAL_NODE_HEIGHT,
  TERMINAL_NODE_WIDTH,
  buildAgentWorkflowLayout,
  type AgentWorkflowAgentNode,
  type AgentWorkflowGraphEdge,
  type AgentWorkflowTerminalNode,
} from "@/lib/agent-workflow-layout";
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

type AgentWorkflowViewProps = {
  agents:
    AgentWithRoutes[];
  selectedAgentId:
    string | null;
  activeAgentId?:
    string | null;
  onSelectAgent:
    (agentId: string) => void;
};

type WorkflowInteractionContextValue = {
  selectedAgentId:
    string | null;
  activeAgentId:
    string | null;
  onSelectAgent:
    (agentId: string) => void;
};

const WorkflowInteractionContext =
  createContext<WorkflowInteractionContextValue | null>(
    null,
  );

/**
 * Returns workflow interaction state for custom nodes rendered inside the graph.
 */
function useWorkflowInteraction(): WorkflowInteractionContextValue {
  const value =
    useContext(
      WorkflowInteractionContext,
    );

  if (!value) {
    throw new Error(
      "Workflow nodes must render inside AgentWorkflowView",
    );
  }

  return value;
}

/**
 * Renders one generic worker-agent graph node without role-specific behavior.
 */
function AgentNode({
  data,
}: NodeProps<AgentWorkflowAgentNode>) {
  const {
    selectedAgentId,
    activeAgentId,
    onSelectAgent,
  } =
    useWorkflowInteraction();

  const agent =
    data.agent;

  const selected =
    selectedAgentId ===
    agent.id;

  const active =
    activeAgentId ===
    agent.id;

  return (
    <>
      <Handle
        id="top-target"
        type="target"
        position={
          Position.Top
        }
        isConnectable={
          false
        }
        className="pointer-events-none !size-2 !border-0 !bg-transparent !opacity-0"
      />

      <Handle
        id="left-target"
        type="target"
        position={
          Position.Left
        }
        isConnectable={
          false
        }
        className="pointer-events-none !size-2 !border-0 !bg-transparent !opacity-0"
      />

      <Handle
        id="right-target"
        type="target"
        position={
          Position.Right
        }
        isConnectable={
          false
        }
        style={{
          top: "38%",
        }}
        className="pointer-events-none !size-2 !border-0 !bg-transparent !opacity-0"
      />

      <Handle
        id="right-source"
        type="source"
        position={
          Position.Right
        }
        isConnectable={
          false
        }
        style={{
          top: "62%",
        }}
        className="pointer-events-none !size-2 !border-0 !bg-transparent !opacity-0"
      />

      <Handle
        id="bottom-source"
        type="source"
        position={
          Position.Bottom
        }
        isConnectable={
          false
        }
        className="pointer-events-none !size-2 !border-0 !bg-transparent !opacity-0"
      />

      <button
        type="button"
        onClick={() =>
          onSelectAgent(
            agent.id,
          )
        }
        aria-pressed={
          selected
        }
        aria-label={`${agent.name}. ${agent.role}. Layer ${agent.layer}, order ${agent.executionOrder}. ${agent.enabled ? "Enabled" : "Disabled"}.`}
        className={cn(
          "nodrag nopan flex text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring",
          "rounded-lg border bg-surface-elevated shadow-xs",
          selected
            ? "border-status-running ring-1 ring-status-running/30"
            : "border-border-default hover:border-border-strong hover:bg-surface-interactive",
          !agent.enabled &&
            "opacity-70",
        )}
        style={{
          width:
            AGENT_NODE_WIDTH,
          minHeight:
            AGENT_NODE_HEIGHT,
        }}
      >
        <span className="flex w-full min-w-0 gap-2.5 p-2.5">
          <span
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-md",
              selected
                ? "bg-status-running/15 text-status-running"
                : "bg-brand-accent/10 text-brand-accent",
            )}
            aria-hidden="true"
          >
            <BotIcon className="size-4" />
          </span>

          <span className="min-w-0 flex-1">
            <span className="flex items-start justify-between gap-2">
              <span className="min-w-0">
                <span className="block truncate text-xs font-semibold text-text-primary">
                  {
                    agent.name
                  }
                </span>

                <span className="mt-0.5 block truncate text-[10px] text-text-muted">
                  {
                    agent.role
                  }
                </span>
              </span>

              <Badge
                variant={
                  agent.enabled
                    ? active
                      ? "running"
                      : "success"
                    : "disabled"
                }
                className="h-4 px-1.5 text-[9px]"
              >
                {agent.enabled
                  ? active
                    ? "Active"
                    : "Enabled"
                  : "Disabled"}
              </Badge>
            </span>

            <span className="mt-2 flex min-w-0 items-center gap-1.5 text-[9px] text-text-muted">
              <span className="shrink-0 rounded-sm bg-surface-interactive px-1.5 py-0.5">
                Layer{" "}
                {
                  agent.layer
                }{" "}
                · #
                {
                  agent.executionOrder
                }
              </span>

              <span className="shrink-0 rounded-sm bg-surface-interactive px-1.5 py-0.5 font-mono">
                {
                  agent.harness
                }
              </span>

              <span
                title={
                  agent.model
                }
                className="min-w-0 truncate rounded-sm bg-surface-interactive px-1.5 py-0.5 font-mono"
              >
                {
                  agent.model
                }
              </span>
            </span>
          </span>
        </span>
      </button>
    </>
  );
}

/**
 * Returns the semantic badge variant for a workflow terminal action.
 */
function terminalVariant(
  action:
    TerminalAction,
):
  | "success"
  | "warning"
  | "error" {
  switch (action) {
    case "complete_run":
      return "success";

    case "block_run":
      return "warning";

    case "fail_run":
    default:
      return "error";
  }
}

/**
 * Returns the concise operator description for a workflow terminal action.
 */
function terminalDescription(
  action:
    TerminalAction,
): string {
  switch (action) {
    case "complete_run":
      return "Run completes successfully";

    case "block_run":
      return "Run stops as blocked";

    case "fail_run":
    default:
      return "Run stops as failed";
  }
}

/**
 * Renders one non-selectable terminal destination node.
 */
function TerminalNode({
  data,
}: NodeProps<AgentWorkflowTerminalNode>) {
  const action =
    data.terminalAction;

  const variant =
    terminalVariant(
      action,
    );

  return (
    <>
      <Handle
        id="top-target"
        type="target"
        position={
          Position.Top
        }
        isConnectable={
          false
        }
        className="pointer-events-none !size-2 !border-0 !bg-transparent !opacity-0"
      />

      <div
        className={cn(
          "flex items-center gap-2.5 rounded-lg border bg-surface-elevated p-2.5 shadow-xs",
          variant ===
            "success" &&
            "border-status-success/60",
          variant ===
            "warning" &&
            "border-status-warning/60",
          variant ===
            "error" &&
            "border-status-error/60",
        )}
        style={{
          width:
            TERMINAL_NODE_WIDTH,
          minHeight:
            TERMINAL_NODE_HEIGHT,
        }}
      >
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-full",
            variant ===
              "success" &&
              "bg-status-success/15 text-status-success",
            variant ===
              "warning" &&
              "bg-status-warning/15 text-status-warning",
            variant ===
              "error" &&
              "bg-status-error/15 text-status-error",
          )}
          aria-hidden="true"
        >
          {variant ===
          "success" ? (
            <CheckIcon className="size-4" />
          ) : variant ===
            "warning" ? (
            <AlertTriangleIcon className="size-4" />
          ) : (
            <XIcon className="size-4" />
          )}
        </span>

        <span className="min-w-0">
          <span className="block text-xs font-semibold text-text-primary">
            {formatIdentifier(
              action,
            )}
          </span>

          <span className="mt-0.5 block text-[9px] text-text-muted">
            {terminalDescription(
              action,
            )}
          </span>
        </span>
      </div>
    </>
  );
}

const nodeTypes: NodeTypes = {
  agent:
    AgentNode,
  terminal:
    TerminalNode,
};

/**
 * Refits the graph after persisted topology or configured layer placement changes.
 */
function FitViewOnChange({
  topologyKey,
}: {
  topologyKey: string;
}) {
  const {
    fitView,
  } =
    useReactFlow();

  useEffect(() => {
    const frame =
      requestAnimationFrame(
        () => {
          void fitView({
            padding:
              0.16,
            maxZoom:
              1.15,
            duration:
              0,
          });
        },
      );

    return () =>
      cancelAnimationFrame(
        frame,
      );
  }, [
    fitView,
    topologyKey,
  ]);

  return null;
}

/**
 * Renders the configured workflow as a read-only, navigable React Flow graph.
 */
export function AgentWorkflowView({
  agents,
  selectedAgentId,
  activeAgentId = null,
  onSelectAgent,
}: AgentWorkflowViewProps) {
  const workflowEdges =
    useMemo(
      () =>
        deriveWorkflowEdges(
          agents,
        ),
      [agents],
    );

  const layout =
    useMemo(
      () =>
        buildAgentWorkflowLayout(
          agents,
          workflowEdges,
        ),
      [
        agents,
        workflowEdges,
      ],
    );

  const renderedEdges =
    useMemo(
      () =>
        layout.edges.map(
          (
            edge,
          ): AgentWorkflowGraphEdge => ({
            ...edge,
            markerEnd: {
              type:
                MarkerType.ArrowClosed,
              color:
                edge.data
                  ?.color ??
                "var(--text-muted)",
              width: 14,
              height: 14,
            },
          }),
        ),
      [layout.edges],
    );

  const viewportHeight =
    Math.min(
      576,
      Math.max(
        352,
        Math.ceil(
          layout.contentHeight,
        ),
      ),
    );

  const interaction =
    useMemo(
      () => ({
        selectedAgentId,
        activeAgentId,
        onSelectAgent,
      }),
      [
        selectedAgentId,
        activeAgentId,
        onSelectAgent,
      ],
    );

  return (
    <Card
      size="sm"
      className="min-w-0 self-start"
    >
      <CardHeader className="border-b border-divider">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>
            Workflow /
            Layered Routes
          </CardTitle>

          <div className="flex flex-wrap items-center gap-3 text-[10px] text-text-muted">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-px w-5 bg-text-muted" />
              Normal route
            </span>

            <span className="inline-flex items-center gap-1.5">
              <span className="w-5 border-t border-dashed border-status-success" />
              Explicit route
            </span>

            <span className="inline-flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-status-success" />
              Approved
            </span>

            <span className="inline-flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-status-warning" />
              Blocked
            </span>

            <span className="inline-flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-status-error" />
              Failed
            </span>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {agents.length ===
        0 ? (
          <div className="p-8 text-center text-sm text-text-muted">
            No agents are
            configured.
          </div>
        ) : (
          <WorkflowInteractionContext.Provider
            value={
              interaction
            }
          >
            <div
              className="agents-react-flow w-full overflow-hidden bg-bg-app/30"
              style={{
                height:
                  viewportHeight,
              }}
            >
              <ReactFlow
                nodes={
                  layout.nodes
                }
                edges={
                  renderedEdges
                }
                nodeTypes={
                  nodeTypes
                }
                fitView
                fitViewOptions={{
                  padding:
                    0.16,
                  maxZoom:
                    1.15,
                }}
                minZoom={
                  0.4
                }
                maxZoom={
                  1.5
                }
                nodesDraggable={
                  false
                }
                nodesConnectable={
                  false
                }
                elementsSelectable={
                  false
                }
                edgesFocusable={
                  false
                }
                panOnDrag
                zoomOnScroll
                zoomOnPinch
                zoomOnDoubleClick={
                  false
                }
                deleteKeyCode={
                  null
                }
                selectionKeyCode={
                  null
                }
                multiSelectionKeyCode={
                  null
                }
                defaultEdgeOptions={{
                  animated:
                    false,
                }}
              >
                <Background
                  variant={
                    BackgroundVariant.Dots
                  }
                  gap={
                    22
                  }
                  size={
                    1
                  }
                  color="var(--divider)"
                />

                <Controls
                  showInteractive={
                    false
                  }
                />

                <FitViewOnChange
                  topologyKey={
                    layout.topologyKey
                  }
                />
              </ReactFlow>
            </div>
          </WorkflowInteractionContext.Provider>
        )}
      </CardContent>
    </Card>
  );
}
