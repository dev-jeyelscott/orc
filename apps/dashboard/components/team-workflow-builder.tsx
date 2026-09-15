"use client";

import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  AlertTriangleIcon,
  MenuIcon,
  PanelRightIcon,
  RefreshCwIcon,
  SendIcon,
  Trash2Icon,
  WandSparklesIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  Agent,
  AgentRouteOutcome,
  Department,
  Skill,
  Team,
  WorkflowAggregate,
  WorkflowGraph,
  WorkflowGraphEdge,
  WorkflowGraphNode,
  WorkflowValidationResult,
} from "@orc/shared";

import { AgentConfigDrawer } from "@/components/agent-config-drawer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Spinner } from "@/components/ui/spinner";
import { getAgents } from "@/lib/agents";
import { getDepartments } from "@/lib/departments";
import { getSkills } from "@/lib/skills";
import { getTeamMembers } from "@/lib/team-membership";
import { getTeams } from "@/lib/teams";
import {
  getPublishedRevision,
  getWorkflowAggregate,
  publishWorkflowDraft,
  saveWorkflowDraft,
} from "@/lib/workflow-graph";
import {
  autoLayoutGraph,
  availableOutcomesForNewEdge,
  boundedPosition,
  buildPaletteAgents,
  canAddAgentNode,
  type AgentGraphNode,
} from "@/lib/workflow-graph-draft";

import { AgentNode, type AgentNodeData } from "@/components/workflow-builder/agent-node";
import { AgentPalette } from "@/components/workflow-builder/agent-palette";
import { EdgeOutcomePicker } from "@/components/workflow-builder/edge-outcome-picker";
import { NodeInspector } from "@/components/workflow-builder/node-inspector";
import { OutcomeEdge, type OutcomeEdgeData } from "@/components/workflow-builder/outcome-edge";
import { RevisionHistory } from "@/components/workflow-builder/revision-history";
import { StartNode } from "@/components/workflow-builder/start-node";
import { TerminalNode, type TerminalNodeData } from "@/components/workflow-builder/terminal-node";
import { ValidationPanel } from "@/components/workflow-builder/validation-panel";

const nodeTypes = {
  start: StartNode,
  agent: AgentNode,
  terminal: TerminalNode,
};

const edgeTypes = {
  outcome: OutcomeEdge,
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to load workflow";
}

function graphNodeToFlowNode(
  node: WorkflowGraphNode,
  agentsById: ReadonlyMap<string, Agent>,
): Node {
  if (node.kind === "start") {
    return { id: node.id, type: "start", position: node.position, data: {}, deletable: false };
  }

  if (node.kind === "terminal") {
    const data: TerminalNodeData = { terminalAction: node.terminalAction };
    return { id: node.id, type: "terminal", position: node.position, data, deletable: false };
  }

  const data: AgentNodeData = {
    agentId: node.agentId,
    agent: agentsById.get(node.agentId) ?? null,
    invalid: !agentsById.has(node.agentId),
  };

  return { id: node.id, type: "agent", position: node.position, data };
}

function graphEdgeToFlowEdge(edge: WorkflowGraphEdge): Edge {
  const data: OutcomeEdgeData = { outcome: edge.outcome };

  return {
    id: edge.id,
    source: edge.sourceNodeId,
    target: edge.targetNodeId,
    type: "outcome",
    data,
    deletable: true,
  };
}

function flowToGraph(nodes: readonly Node[], edges: readonly Edge[]): WorkflowGraph {
  return {
    nodes: nodes.map((node): WorkflowGraphNode => {
      const position = boundedPosition(node.position.x, node.position.y);

      if (node.type === "start") {
        return { id: node.id, kind: "start", position };
      }

      if (node.type === "terminal") {
        return {
          id: node.id,
          kind: "terminal",
          terminalAction: (node.data as TerminalNodeData).terminalAction,
          position,
        };
      }

      return {
        id: node.id,
        kind: "agent",
        agentId: (node.data as AgentNodeData).agentId,
        position,
      };
    }),
    edges: edges.map((edge) => ({
      id: edge.id,
      sourceNodeId: edge.source,
      targetNodeId: edge.target,
      outcome: (edge.data as OutcomeEdgeData | undefined)?.outcome ?? null,
    })),
  };
}

function BuilderInner({ team }: { team: Team }) {
  const { screenToFlowPosition } = useReactFlow();

  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [aggregate, setAggregate] = useState<WorkflowAggregate | null>(null);
  const [validation, setValidation] = useState<WorkflowValidationResult>({
    errors: [],
    warnings: [],
    publishable: false,
  });

  const [teamAgents, setTeamAgents] = useState<Agent[]>([]);
  const [allAgents, setAllAgents] = useState<Agent[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);

  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [confirmPublishOpen, setConfirmPublishOpen] = useState(false);

  const [selectedRevision, setSelectedRevision] = useState<"draft" | string>("draft");
  const [readOnlyGraph, setReadOnlyGraph] = useState<WorkflowGraph | null>(null);
  const [readOnlyLoading, setReadOnlyLoading] = useState(false);

  const [selection, setSelection] = useState<{ kind: "node" | "edge"; id: string } | null>(null);
  const [pendingConnection, setPendingConnection] = useState<Connection | null>(null);
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);

  const [paletteSheetOpen, setPaletteSheetOpen] = useState(false);
  const [inspectorSheetOpen, setInspectorSheetOpen] = useState(false);
  const [isDesktopLayout, setIsDesktopLayout] = useState(true);

  useEffect(() => {
    const query = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsDesktopLayout(query.matches);

    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  const readOnly = selectedRevision !== "draft";

  const agentsById = useMemo(() => new Map(allAgents.map((agent) => [agent.id, agent])), [allAgents]);

  const load = useCallback(async () => {
    setStatus("loading");
    setError(null);

    try {
      const [nextAggregate, nextMembers, nextAgents, nextDepartments, nextTeams, nextSkills] =
        await Promise.all([
          getWorkflowAggregate(team.id),
          getTeamMembers(team.id),
          getAgents(),
          getDepartments(),
          getTeams(),
          getSkills(),
        ]);

      setAggregate(nextAggregate);
      setValidation(nextAggregate.validation);
      setTeamAgents(nextMembers.members.map((member) => member.agent));
      setAllAgents(nextAgents);
      setDepartments(nextDepartments);
      setTeams(nextTeams);
      setSkills(nextSkills);

      const agentsMap = new Map(nextAgents.map((agent) => [agent.id, agent]));
      setNodes(nextAggregate.draft.graph.nodes.map((node) => graphNodeToFlowNode(node, agentsMap)));
      setEdges(nextAggregate.draft.graph.edges.map(graphEdgeToFlowEdge));
      setDirty(false);
      setStatus("loaded");
    } catch (caught) {
      setError(errorMessage(caught));
      setStatus("error");
    }
  }, [team.id]);

  useEffect(() => {
    queueMicrotask(() => {
      void load();
    });
  }, [load]);

  useEffect(() => {
    if (selectedRevision === "draft") {
      return;
    }

    let cancelled = false;

    queueMicrotask(() => {
      if (cancelled) return;
      setReadOnlyLoading(true);

      void getPublishedRevision(team.id, selectedRevision)
        .then((revision) => {
          if (!cancelled) {
            setReadOnlyGraph(revision.graph);
          }
        })
        .catch((caught: unknown) => {
          if (!cancelled) {
            setError(errorMessage(caught));
          }
        })
        .finally(() => {
          if (!cancelled) {
            setReadOnlyLoading(false);
          }
        });
    });

    return () => {
      cancelled = true;
    };
  }, [selectedRevision, team.id]);

  const activeNodes = useMemo(() => {
    if (!readOnly) return nodes;
    if (!readOnlyGraph) return [];
    return readOnlyGraph.nodes.map((node) => graphNodeToFlowNode(node, agentsById));
  }, [readOnly, readOnlyGraph, nodes, agentsById]);

  const activeEdges = useMemo(() => {
    if (!readOnly) return edges;
    if (!readOnlyGraph) return [];
    return readOnlyGraph.edges.map(graphEdgeToFlowEdge);
  }, [readOnly, readOnlyGraph, edges]);

  const placedAgentIds = useMemo(
    () => new Set(nodes.filter((node) => node.type === "agent").map((node) => (node.data as AgentNodeData).agentId)),
    [nodes],
  );

  const paletteAgents = useMemo(
    () => buildPaletteAgents(teamAgents, flowToGraph(nodes, edges)),
    [teamAgents, nodes, edges],
  );

  const labelForNode = useCallback(
    (nodeId: string): string => {
      const node = activeNodes.find((candidate) => candidate.id === nodeId);
      if (!node) return "Unknown";
      if (node.type === "start") return "Start";
      if (node.type === "terminal") {
        return (node.data as TerminalNodeData).terminalAction.replace("_", " ");
      }
      const agentData = node.data as AgentNodeData;
      return agentData.agent?.name ?? "Unavailable Agent";
    },
    [activeNodes],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      if (readOnly) {
        setNodes((current) =>
          applyNodeChanges(
            changes.filter((change) => change.type === "select"),
            current,
          ),
        );
        return;
      }

      setNodes((current) => applyNodeChanges(changes, current));

      if (changes.some((change) => change.type === "position" && change.dragging === false)) {
        setDirty(true);
      }

      if (changes.some((change) => change.type === "remove")) {
        setDirty(true);
      }

      const selectChange = changes.find((change) => change.type === "select" && change.selected);
      if (selectChange && selectChange.type === "select") {
        setSelection({ kind: "node", id: selectChange.id });
        if (!isDesktopLayout) setInspectorSheetOpen(true);
      }
    },
    [readOnly, isDesktopLayout],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      if (readOnly) {
        setEdges((current) =>
          applyEdgeChanges(
            changes.filter((change) => change.type === "select"),
            current,
          ),
        );
        return;
      }

      setEdges((current) => applyEdgeChanges(changes, current));

      if (changes.some((change) => change.type === "remove")) {
        setDirty(true);
      }

      const selectChange = changes.find((change) => change.type === "select" && change.selected);
      if (selectChange && selectChange.type === "select") {
        setSelection({ kind: "edge", id: selectChange.id });
        if (!isDesktopLayout) setInspectorSheetOpen(true);
      }
    },
    [readOnly, isDesktopLayout],
  );

  const isValidConnection = useCallback(
    (connection: Connection | Edge): boolean => {
      const sourceNode = nodes.find((node) => node.id === connection.source);
      const targetNode = nodes.find((node) => node.id === connection.target);

      if (!sourceNode || !targetNode) return false;
      if (targetNode.type === "start") return false;
      if (sourceNode.type === "terminal") return false;
      if (sourceNode.type === "start" && targetNode.type !== "agent") return false;

      return true;
    },
    [nodes],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (readOnly) return;

      const sourceNode = nodes.find((node) => node.id === connection.source);

      if (sourceNode?.type === "start") {
        setEdges((current) => {
          const withoutOldStartEdge = current.filter((edge) => edge.source !== connection.source);
          const data: OutcomeEdgeData = { outcome: null };
          return addEdge({ ...connection, id: crypto.randomUUID(), type: "outcome", data }, withoutOldStartEdge);
        });
        setDirty(true);
        return;
      }

      setPendingConnection(connection);
    },
    [nodes, readOnly],
  );

  const pendingOutcomeChoices = useMemo(() => {
    if (!pendingConnection?.source) return [];
    return availableOutcomesForNewEdge(pendingConnection.source, flowToGraph(nodes, edges));
  }, [pendingConnection, nodes, edges]);

  function pickPendingOutcome(outcome: AgentRouteOutcome) {
    if (!pendingConnection) return;

    setEdges((current) => {
      const data: OutcomeEdgeData = { outcome };
      return addEdge({ ...pendingConnection, id: crypto.randomUUID(), type: "outcome", data }, current);
    });
    setDirty(true);
    setPendingConnection(null);
  }

  function insertAgentNode(agentId: string, position?: { x: number; y: number }) {
    if (readOnly) return;
    if (!canAddAgentNode(agentId, flowToGraph(nodes, edges))) return;

    const agentNodeCount = nodes.filter((node) => node.type === "agent").length;
    const fallbackPosition = { x: 240 + agentNodeCount * 240, y: 0 };
    const resolved = boundedPosition(
      (position ?? fallbackPosition).x,
      (position ?? fallbackPosition).y,
    );

    const data: AgentNodeData = {
      agentId,
      agent: agentsById.get(agentId) ?? null,
      invalid: false,
    };

    setNodes((current) => [
      ...current,
      { id: crypto.randomUUID(), type: "agent", position: resolved, data },
    ]);
    setDirty(true);
  }

  function deleteSelectedEdge() {
    if (!selection || selection.kind !== "edge" || readOnly) return;
    setEdges((current) => current.filter((edge) => edge.id !== selection.id));
    setSelection(null);
    setDirty(true);
  }

  function focusTarget(target: { kind: "node"; id: string } | { kind: "edge"; id: string }) {
    setSelection(target);
    if (!isDesktopLayout) setInspectorSheetOpen(true);

    if (target.kind === "node") {
      setNodes((current) => current.map((node) => ({ ...node, selected: node.id === target.id })));
      setEdges((current) => current.map((edge) => ({ ...edge, selected: false })));
    } else {
      setEdges((current) => current.map((edge) => ({ ...edge, selected: edge.id === target.id })));
      setNodes((current) => current.map((node) => ({ ...node, selected: false })));
    }
  }

  function applyAutoLayout() {
    if (readOnly) return;
    const laidOut = autoLayoutGraph(flowToGraph(nodes, edges));
    setNodes(laidOut.nodes.map((node) => graphNodeToFlowNode(node, agentsById)));
    setDirty(true);
  }

  async function save() {
    setSaving(true);
    setSaveError(null);

    try {
      const result = await saveWorkflowDraft(team.id, flowToGraph(nodes, edges));
      setValidation(result.validation);
      setNodes(result.draft.graph.nodes.map((node) => graphNodeToFlowNode(node, agentsById)));
      setEdges(result.draft.graph.edges.map(graphEdgeToFlowEdge));
      setDirty(false);
    } catch (caught) {
      setSaveError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    setPublishing(true);
    setPublishError(null);

    try {
      const result = await publishWorkflowDraft(team.id);
      setValidation(result.validation);
      const nextAggregate = await getWorkflowAggregate(team.id);
      setAggregate(nextAggregate);
      setConfirmPublishOpen(false);
    } catch (caught) {
      setPublishError(errorMessage(caught));

      const withValidation = caught as { validation?: WorkflowValidationResult };
      if (withValidation.validation) {
        setValidation(withValidation.validation);
      }
    } finally {
      setPublishing(false);
    }
  }

  const selectedAgentNode = useMemo(() => {
    if (!selection || selection.kind !== "node") return null;
    const node = activeNodes.find((candidate) => candidate.id === selection.id);
    if (!node || node.type !== "agent") return null;
    return node;
  }, [selection, activeNodes]);

  const selectedEdge = useMemo(() => {
    if (!selection || selection.kind !== "edge") return null;
    return activeEdges.find((candidate) => candidate.id === selection.id) ?? null;
  }, [selection, activeEdges]);

  const editingAgent = editingAgentId ? (agentsById.get(editingAgentId) ?? null) : null;

  if (status === "loading") {
    return (
      <Empty className="min-h-[32rem] border border-border-default bg-surface-elevated">
        <Spinner className="size-6" />
        <EmptyTitle>Loading workflow...</EmptyTitle>
      </Empty>
    );
  }

  if (status === "error" || !aggregate) {
    return (
      <Empty className="min-h-[32rem] border border-border-default bg-surface-elevated">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <AlertTriangleIcon />
          </EmptyMedia>
          <EmptyTitle>Workflow unavailable</EmptyTitle>
          <EmptyDescription>{error}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button type="button" variant="outline" onClick={() => void load()}>
            <RefreshCwIcon />
            Retry
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  const inspectorContent = selectedAgentNode ? (
    <NodeInspector
      node={{
        id: selectedAgentNode.id,
        kind: "agent",
        agentId: (selectedAgentNode.data as AgentNodeData).agentId,
        position: selectedAgentNode.position,
      } satisfies AgentGraphNode}
      agent={(selectedAgentNode.data as AgentNodeData).agent}
      graph={flowToGraph(activeNodes, activeEdges)}
      labelForNode={labelForNode}
      readOnly={readOnly}
      onEditAgent={() => setEditingAgentId((selectedAgentNode.data as AgentNodeData).agentId)}
      onSelectOutcomeRow={(edgeId) => {
        if (edgeId) focusTarget({ kind: "edge", id: edgeId });
      }}
    />
  ) : selectedEdge ? (
    <div className="flex flex-col gap-3">
      <div className="text-xs text-text-secondary">
        <p>
          <span className="font-medium text-text-primary">Source:</span> {labelForNode(selectedEdge.source)}
        </p>
        <p>
          <span className="font-medium text-text-primary">Outcome:</span>{" "}
          {(selectedEdge.data as OutcomeEdgeData | undefined)?.outcome ?? "(Start connection)"}
        </p>
        <p>
          <span className="font-medium text-text-primary">Target:</span> {labelForNode(selectedEdge.target)}
        </p>
      </div>

      {!readOnly ? (
        <Button type="button" variant="outline" size="sm" onClick={deleteSelectedEdge}>
          <Trash2Icon />
          Delete Edge
        </Button>
      ) : null}
    </div>
  ) : (
    <p className="text-xs text-text-muted">Select an Agent node or a connection to inspect it.</p>
  );

  const validationContent = <ValidationPanel validation={validation} onFocusIssue={focusTarget} />;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border-default bg-surface-elevated px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-text-primary">Workflow</span>

          {readOnly ? (
            <Badge variant="outline">Published v{
              aggregate.publishedRevisionHistory.find((rev) => rev.id === selectedRevision)?.version ?? "?"
            } · Read-only</Badge>
          ) : (
            <Badge variant={dirty ? "outline" : "success"}>{dirty ? "Draft · Unsaved" : "Draft · Saved"}</Badge>
          )}

          {aggregate.published ? (
            <span className="text-xs text-text-muted">Latest published: v{aggregate.published.version}</span>
          ) : (
            <span className="text-xs text-text-muted">Never published</span>
          )}

          {validation.errors.length > 0 ? (
            <Badge variant="destructive">{validation.errors.length} error{validation.errors.length === 1 ? "" : "s"}</Badge>
          ) : null}
          {validation.warnings.length > 0 ? (
            <Badge variant="warning">{validation.warnings.length} warning{validation.warnings.length === 1 ? "" : "s"}</Badge>
          ) : null}

          <RevisionHistory
            publishedRevisions={aggregate.publishedRevisionHistory}
            selected={selectedRevision}
            onSelect={setSelectedRevision}
          />
        </div>

        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" className="lg:hidden" onClick={() => setPaletteSheetOpen(true)}>
            <MenuIcon />
            Agents
          </Button>
          <Button type="button" variant="outline" size="sm" className="lg:hidden" onClick={() => setInspectorSheetOpen(true)}>
            <PanelRightIcon />
            Inspect
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={readOnly} onClick={applyAutoLayout}>
            <WandSparklesIcon />
            Auto arrange
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={readOnly || saving || !dirty} onClick={() => void save()}>
            {saving ? <Spinner className="size-4" /> : null}
            Save Draft
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={readOnly || publishing || !validation.publishable}
            onClick={() => setConfirmPublishOpen(true)}
          >
            <SendIcon />
            Publish
          </Button>
        </div>
      </div>

      {saveError ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {saveError}
        </p>
      ) : null}
      {publishError ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {publishError}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[16rem_1fr_18rem]">
        <div className="hidden rounded-md border border-border-default bg-surface-elevated p-2 lg:block">
          <AgentPalette
            agents={paletteAgents}
            placedAgentIds={placedAgentIds}
            hasTeamMembers={teamAgents.length > 0}
            onInsert={(agentId) => insertAgentNode(agentId)}
            disabled={readOnly}
          />
        </div>

        <div
          className="agents-react-flow relative h-[36rem] overflow-hidden rounded-md border border-border-default bg-bg-app"
          onDragOver={(event) => {
            if (readOnly) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
          }}
          onDrop={(event) => {
            if (readOnly) return;
            const agentId = event.dataTransfer.getData("application/x-orc-agent-id");
            if (!agentId) return;
            event.preventDefault();
            const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
            insertAgentNode(agentId, position);
          }}
        >
          {readOnlyLoading ? (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-bg-app/70">
              <Spinner className="size-6" />
            </div>
          ) : null}

          <ReactFlow
            nodes={activeNodes}
            edges={activeEdges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            isValidConnection={isValidConnection}
            nodesDraggable={!readOnly}
            nodesConnectable={!readOnly}
            elementsSelectable
            deleteKeyCode={readOnly ? null : ["Backspace", "Delete"]}
            fitView
          >
            <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
            <Controls />
            <MiniMap pannable zoomable className="!bg-surface-elevated" />
          </ReactFlow>
        </div>

        <div className="hidden flex-col gap-4 rounded-md border border-border-default bg-surface-elevated p-3 lg:flex">
          <div>
            <h3 className="mb-2 text-xs font-medium text-text-secondary">Inspector</h3>
            {inspectorContent}
          </div>
          <div>
            <h3 className="mb-2 text-xs font-medium text-text-secondary">Validation</h3>
            {validationContent}
          </div>
        </div>
      </div>

      <Sheet open={paletteSheetOpen} onOpenChange={setPaletteSheetOpen}>
        <SheetContent side="left">
          <SheetHeader>
            <SheetTitle>Agents</SheetTitle>
          </SheetHeader>
          <div className="px-4 pb-4">
            <AgentPalette
              agents={paletteAgents}
              placedAgentIds={placedAgentIds}
              hasTeamMembers={teamAgents.length > 0}
              onInsert={(agentId) => {
                insertAgentNode(agentId);
                setPaletteSheetOpen(false);
              }}
              disabled={readOnly}
            />
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={inspectorSheetOpen} onOpenChange={setInspectorSheetOpen}>
        <SheetContent side="right">
          <SheetHeader>
            <SheetTitle>Inspector</SheetTitle>
          </SheetHeader>
          <div className="flex flex-col gap-4 px-4 pb-4">
            {inspectorContent}
            <div>
              <h3 className="mb-2 text-xs font-medium text-text-secondary">Validation</h3>
              {validationContent}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <EdgeOutcomePicker
        open={pendingConnection !== null}
        availableOutcomes={pendingOutcomeChoices}
        onPick={pickPendingOutcome}
        onCancel={() => setPendingConnection(null)}
      />

      <AlertDialog open={confirmPublishOpen} onOpenChange={setConfirmPublishOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Publish this workflow?</AlertDialogTitle>
            <AlertDialogDescription>
              Publishing creates immutable Published version{" "}
              {(aggregate.published?.version ?? 0) + 1}. Active Runs stay on their own snapshot;
              future Runs use this new revision.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={publishing}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={publishing} onClick={() => void publish()}>
              {publishing ? <Spinner className="size-4" /> : null}
              Publish
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {editingAgent ? (
        <AgentConfigDrawer
          agent={editingAgent}
          departments={departments}
          teams={teams}
          skills={skills}
          onOpenChange={(open) => {
            if (!open) setEditingAgentId(null);
          }}
          onRefresh={async () => {
            await load();
          }}
        />
      ) : null}
    </div>
  );
}

/** Editable Draft/Published workflow graph builder for the Team detail Workflow tab. */
export function TeamWorkflowBuilder({ team }: { team: Team }) {
  return (
    <ReactFlowProvider>
      <BuilderInner team={team} />
    </ReactFlowProvider>
  );
}
