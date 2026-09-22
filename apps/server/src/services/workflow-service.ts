import {
  and,
  asc,
  desc,
  eq,
  inArray,
  sql,
} from "drizzle-orm";

import {
  agentResultSchema,
  knowledgeRefCollectionSchema,
  MAX_KNOWLEDGE_REFS,
  uploadedProjectDocumentContextCollectionSchema,
  type AgentExecution,
  type AgentResult,
  type AgentResultStatus,
  type CreateTask,
  type KnowledgeCategory,
  type KnowledgeRef,
  type KnowledgeRequirement,
  type RetryRun,
  type Run,
  type Task,
  type TaskWithRun,
  type UploadedProjectDocumentContext,
  type WorkflowGraph,
  type WorkflowGraphNode,
} from "@orc/shared";

import { env } from "../config/env.js";
import { getConfigurationReadiness } from "./configuration-status-service.js";

import { db } from "../db/client.js";

import {
  agentExecutions,
  agents,
  departments,
  domainEvents,
  projectDocuments,
  runs,
  taskDocuments,
  tasks,
  teamMembers,
  teams,
} from "../db/schema.js";

import {
  resolveEffectiveAgentConfig,
} from "./agent-config-resolver.js";

import {
  freezeRunAgentSkills,
} from "./skill-freeze-service.js";

import {
  composeHandoffNote,
  composeKnowledgeContext,
  composeKnowledgeRequirementNote,
  composeTaskDocumentContext,
} from "../runtime/index.js";

import {
  getKnowledgeCategoryBySlug,
} from "./knowledge-category-service.js";

import {
  cancelLiveExecution,
  startSnapshotAgentExecution,
  type ExecutionFinalization,
  type SnapshotAgent,
} from "./agent-execution-service.js";

import {
  listRunEvents,
  recordEvent,
} from "./event-service.js";

import {
  getProject,
  getProjectByPath,
} from "./project-discovery.js";

import {
  getProjectTeamAssignmentByPath,
} from "./project-team-assignment-service.js";

import {
  requestAutoModeCycle,
} from "./auto-mode-signal.js";

import {
  loadTaskDocumentContext,
} from "./task-document-context-service.js";

import {
  resolveRunnablePublishedWorkflow,
} from "./workflow-graph-service.js";

type TerminalAction =
  | "complete_run"
  | "fail_run"
  | "block_run";

type TerminalRunStatus =
  | "completed"
  | "failed"
  | "blocked";

type SnapshotRoute = {
  sourceAgentId: string;
  outcome: AgentResultStatus;
  targetAgentId: string | null;
  terminalAction: TerminalAction | null;
};

/**
 * `version` is optional so every legacy persisted snapshot (no field, or
 * absent) keeps parsing as Snapshot V1 unchanged. A graph-based Run
 * (Snapshot V2) is a structural superset: it still populates `agents`
 * (index 0 is always the Agent the Start edge targets) and `routes`, so
 * every consumer in this file that reads those two fields keeps working
 * for both versions without a version-aware branch. Only outcome
 * resolution (`resolveWorkflowTransition`) needs to know the version,
 * because V2's `routes` is exhaustive -- an outcome with no matching route
 * means no edge was configured, not "fall through to a default."
 */
type WorkflowSnapshot = {
  version?: 2;
  workflowRevisionId?: string;
  agents: SnapshotAgent[];
  routes: SnapshotRoute[];
  knowledgeContext:
    KnowledgeRef[];
  taskDocumentContext:
    UploadedProjectDocumentContext;
};

type TransitionOrigin =
  | "explicit"
  | "default"
  | "fallback"
  | "route_missing"
  | "limit";

type AgentWorkflowTransition = {
  kind: "agent";
  origin: "explicit" | "default";
  sourceAgentId: string;
  outcome: AgentResultStatus;
  targetAgentId: string;
  terminalAction: null;
};

type TerminalWorkflowTransition = {
  kind: "terminal";
  origin: TransitionOrigin;
  sourceAgentId: string;
  outcome: AgentResultStatus;
  targetAgentId: null;
  terminalAction: TerminalAction;
  reason: string | null;
  attemptedTargetAgentId?: string;
};

type WorkflowTransition =
  | AgentWorkflowTransition
  | TerminalWorkflowTransition;

type AppliedWorkflowTransition = {
  run: typeof runs.$inferSelect;
  sourceAgent: SnapshotAgent | null;
  targetAgent: SnapshotAgent | null;
  transition: WorkflowTransition;
  result:
    AgentResult | null;
};

export class WorkflowServiceError extends Error {
  /**
   * Creates a workflow service error carrying its HTTP status.
   */
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}

/**
 * Orders workflow agents by layer and then same-layer execution order.
 */
export function orderWorkflowAgents<
  T extends {
    layer: number;
    executionOrder: number;
  },
>(
  agentRows: readonly T[],
): T[] {
  return [...agentRows].sort(
    (left, right) =>
      left.layer -
        right.layer ||
      left.executionOrder -
        right.executionOrder,
  );
}

/**
 * Validates bounded run-owned knowledge context with an error status appropriate to
 * either caller input or persisted snapshot corruption.
 */
function parseKnowledgeContext(
  value:
    unknown,
  statusCode:
    number,
): KnowledgeRef[] {
  const parsed =
    knowledgeRefCollectionSchema.safeParse(
      value,
    );

  if (
    !parsed.success
  ) {
    throw new WorkflowServiceError(
      "Run knowledge context is invalid",
      statusCode,
    );
  }

  return parsed.data;
}

/**
 * Converts one knowledge reference to downstream-safe provenance without carrying
 * the selected excerpt into every later workflow execution.
 */
function provenanceRef(
  ref:
    KnowledgeRef,
): KnowledgeRef {
  return {
    source:
      ref.source,
    path:
      ref.path,
    ...(
      ref.heading
        ? {
            heading:
              ref.heading,
          }
        : {}
    ),
  };
}

/**
 * Merges immutable first-worker knowledge provenance into the validated structured
 * result while preserving any valid worker-reported references and configured limits.
 */
function mergeInitialKnowledgeProvenance(
  snapshot:
    WorkflowSnapshot,
  sourceAgentId:
    string,
  result:
    AgentResult | null,
): AgentResult | null {
  if (
    !result ||
    snapshot
      .knowledgeContext
      .length ===
      0 ||
    snapshot
      .agents[0]
      ?.id !==
      sourceAgentId
  ) {
    return result;
  }

  const merged:
    KnowledgeRef[] =
      [];

  const seen =
    new Set<string>();

  const candidates = [
    ...snapshot
      .knowledgeContext
      .map(
        provenanceRef,
      ),
    ...(
      result
        .knowledgeRefs ??
      []
    ).map(
      provenanceRef,
    ),
  ];

  for (
    const ref of
    candidates
  ) {
    const key =
      [
        ref.source,
        ref.path,
        ref.heading ??
          "",
      ].join(
        "\u0000",
      );

    if (
      seen.has(
        key,
      )
    ) {
      continue;
    }

    seen.add(
      key,
    );

    merged.push(
      ref,
    );

    if (
      merged.length >=
      MAX_KNOWLEDGE_REFS
    ) {
      break;
    }
  }

  return agentResultSchema.parse({
    ...result,
    knowledgeRefs:
      merged,
  });
}

/**
 * Serializes a task database row into the shared API contract.
 */
function serializeTask(
  row: typeof tasks.$inferSelect,
): Task {
  return {
    ...row,
    createdAt:
      row.createdAt.toISOString(),
    updatedAt:
      row.updatedAt.toISOString(),
  };
}

/**
 * Serializes a run database row into the shared API contract.
 */
function serializeRun(
  row: typeof runs.$inferSelect,
): Run {
  return {
    id:
      row.id,
    teamId:
      row.teamId,
    projectPath:
      row.projectPath,
    taskId:
      row.taskId ?? null,
    status:
      row.status,
    currentAgentId:
      row.currentAgentId ?? null,
    workflowRevisionId:
      row.workflowRevisionId ?? null,
    currentWorkflowNodeId:
      row.currentWorkflowNodeId ?? null,
    executionCount:
      row.executionCount,
    terminalReason:
      row.terminalReason ?? null,
    createdAt:
      row.createdAt.toISOString(),
    updatedAt:
      row.updatedAt.toISOString(),
  };
}

/**
 * Legacy Snapshot V1 building (`loadTeamWorkflowTopology`/`snapshotFromRows`,
 * reading `team_members`/`team_member_routes` layer/order/routes directly)
 * has been removed: new Run creation is graph-only (see
 * `resolveRunnablePublishedWorkflow`/`snapshotFromGraphV2` below).
 * `resolveLegacyWorkflowTransition` and `snapshotOf`'s Snapshot V1 parsing
 * path remain so historical pre-cutover Runs stay readable.
 */
type WorkflowDbClient =
  | typeof db
  | Parameters<
      Parameters<typeof db.transaction>[0]
    >[0];

/**
 * Builds an immutable Snapshot V2 from a Published workflow graph:
 * resolved effective Agent runtime configuration per Agent node, and every
 * graph edge flattened into the same `SnapshotRoute` shape Snapshot V1
 * uses. `agents[0]` is always the Agent the Start edge targets, so the
 * existing "launch the first agent" call sites need no changes. `routes`
 * is exhaustive -- it is never filtered down to only the outcomes that
 * happened to be configured, so a missing route at resolution time
 * unambiguously means no edge exists.
 */
async function snapshotFromGraphV2(
  tx: WorkflowDbClient,
  workflowRevisionId: string,
  graph: WorkflowGraph,
  knowledgeContext: KnowledgeRef[] = [],
  taskDocumentContext: UploadedProjectDocumentContext = [],
): Promise<WorkflowSnapshot> {
  const agentNodes = graph.nodes.filter(
    (node): node is Extract<WorkflowGraphNode, { kind: "agent" }> =>
      node.kind === "agent",
  );
  const agentIds = agentNodes.map((node) => node.agentId);

  const rows =
    agentIds.length
      ? await tx
          .select()
          .from(agents)
          .innerJoin(
            departments,
            eq(agents.departmentId, departments.id),
          )
          .where(inArray(agents.id, agentIds))
      : [];

  const rowByAgentId = new Map(rows.map((row) => [row.agents.id, row]));

  const start = graph.nodes.find(
    (node): node is Extract<WorkflowGraphNode, { kind: "start" }> => node.kind === "start",
  );
  const startEdge = start
    ? graph.edges.find((edge) => edge.sourceNodeId === start.id)
    : undefined;
  const firstAgentNode = startEdge
    ? agentNodes.find((node) => node.id === startEdge.targetNodeId)
    : undefined;

  const orderedAgentNodes = firstAgentNode
    ? [firstAgentNode, ...agentNodes.filter((node) => node.id !== firstAgentNode.id)]
    : agentNodes;

  const snapshotAgents: SnapshotAgent[] = orderedAgentNodes.map((node, index) => {
    const row = rowByAgentId.get(node.agentId);

    if (!row) {
      throw new WorkflowServiceError(
        "The Published workflow references an Agent that no longer exists",
        409,
      );
    }

    const effective = resolveEffectiveAgentConfig(row.agents, row.departments);

    return {
      id: node.agentId,
      name: row.agents.name,
      role: effective.role,
      layer: index + 1,
      executionOrder: 1,
      harness: effective.harness,
      model: effective.model,
      reasoning: effective.reasoning,
      systemPrompt: effective.systemPrompt,
      canWrite: effective.canWrite,
      canRunCommands: effective.canRunCommands,
      sandboxMode: effective.sandboxMode,
      canCommit: effective.canCommit,
    };
  });

  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const routes: SnapshotRoute[] = [];

  for (const edge of graph.edges) {
    const sourceNode = nodeById.get(edge.sourceNodeId);
    if (!sourceNode || sourceNode.kind !== "agent" || edge.outcome === null) {
      continue;
    }

    const targetNode = nodeById.get(edge.targetNodeId);
    if (!targetNode) {
      continue;
    }

    if (targetNode.kind === "agent") {
      routes.push({
        sourceAgentId: sourceNode.agentId,
        outcome: edge.outcome,
        targetAgentId: targetNode.agentId,
        terminalAction: null,
      });
    } else if (targetNode.kind === "terminal") {
      routes.push({
        sourceAgentId: sourceNode.agentId,
        outcome: edge.outcome,
        targetAgentId: null,
        terminalAction: targetNode.terminalAction,
      });
    }
  }

  return {
    version: 2,
    workflowRevisionId,
    agents: snapshotAgents,
    routes,
    knowledgeContext: knowledgeContext.map((ref) => ({ ...ref })),
    taskDocumentContext: taskDocumentContext.map((ref) => ({ ...ref })),
  };
}

/**
 * Freezes a newly created Run's per-Agent assigned Skill scope from the
 * snapshot's Agent ids, resolving each back to its canonical Agent slug so
 * `.orc/skills` assignment can be looked up. Called after the Run row exists
 * so freezing failures can never block a Run whose workflow otherwise
 * started successfully -- this data is discoverability, not execution.
 */
async function freezeSnapshotAgentSkills(
  tx: WorkflowDbClient,
  runId: string,
  snapshot: WorkflowSnapshot,
): Promise<void> {
  const agentIds = snapshot.agents.map((agent) => agent.id);
  if (!agentIds.length) return;

  const rows = await tx.select({ id: agents.id, slug: agents.slug }).from(agents).where(inArray(agents.id, agentIds));
  await freezeRunAgentSkills(
    tx,
    runId,
    rows.map((row) => ({ agentId: row.id, agentSlug: row.slug })),
  );
}

/**
 * Reads the workflow snapshot persisted with a run, accepts old snapshots without
 * knowledgeContext as an empty context, and rejects malformed snapshots.
 */
function snapshotOf(
  row: typeof runs.$inferSelect,
): WorkflowSnapshot {
  const snapshot =
    row.workflowSnapshot as
      | Partial<WorkflowSnapshot>
      | null;

  if (
    !snapshot ||
    !Array.isArray(
      snapshot.agents,
    ) ||
    !Array.isArray(
      snapshot.routes,
    )
  ) {
    throw new WorkflowServiceError(
      "Run workflow snapshot is invalid",
      500,
    );
  }

  return {
    ...(snapshot.version === 2 && typeof snapshot.workflowRevisionId === "string"
      ? { version: 2 as const, workflowRevisionId: snapshot.workflowRevisionId }
      : {}),
    agents:
      snapshot.agents,
    routes:
      snapshot.routes,
    knowledgeContext:
      parseKnowledgeContext(
        snapshot
          .knowledgeContext ??
          [],
        500,
      ),
    taskDocumentContext:
      uploadedProjectDocumentContextCollectionSchema.parse(
        snapshot.taskDocumentContext ?? [],
      ),
  };
}

/**
 * Normalizes an unknown thrown value into an operator-readable error message.
 */
function errorMessage(
  error: unknown,
): string {
  return error instanceof Error
    ? error.message
    : String(error);
}

/**
 * Maps a configured terminal action onto the persisted run status.
 */
function terminalStatusForAction(
  action: TerminalAction,
): TerminalRunStatus {
  if (
    action ===
    "complete_run"
  ) {
    return "completed";
  }

  if (
    action ===
    "block_run"
  ) {
    return "blocked";
  }

  return "failed";
}

/**
 * Resolves one structured result into a transition, dispatching on the
 * snapshot version so this stays the single call-site contract every
 * existing caller already uses. Legacy (Snapshot V1) Runs keep exactly
 * their current explicit-route / default-progression / terminal-fallback
 * behavior, unchanged. Graph-based (Snapshot V2) Runs route only through
 * an explicit edge and fail the Run outright when none matches -- see
 * `resolveGraphWorkflowTransition`.
 */
function resolveWorkflowTransition(
  snapshot: WorkflowSnapshot,
  sourceAgentId: string,
  outcome: AgentResultStatus,
  failureReason: string | null,
): WorkflowTransition {
  if (snapshot.version === 2) {
    return resolveGraphWorkflowTransition(snapshot, sourceAgentId, outcome);
  }

  return resolveLegacyWorkflowTransition(snapshot, sourceAgentId, outcome, failureReason);
}

/**
 * Resolves a Snapshot V2 outcome strictly through the Published graph's
 * edges: `snapshot.routes` is exhaustive (every edge from the Published
 * graph, materialized at Run start), so an outcome with no matching route
 * unambiguously means no edge was configured for it. Per roadmap section
 * 6, that is never interpreted as Block Run, Fail Run, or "next Agent" --
 * the Run fails explicitly with a deterministic `route_missing` reason
 * instead.
 */
function resolveGraphWorkflowTransition(
  snapshot: WorkflowSnapshot,
  sourceAgentId: string,
  outcome: AgentResultStatus,
): WorkflowTransition {
  const sourceAgent = snapshot.agents.find((agent) => agent.id === sourceAgentId);

  if (!sourceAgent) {
    return {
      kind: "terminal",
      origin: "fallback",
      sourceAgentId,
      outcome,
      targetAgentId: null,
      terminalAction: "fail_run",
      reason: "The completed agent is outside this run's workflow snapshot.",
    };
  }

  const matchedRoute = snapshot.routes.find(
    (route) => route.sourceAgentId === sourceAgentId && route.outcome === outcome,
  );

  if (!matchedRoute) {
    return {
      kind: "terminal",
      origin: "route_missing",
      sourceAgentId,
      outcome,
      targetAgentId: null,
      terminalAction: "fail_run",
      reason: `No workflow edge is configured for outcome "${outcome}" from node "${sourceAgent.name}".`,
    };
  }

  if (matchedRoute.terminalAction) {
    return {
      kind: "terminal",
      origin: "explicit",
      sourceAgentId,
      outcome,
      targetAgentId: null,
      terminalAction: matchedRoute.terminalAction,
      reason: `Terminal route: ${matchedRoute.terminalAction}`,
    };
  }

  if (matchedRoute.targetAgentId) {
    const targetExists = snapshot.agents.some((agent) => agent.id === matchedRoute.targetAgentId);

    if (!targetExists) {
      return {
        kind: "terminal",
        origin: "fallback",
        sourceAgentId,
        outcome,
        targetAgentId: null,
        terminalAction: "fail_run",
        reason: "The workflow route targeted an agent outside this run's snapshot.",
        attemptedTargetAgentId: matchedRoute.targetAgentId,
      };
    }

    return {
      kind: "agent",
      origin: "explicit",
      sourceAgentId,
      outcome,
      targetAgentId: matchedRoute.targetAgentId,
      terminalAction: null,
    };
  }

  return {
    kind: "terminal",
    origin: "fallback",
    sourceAgentId,
    outcome,
    targetAgentId: null,
    terminalAction: "fail_run",
    reason: "The workflow snapshot contains a route without a destination.",
  };
}

/**
 * Resolves one Snapshot V1 structured result into an explicit route, default progression, or terminal fallback.
 */
function resolveLegacyWorkflowTransition(
  snapshot: WorkflowSnapshot,
  sourceAgentId: string,
  outcome: AgentResultStatus,
  failureReason:
    string | null,
): WorkflowTransition {
  const sourceIndex =
    snapshot.agents.findIndex(
      (agent) =>
        agent.id ===
        sourceAgentId,
    );

  if (
    sourceIndex === -1
  ) {
    return {
      kind:
        "terminal",
      origin:
        "fallback",
      sourceAgentId,
      outcome,
      targetAgentId:
        null,
      terminalAction:
        "fail_run",
      reason:
        "The completed agent is outside this run's workflow snapshot.",
    };
  }

  const explicitRoute =
    snapshot.routes.find(
      (route) =>
        route.sourceAgentId ===
          sourceAgentId &&
        route.outcome ===
          outcome,
    );

  if (
    explicitRoute
      ?.terminalAction
  ) {
    return {
      kind:
        "terminal",
      origin:
        "explicit",
      sourceAgentId,
      outcome,
      targetAgentId:
        null,
      terminalAction:
        explicitRoute
          .terminalAction,
      reason:
        `Terminal route: ${explicitRoute.terminalAction}`,
    };
  }

  if (
    explicitRoute
      ?.targetAgentId
  ) {
    const targetExists =
      snapshot.agents.some(
        (agent) =>
          agent.id ===
          explicitRoute
            .targetAgentId,
      );

    if (
      !targetExists
    ) {
      return {
        kind:
          "terminal",
        origin:
          "fallback",
        sourceAgentId,
        outcome,
        targetAgentId:
          null,
        terminalAction:
          "fail_run",
        reason:
          "The workflow route targeted an agent outside this run's snapshot.",
        attemptedTargetAgentId:
          explicitRoute
            .targetAgentId,
      };
    }

    return {
      kind:
        "agent",
      origin:
        "explicit",
      sourceAgentId,
      outcome,
      targetAgentId:
        explicitRoute
          .targetAgentId,
      terminalAction:
        null,
    };
  }

  if (
    explicitRoute
  ) {
    return {
      kind:
        "terminal",
      origin:
        "fallback",
      sourceAgentId,
      outcome,
      targetAgentId:
        null,
      terminalAction:
        "fail_run",
      reason:
        "The workflow snapshot contains a route without a destination.",
    };
  }

  if (
    outcome ===
      "completed" ||
    outcome ===
      "approved"
  ) {
    const nextAgent =
      snapshot.agents[
        sourceIndex +
          1
      ];

    if (
      nextAgent
    ) {
      return {
        kind:
          "agent",
        origin:
          "default",
        sourceAgentId,
        outcome,
        targetAgentId:
          nextAgent.id,
        terminalAction:
          null,
      };
    }

    return {
      kind:
        "terminal",
      origin:
        "default",
      sourceAgentId,
      outcome,
      targetAgentId:
        null,
      terminalAction:
        "complete_run",
      reason:
        null,
    };
  }

  const terminalAction:
    TerminalAction =
      outcome ===
        "blocked" ||
      outcome ===
        "changes_requested"
        ? "block_run"
        : "fail_run";

  return {
    kind:
      "terminal",
    origin:
      "fallback",
    sourceAgentId,
    outcome,
    targetAgentId:
      null,
    terminalAction,
    reason:
      failureReason ??
      `No configured route for ${outcome}.`,
  };
}

/**
 * Converts a next-agent transition into a bounded failure when the run has reached its execution limit.
 */
function enforceWorkflowExecutionLimit(
  transition:
    WorkflowTransition,
  executionCount:
    number,
): WorkflowTransition {
  if (
    transition.kind !==
      "agent" ||
    executionCount <
      env.MAX_WORKFLOW_EXECUTIONS
  ) {
    return transition;
  }

  return {
    kind:
      "terminal",
    origin:
      "limit",
    sourceAgentId:
      transition.sourceAgentId,
    outcome:
      transition.outcome,
    targetAgentId:
      null,
    terminalAction:
      "fail_run",
    reason:
      `Workflow execution limit (${env.MAX_WORKFLOW_EXECUTIONS}) reached.`,
    attemptedTargetAgentId:
      transition.targetAgentId,
  };
}

/**
 * Builds the persisted observability payload for one resolved workflow transition.
 */
function transitionEventData(
  transition:
    WorkflowTransition,
  executionCount:
    number,
): Record<
  string,
  unknown
> {
  const data:
    Record<
      string,
      unknown
    > = {
      origin:
        transition.origin,
      sourceAgentId:
        transition
          .sourceAgentId,
      outcome:
        transition.outcome,
      targetAgentId:
        transition
          .targetAgentId,
      terminalAction:
        transition
          .terminalAction,
      executionCount,
    };

  if (
    transition.kind ===
    "terminal"
  ) {
    data.reason =
      transition.reason;

    if (
      transition
        .attemptedTargetAgentId
    ) {
      data.attemptedTargetAgentId =
        transition
          .attemptedTargetAgentId;
    }
  }

  return data;
}

/**
 * Atomically moves an active run and its task to a terminal state, records the matching event, then signals Auto Mode.
 */
async function updateTerminal(
  run:
    typeof runs.$inferSelect,
  status:
    | "completed"
    | "failed"
    | "blocked"
    | "cancelled"
    | "skipped",
  reason:
    string | null,
  expectedAgentId?:
    string,
): Promise<boolean> {
  const now =
    new Date();

  const transitioned =
    await db.transaction(
      async (tx) => {
        const condition =
          expectedAgentId
            ? and(
                eq(
                  runs.id,
                  run.id,
                ),
                eq(
                  runs.status,
                  "running",
                ),
                eq(
                  runs.currentAgentId,
                  expectedAgentId,
                ),
              )
            : and(
                eq(
                  runs.id,
                  run.id,
                ),
                inArray(
                  runs.status,
                  [
                    "pending",
                    "running",
                  ],
                ),
              );

        const [updated] =
          await tx
            .update(runs)
            .set({
              status,
              currentAgentId:
                null,
              terminalReason:
                reason,
              updatedAt:
                now,
            })
            .where(
              condition,
            )
            .returning();

        if (
          !updated
        ) {
          return false;
        }

        if (
          updated.taskId
        ) {
          await tx
            .update(tasks)
            .set({
              status,
              updatedAt:
                now,
            })
            .where(
              eq(
                tasks.id,
                updated.taskId,
              ),
            );
        }

        await tx
          .insert(
            domainEvents,
          )
          .values({
            type:
              `run.${status}`,
            projectPath:
              updated.projectPath,
            taskId:
              updated.taskId,
            runId:
              updated.id,
            data: {
              reason,
            },
          });

        return true;
      },
    );

  if (
    transitioned
  ) {
    requestAutoModeCycle();
  }

  return transitioned;
}

/**
 * Loads the raw task instruction belonging to a workflow run.
 */
async function getTaskInstruction(
  run:
    typeof runs.$inferSelect,
): Promise<string> {
  if (
    !run.taskId
  ) {
    throw new WorkflowServiceError(
      "Workflow run is missing its task",
      500,
    );
  }

  const [task] =
    await db
      .select({
        instruction:
          tasks.instruction,
      })
      .from(tasks)
      .where(
        eq(
          tasks.id,
          run.taskId,
        ),
      );

  if (
    !task
  ) {
    throw new WorkflowServiceError(
      "Workflow task no longer exists",
      500,
    );
  }

  return task.instruction;
}

/**
 * Applies an optional one-execution retry override without mutating the persisted workflow snapshot.
 */
function resolveExecutionAgent(
  snapshotAgent:
    SnapshotAgent,
  override?:
    RetryRun,
): SnapshotAgent {
  if (
    !override?.harness &&
    !override?.model &&
    !override?.reasoning
  ) {
    return snapshotAgent;
  }

  return {
    ...snapshotAgent,
    ...(
      override.harness
        ? {
            harness:
              override.harness,
          }
        : {}
    ),
    ...(
      override.model
        ? {
            model:
              override.model,
          }
        : {}
    ),
    ...(
      override.reasoning
        ? {
            reasoning:
              override.reasoning,
          }
        : {}
    ),
  };
}

/**
 * Starts a worker whose run row has already atomically claimed that agent, injecting
 * first-worker durable knowledge plus immutable Run-owned Project Document context
 * for every claimed worker execution.
 */
async function launchClaimedAgent(
  claimedRun:
    typeof runs.$inferSelect,
  snapshotAgent:
    SnapshotAgent,
  handoffNote?:
    string,
  override?:
    RetryRun,
): Promise<void> {
  const agent =
    resolveExecutionAgent(
      snapshotAgent,
      override,
    );

  try {
    const baseInstruction =
      await getTaskInstruction(
        claimedRun,
      );

    const snapshot =
      snapshotOf(
        claimedRun,
      );

    const knowledgeNote =
      snapshot
        .agents[0]
        ?.id ===
      snapshotAgent.id
        ? composeKnowledgeContext(
            snapshot
              .knowledgeContext,
          )
        : null;

    const taskDocumentNote =
      composeTaskDocumentContext(
        snapshot.taskDocumentContext,
      );

    const instruction =
      [
        baseInstruction,
        knowledgeNote,
        taskDocumentNote,
        handoffNote,
      ]
        .filter(
          (
            value,
          ): value is string =>
            Boolean(
              value,
            ),
        )
        .join(
          "\n\n",
        );

    await recordEvent({
      type:
        "agent.started",
      projectPath:
        claimedRun
          .projectPath,
      taskId:
        claimedRun.taskId,
      runId:
        claimedRun.id,
      data: {
        agentId:
          agent.id,
        layer:
          agent.layer,
        executionOrder:
          agent.executionOrder,
        harness:
          agent.harness,
        model:
          agent.model,
        reasoning:
          agent.reasoning,
        executionCount:
          claimedRun
            .executionCount,
        ...(
          override?.harness ||
          override?.model ||
          override?.reasoning
            ? {
                overridden:
                  true,
              }
            : {}
        ),
      },
    });

    await startSnapshotAgentExecution(
      claimedRun,
      agent,
      instruction,
      (
        finalization,
      ) =>
        handleExecutionFinalization(
          claimedRun.id,
          agent.id,
          finalization,
        ),
    );
  } catch (
    error
  ) {
    await updateTerminal(
      claimedRun,
      "failed",
      `Failed to start agent ${agent.name}: ${errorMessage(error)}`,
      agent.id,
    );
  }
}

/**
 * Atomically claims an idle run for one snapshot agent and starts that worker.
 */
async function claimAndLaunchAgent(
  runId:
    string,
  nextAgentId:
    string,
  handoffNote?:
    string,
  override?:
    RetryRun,
): Promise<void> {
  const [run] =
    await db
      .select()
      .from(runs)
      .where(
        eq(
          runs.id,
          runId,
        ),
      );

  if (
    !run ||
    run.status !==
      "running" ||
    run.currentAgentId !==
      null
  ) {
    return;
  }

  let snapshot:
    WorkflowSnapshot;

  try {
    snapshot =
      snapshotOf(
        run,
      );
  } catch (
    error
  ) {
    await updateTerminal(
      run,
      "failed",
      errorMessage(
        error,
      ),
    );

    return;
  }

  const snapshotAgent =
    snapshot.agents.find(
      (candidate) =>
        candidate.id ===
        nextAgentId,
    );

  if (
    !snapshotAgent
  ) {
    await updateTerminal(
      run,
      "failed",
      "The workflow route targeted an agent outside this run's snapshot.",
    );

    return;
  }

  if (
    run.executionCount >=
    env.MAX_WORKFLOW_EXECUTIONS
  ) {
    await updateTerminal(
      run,
      "failed",
      `Workflow execution limit (${env.MAX_WORKFLOW_EXECUTIONS}) reached.`,
    );

    return;
  }

  const [claimed] =
    await db
      .update(runs)
      .set({
        currentAgentId:
          snapshotAgent.id,
        executionCount:
          run.executionCount +
          1,
        updatedAt:
          new Date(),
      })
      .where(
        and(
          eq(
            runs.id,
            run.id,
          ),
          eq(
            runs.status,
            "running",
          ),
          sql`${runs.currentAgentId} is null`,
        ),
      )
      .returning();

  if (
    !claimed
  ) {
    return;
  }

  await launchClaimedAgent(
    claimed,
    snapshotAgent,
    handoffNote,
    override,
  );
}

/**
 * Atomically persists a structured result transition, adds immutable first-worker
 * knowledge provenance to the existing result payload, and either claims the next agent
 * or terminates the run.
 */
async function applyFinalizationTransition(
  runId:
    string,
  agentId:
    string,
  executionId:
    string,
  resultStatus:
    AgentResultStatus,
  failureReason:
    string | null,
  result:
    AgentResult | null,
): Promise<
  AppliedWorkflowTransition | null
> {
  return db.transaction(
    async (tx) => {
      const [run] =
        await tx
          .select()
          .from(runs)
          .where(
            eq(
              runs.id,
              runId,
            ),
          );

      if (
        !run ||
        run.status !==
          "running" ||
        run.currentAgentId !==
          agentId
      ) {
        return null;
      }

      const snapshot =
        snapshotOf(
          run,
        );

      const sourceAgent =
        snapshot.agents.find(
          (candidate) =>
            candidate.id ===
            agentId,
        ) ?? null;

      const mergedResult =
        mergeInitialKnowledgeProvenance(
          snapshot,
          agentId,
          result,
        );

      const transition =
        enforceWorkflowExecutionLimit(
          resolveWorkflowTransition(
            snapshot,
            agentId,
            resultStatus,
            failureReason,
          ),
          run.executionCount,
        );

      const now =
        new Date();

      if (
        mergedResult
      ) {
        await tx
          .update(
            agentExecutions,
          )
          .set({
            resultPayload:
              mergedResult,
            updatedAt:
              now,
          })
          .where(
            and(
              eq(
                agentExecutions.id,
                executionId,
              ),
              eq(
                agentExecutions.runId,
                run.id,
              ),
            ),
          );
      }

      const activeSourceCondition =
        and(
          eq(
            runs.id,
            run.id,
          ),
          eq(
            runs.status,
            "running",
          ),
          eq(
            runs.currentAgentId,
            agentId,
          ),
        );

      let updatedRun:
        | typeof runs.$inferSelect
        | undefined;

      let targetAgent:
        SnapshotAgent | null =
          null;

      let terminalStatus:
        TerminalRunStatus | null =
          null;

      if (
        transition.kind ===
        "agent"
      ) {
        targetAgent =
          snapshot.agents.find(
            (candidate) =>
              candidate.id ===
              transition
                .targetAgentId,
          ) ?? null;

        if (
          !targetAgent
        ) {
          throw new WorkflowServiceError(
            "The workflow transition targeted an unavailable snapshot agent",
            500,
          );
        }

        [updatedRun] =
          await tx
            .update(runs)
            .set({
              currentAgentId:
                targetAgent.id,
              executionCount:
                run.executionCount +
                1,
              updatedAt:
                now,
            })
            .where(
              activeSourceCondition,
            )
            .returning();
      } else {
        terminalStatus =
          terminalStatusForAction(
            transition
              .terminalAction,
          );

        [updatedRun] =
          await tx
            .update(runs)
            .set({
              status:
                terminalStatus,
              currentAgentId:
                null,
              terminalReason:
                transition.reason,
              updatedAt:
                now,
            })
            .where(
              activeSourceCondition,
            )
            .returning();

        if (
          updatedRun &&
          run.taskId
        ) {
          await tx
            .update(tasks)
            .set({
              status:
                terminalStatus,
              updatedAt:
                now,
            })
            .where(
              eq(
                tasks.id,
                run.taskId,
              ),
            );
        }
      }

      if (
        !updatedRun
      ) {
        return null;
      }

      const events:
        Array<
          typeof domainEvents.$inferInsert
        > = [
          {
            type:
              "result.received",
            projectPath:
              run.projectPath,
            taskId:
              run.taskId,
            runId:
              run.id,
            agentExecutionId:
              executionId,
            data: {
              status:
                resultStatus,
            },
          },
          {
            type:
              "workflow.transition",
            projectPath:
              run.projectPath,
            taskId:
              run.taskId,
            runId:
              run.id,
            agentExecutionId:
              executionId,
            data:
              transitionEventData(
                transition,
                run.executionCount,
              ),
          },
        ];

      if (
        transition.origin ===
          "explicit" &&
        transition.kind ===
          "agent"
      ) {
        events.push({
          type:
            "route.selected",
          projectPath:
            run.projectPath,
          taskId:
            run.taskId,
          runId:
            run.id,
          agentExecutionId:
            executionId,
          data: {
            targetAgentId:
              transition
                .targetAgentId,
            outcome:
              transition
                .outcome,
          },
        });
      }

      if (
        terminalStatus
      ) {
        events.push({
          type:
            `run.${terminalStatus}`,
          projectPath:
            run.projectPath,
          taskId:
            run.taskId,
          runId:
            run.id,
          data: {
            reason:
              transition.kind ===
              "terminal"
                ? transition.reason
                : null,
          },
        });
      }

      await tx
        .insert(
          domainEvents,
        )
        .values(
          events,
        );

      return {
        run:
          updatedRun,
        sourceAgent,
        targetAgent,
        transition,
        result:
          mergedResult,
      };
    },
  );
}

/**
 * Processes one finalized worker result and continues or terminates the workflow.
 */
async function handleExecutionFinalization(
  runId:
    string,
  agentId:
    string,
  finalization:
    ExecutionFinalization,
): Promise<void> {
  const [run] =
    await db
      .select()
      .from(runs)
      .where(
        eq(
          runs.id,
          runId,
        ),
      );

  if (
    !run ||
    run.status !==
      "running"
  ) {
    return;
  }

  if (
    finalization.status ===
    "cancelled"
  ) {
    await updateTerminal(
      run,
      "cancelled",
      finalization
        .failureReason,
      agentId,
    );

    return;
  }

  if (
    !finalization
      .resultStatus
  ) {
    await updateTerminal(
      run,
      "failed",
      finalization
        .failureReason ??
        "Worker did not produce a valid structured result.",
      agentId,
    );

    return;
  }

  let applied:
    AppliedWorkflowTransition | null;

  try {
    applied =
      await applyFinalizationTransition(
        runId,
        agentId,
        finalization
          .executionId,
        finalization
          .resultStatus,
        finalization
          .failureReason,
        finalization
          .result,
      );
  } catch (
    error
  ) {
    await updateTerminal(
      run,
      "failed",
      `Workflow transition failed: ${errorMessage(error)}`,
      agentId,
    );

    return;
  }

  if (
    !applied
  ) {
    return;
  }

  if (
    applied.transition
      .kind ===
    "terminal"
  ) {
    requestAutoModeCycle();

    return;
  }

  if (
    !applied
      .targetAgent
  ) {
    await updateTerminal(
      applied.run,
      "failed",
      "The claimed workflow transition has no target agent.",
      applied.run
        .currentAgentId ??
        undefined,
    );

    return;
  }

  const handoffNote =
    applied.result &&
    applied.sourceAgent
      ? composeHandoffNote(
          applied.sourceAgent,
          applied.result,
          applied.targetAgent.canCommit,
        )
      : undefined;

  const knowledgeRequirements =
    applied.result?.knowledgeRequirements ??
    [];

  let knowledgeRequirementNote:
    string | undefined;

  if (
    knowledgeRequirements.length >
    0
  ) {
    const resolved:
      Array<
        KnowledgeRequirement & {
          category: Pick<
            KnowledgeCategory,
            "slug" | "name"
          >;
        }
      > = [];

    for (
      const requirement of knowledgeRequirements
    ) {
      const category =
        await getKnowledgeCategoryBySlug(
          requirement.categorySlug,
        );

      if (
        !category ||
        !category.enabled
      ) {
        if (
          requirement.required
        ) {
          await updateTerminal(
            applied.run,
            "blocked",
            `Required knowledge category "${requirement.categorySlug}" declared by ${applied.sourceAgent?.name ?? "the previous agent"} could not be resolved: ${
              category
                ? "the category is disabled"
                : "no such Knowledge Category exists"
            }.`,
            applied.run
              .currentAgentId ??
              undefined,
          );

          return;
        }

        // An optional requirement that cannot resolve is silently omitted rather than
        // blocking the handoff.
        continue;
      }

      resolved.push({
        ...requirement,
        category: {
          slug:
            category.slug,
          name:
            category.name,
        },
      });
    }

    knowledgeRequirementNote =
      composeKnowledgeRequirementNote(
        resolved,
      ) ??
      undefined;
  }

  await launchClaimedAgent(
    applied.run,
    applied.targetAgent,
    [
      handoffNote,
      knowledgeRequirementNote,
    ]
      .filter(
        (value): value is string =>
          Boolean(value),
      )
      .join("\n\n") ||
      undefined,
  );
}

/**
 * Validates that a Team exists, remains enabled, and has at least one enabled worker.
 */
async function requireRunnableTeam(
  teamId:
    string,
): Promise<void> {
  const readiness = await getConfigurationReadiness();
  if (!readiness.ready) {
    throw new WorkflowServiceError(readiness.reason ?? "Configuration is not ready for new work", 409);
  }

  const [team] =
    await db
      .select({
        id:
          teams.id,
        enabled:
          teams.enabled,
      })
      .from(teams)
      .where(
        eq(
          teams.id,
          teamId,
        ),
      );

  if (
    !team
  ) {
    throw new WorkflowServiceError(
      "The selected team does not exist",
      404,
    );
  }

  if (
    !team.enabled
  ) {
    throw new WorkflowServiceError(
      "The selected team is disabled",
      409,
    );
  }

  const [enabledMember] =
    await db
      .select({
        id:
          teamMembers.id,
      })
      .from(teamMembers)
      .innerJoin(
        agents,
        eq(
          teamMembers.agentId,
          agents.id,
        ),
      )
      .innerJoin(
        departments,
        eq(
          agents.departmentId,
          departments.id,
        ),
      )
      .where(
        and(
          eq(
            teamMembers.teamId,
            teamId,
          ),
          eq(
            agents.enabled,
            true,
          ),
          eq(
            departments.enabled,
            true,
          ),
        ),
      )
      .limit(1);

  if (
    !enabledMember
  ) {
    throw new WorkflowServiceError(
      "The selected team has no enabled agents",
      409,
    );
  }
}

/**
 * Creates a pending task without creating or starting a run.
 */
export async function createTask(
  input:
    CreateTask,
  trustedDocumentIds:
    readonly string[] = [],
): Promise<Task> {
  const project =
    await getProject(
      env.WORKSPACE_ROOT,
      input.projectId,
    );

  if (
    !project
  ) {
    throw new WorkflowServiceError(
      "The selected project is no longer available",
      404,
    );
  }

  const assignment =
    await getProjectTeamAssignmentByPath(
      project.path,
    );

  const teamId =
    input.teamId ??
    assignment?.teamId;

  if (
    !teamId
  ) {
    throw new WorkflowServiceError(
      "The selected project has no assigned Team. Select a Team to create manual work.",
      400,
    );
  }

  await requireRunnableTeam(
    teamId,
  );

  const task = await db.transaction(async (tx) => {
    if (trustedDocumentIds.length) {
      const documents = await tx
        .select({ id: projectDocuments.id })
        .from(projectDocuments)
        .where(
          and(
            eq(projectDocuments.teamId, teamId),
            eq(projectDocuments.projectPath, project.path),
            inArray(projectDocuments.id, [...trustedDocumentIds]),
          ),
        );

      if (documents.length !== trustedDocumentIds.length) {
        throw new WorkflowServiceError(
          "One or more trusted documents are unavailable in this Task scope",
          400,
        );
      }
    }

    const [created] = await tx
      .insert(tasks)
      .values({
        teamId,
        projectPath: project.path,
        title: input.title,
        instruction: input.instruction,
        status: "pending",
      })
      .returning();

    if (trustedDocumentIds.length) {
      await tx.insert(taskDocuments).values(
        trustedDocumentIds.map((projectDocumentId) => ({
          taskId: created.id,
          projectDocumentId,
        })),
      );
    }

    return created;
  });

  return serializeTask(
    task,
  );
}

/**
 * Loads one persisted task by identifier.
 */
export async function getTask(
  id: string,
): Promise<Task | null> {
  const [task] =
    await db
      .select()
      .from(tasks)
      .where(
        eq(
          tasks.id,
          id,
        ),
      );

  return task
    ? serializeTask(
        task,
      )
    : null;
}

/**
 * Starts a pending task through the normal snapshotted workflow execution path and
 * freezes any orchestrator-selected bounded durable knowledge into that Run snapshot.
 */
export async function startTask(
  id:
    string,
  knowledgeContext:
    readonly KnowledgeRef[] = [],
): Promise<
  TaskWithRun | null
> {
  const validatedKnowledgeContext =
    parseKnowledgeContext(
      knowledgeContext,
      400,
    );

  const readiness = await getConfigurationReadiness();
  if (!readiness.ready) {
    throw new WorkflowServiceError(readiness.reason ?? "Configuration is not ready for new work", 409);
  }

  const [existingTask] =
    await db
      .select()
      .from(tasks)
      .where(
        eq(
          tasks.id,
          id,
        ),
      );

  if (
    !existingTask
  ) {
    return null;
  }

  if (
    existingTask.status !==
    "pending"
  ) {
    throw new WorkflowServiceError(
      "Only a pending task can be started",
      409,
    );
  }

  const project =
    await getProjectByPath(
      env.WORKSPACE_ROOT,
      existingTask
        .projectPath,
    );

  if (
    !project
  ) {
    throw new WorkflowServiceError(
      "The selected project is no longer available",
      404,
    );
  }

  const result =
    await db.transaction(
      async (tx) => {
        const active =
          await tx
            .select({
              id:
                runs.id,
            })
            .from(runs)
            .where(
              inArray(
                runs.status,
                [
                  "pending",
                  "running",
                ],
              ),
            )
            .limit(1);

        if (
          active.length
        ) {
          throw new WorkflowServiceError(
            "Another task is already active",
            409,
          );
        }

        const [currentTask] =
          await tx
            .select()
            .from(tasks)
            .where(
              eq(
                tasks.id,
                id,
              ),
            );

        if (
          !currentTask
        ) {
          throw new WorkflowServiceError(
            "The task no longer exists",
            404,
          );
        }

        if (
          currentTask.status !==
          "pending"
        ) {
          throw new WorkflowServiceError(
            "The task changed while the run was being started",
            409,
          );
        }

        const [team] =
          await tx
            .select({
              id:
                teams.id,
              enabled:
                teams.enabled,
            })
            .from(teams)
            .where(
              eq(
                teams.id,
                currentTask.teamId,
              ),
            );

        if (
          !team
        ) {
          throw new WorkflowServiceError(
            "The selected team does not exist",
            404,
          );
        }

        if (
          !team.enabled
        ) {
          throw new WorkflowServiceError(
            "The selected team is disabled",
            409,
          );
        }

        const runnableWorkflow =
          await resolveRunnablePublishedWorkflow(
            tx,
            currentTask.teamId,
          );

        if (
          !runnableWorkflow
        ) {
          throw new WorkflowServiceError(
            "The selected team has no runnable Published workflow. Update and publish the Draft workflow.",
            409,
          );
        }

        const taskDocumentContext =
          await loadTaskDocumentContext(
            tx,
            currentTask,
          );

        const workflowSnapshot =
          await snapshotFromGraphV2(
            tx,
            runnableWorkflow.revisionId,
            runnableWorkflow.graph,
            validatedKnowledgeContext,
            taskDocumentContext,
          );

        const now =
          new Date();

        const [task] =
          await tx
            .update(tasks)
            .set({
              status:
                "running",
              updatedAt:
                now,
            })
            .where(
              and(
                eq(
                  tasks.id,
                  id,
                ),
                eq(
                  tasks.status,
                  "pending",
                ),
              ),
            )
            .returning();

        if (
          !task
        ) {
          throw new WorkflowServiceError(
            "The task changed while the run was being started",
            409,
          );
        }

        const [run] =
          await tx
            .insert(runs)
            .values({
              taskId:
                task.id,
              teamId:
                task.teamId,
              projectPath:
                project.path,
              status:
                "running",
              workflowSnapshot,
              workflowRevisionId:
                runnableWorkflow.revisionId,
              executionCount:
                0,
              updatedAt:
                now,
            })
            .returning();

        await freezeSnapshotAgentSkills(tx, run.id, workflowSnapshot);

        await tx
          .insert(
            domainEvents,
          )
          .values({
            type:
              "run.started",
            projectPath:
              run.projectPath,
            taskId:
              task.id,
            runId:
              run.id,
            data: {
              title:
                task.title,
            },
          });

        if (taskDocumentContext.length) {
          await tx
            .insert(domainEvents)
            .values({
              type: "run.document_context_selected",
              projectPath: run.projectPath,
              taskId: task.id,
              runId: run.id,
              data: {
                documentIds: taskDocumentContext.map((ref) => ref.documentId),
                chunkCount: taskDocumentContext.length,
              },
            });
        }

        return {
          task,
          run,
        };
      },
    );

  const snapshot =
    snapshotOf(
      result.run,
    );

  void claimAndLaunchAgent(
    result.run.id,
    snapshot.agents[0].id,
  );

  return {
    task:
      serializeTask(
        result.task,
      ),
    run:
      serializeRun(
        result.run,
      ),
  };
}

/**
 * Creates a task and immutable workflow snapshot, then starts its first configured worker
 * with knowledge disabled for existing manual and Auto Mode compatibility.
 */
export async function createAndStartTask(
  input:
    CreateTask,
): Promise<TaskWithRun> {
  const readiness = await getConfigurationReadiness();
  if (!readiness.ready) {
    throw new WorkflowServiceError(readiness.reason ?? "Configuration is not ready for new work", 409);
  }

  const project =
    await getProject(
      env.WORKSPACE_ROOT,
      input.projectId,
    );

  if (
    !project
  ) {
    throw new WorkflowServiceError(
      "The selected project is no longer available",
      404,
    );
  }

  const assignment =
    await getProjectTeamAssignmentByPath(
      project.path,
    );
  const teamId =
    input.teamId ??
    assignment?.teamId;
  if (!teamId) {
    throw new WorkflowServiceError(
      "The selected project has no assigned Team. Select a Team to create manual work.",
      400,
    );
  }

  const result =
    await db.transaction(
      async (tx) => {
        const active =
          await tx
            .select({
              id:
                runs.id,
            })
            .from(runs)
            .where(
              inArray(
                runs.status,
                [
                  "pending",
                  "running",
                ],
              ),
            )
            .limit(1);

        if (
          active.length
        ) {
          throw new WorkflowServiceError(
            "Another task is already active",
            409,
          );
        }

        const [team] =
          await tx
            .select({
              id:
                teams.id,
              enabled:
                teams.enabled,
            })
            .from(teams)
            .where(
              eq(
                teams.id,
                teamId,
              ),
            );

        if (
          !team
        ) {
          throw new WorkflowServiceError(
            "The selected team does not exist",
            404,
          );
        }

        if (
          !team.enabled
        ) {
          throw new WorkflowServiceError(
            "The selected team is disabled",
            409,
          );
        }

        const runnableWorkflow =
          await resolveRunnablePublishedWorkflow(
            tx,
            teamId,
          );

        if (
          !runnableWorkflow
        ) {
          throw new WorkflowServiceError(
            "The selected team has no runnable Published workflow. Update and publish the Draft workflow.",
            409,
          );
        }

        const workflowSnapshot =
          await snapshotFromGraphV2(
            tx,
            runnableWorkflow.revisionId,
            runnableWorkflow.graph,
          );

        const now =
          new Date();

        const [task] =
          await tx
            .insert(tasks)
            .values({
              teamId,
              projectPath:
                project.path,
              title:
                input.title,
              instruction:
                input.instruction,
              status:
                "running",
            })
            .returning();

        const [run] =
          await tx
            .insert(runs)
            .values({
              taskId:
                task.id,
              teamId:
                task.teamId,
              projectPath:
                project.path,
              status:
                "running",
              workflowSnapshot,
              workflowRevisionId:
                runnableWorkflow.revisionId,
              executionCount:
                0,
              updatedAt:
                now,
            })
            .returning();

        await freezeSnapshotAgentSkills(tx, run.id, workflowSnapshot);

        await tx
          .insert(
            domainEvents,
          )
          .values({
            type:
              "run.started",
            projectPath:
              run.projectPath,
            taskId:
              task.id,
            runId:
              run.id,
            data: {
              title:
                task.title,
            },
          });

        return {
          task,
          run,
        };
      },
    );

  const snapshot =
    snapshotOf(
      result.run,
    );

  void claimAndLaunchAgent(
    result.run.id,
    snapshot.agents[0].id,
  );

  return {
    task:
      serializeTask(
        result.task,
      ),
    run:
      serializeRun(
        result.run,
      ),
  };
}

/**
 * Lists persisted tasks newest first.
 */
export async function listTasks():
  Promise<Task[]> {
  return (
    await db
      .select()
      .from(tasks)
      .orderBy(
        desc(
          tasks.createdAt,
        ),
      )
  ).map(
    serializeTask,
  );
}

/**
 * Lists persisted runs newest first.
 */
export async function listRuns():
  Promise<Run[]> {
  return (
    await db
      .select()
      .from(runs)
      .orderBy(
        desc(
          runs.createdAt,
        ),
      )
  ).map(
    serializeRun,
  );
}

/**
 * Loads one run with its task, executions, and persisted business-event timeline.
 */
export async function getRunDetail(
  id: string,
): Promise<{
  run: Run;
  task: Task | null;
  executions: AgentExecution[];
  events: Awaited<
    ReturnType<
      typeof listRunEvents
    >
  >;
} | null> {
  const [run] =
    await db
      .select()
      .from(runs)
      .where(
        eq(
          runs.id,
          id,
        ),
      );

  if (
    !run
  ) {
    return null;
  }

  const rows =
    await db
      .select()
      .from(
        agentExecutions,
      )
      .where(
        eq(
          agentExecutions.runId,
          id,
        ),
      )
      .orderBy(
        asc(
          agentExecutions.createdAt,
        ),
      );

  const {
    getExecution,
  } =
    await import(
      "./agent-execution-service.js"
    );

  const executions =
    (
      await Promise.all(
        rows.map(
          (row) =>
            getExecution(
              row.id,
            ),
        ),
      )
    ).filter(
      (
        value,
      ): value is AgentExecution =>
        value !== null,
    );

  const [task] =
    run.taskId
      ? await db
          .select()
          .from(tasks)
          .where(
            eq(
              tasks.id,
              run.taskId,
            ),
          )
      : [];

  return {
    run:
      serializeRun(
        run,
      ),
    task:
      task
        ? serializeTask(
            task,
          )
        : null,
    executions,
    events:
      await listRunEvents(
        id,
      ),
  };
}

/**
 * Cancels an active run and its currently executing worker when one exists.
 */
export async function cancelRun(
  id: string,
): Promise<Run | null> {
  const [run] =
    await db
      .select()
      .from(runs)
      .where(
        eq(
          runs.id,
          id,
        ),
      );

  if (
    !run
  ) {
    return null;
  }

  if (
    run.status !==
      "running" &&
    run.status !==
      "pending"
  ) {
    throw new WorkflowServiceError(
      "Only an active run can be cancelled",
      409,
    );
  }

  const [execution] =
    await db
      .select()
      .from(
        agentExecutions,
      )
      .where(
        eq(
          agentExecutions.runId,
          id,
        ),
      )
      .orderBy(
        desc(
          agentExecutions.createdAt,
        ),
      )
      .limit(1);

  if (
    execution
  ) {
    await cancelLiveExecution(
      execution.id,
    );

    await db
      .update(
        agentExecutions,
      )
      .set({
        status:
          "cancelled",
        failureReason:
          "Cancelled by operator",
        completedAt:
          new Date(),
        updatedAt:
          new Date(),
      })
      .where(
        eq(
          agentExecutions.id,
          execution.id,
        ),
      );
  }

  await updateTerminal(
    run,
    "cancelled",
    "Cancelled by operator",
    run.currentAgentId ??
      undefined,
  );

  const [updated] =
    await db
      .select()
      .from(runs)
      .where(
        eq(
          runs.id,
          id,
        ),
      );

  return updated
    ? serializeRun(
        updated,
      )
    : null;
}

/**
 * Skips an active Notion-backed Auto Mode run, preserving the terminal audit trail before the scheduler advances.
 */
export async function skipRun(
  id: string,
): Promise<Run | null> {
  const [run] =
    await db
      .select()
      .from(runs)
      .where(
        eq(
          runs.id,
          id,
        ),
      );

  if (!run) {
    return null;
  }

  if (
    run.status !== "running" &&
    run.status !== "pending"
  ) {
    throw new WorkflowServiceError(
      "Only an active run can be skipped",
      409,
    );
  }

  if (!run.taskId) {
    throw new WorkflowServiceError(
      "Only Notion Auto Mode runs can be skipped",
      409,
    );
  }

  const [task] =
    await db
      .select()
      .from(tasks)
      .where(
        eq(
          tasks.id,
          run.taskId,
        ),
      );

  if (
    !task ||
    task.source !== "notion"
  ) {
    throw new WorkflowServiceError(
      "Only Notion Auto Mode runs can be skipped",
      409,
    );
  }

  const [execution] =
    await db
      .select()
      .from(agentExecutions)
      .where(
        eq(
          agentExecutions.runId,
          id,
        ),
      )
      .orderBy(
        desc(
          agentExecutions.createdAt,
        ),
      )
      .limit(1);

  if (execution) {
    await cancelLiveExecution(
      execution.id,
    );

    await db
      .update(agentExecutions)
      .set({
        status: "cancelled",
        failureReason: "Skipped by operator",
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        eq(
          agentExecutions.id,
          execution.id,
        ),
      );
  }

  await updateTerminal(
    run,
    "skipped",
    "Skipped by operator",
    run.currentAgentId ?? undefined,
  );

  const [updated] =
    await db
      .select()
      .from(runs)
      .where(
        eq(
          runs.id,
          id,
        ),
      );

  return updated
    ? serializeRun(updated)
    : null;
}

/**
 * Records an operator's manual review sign-off on one completed run's latest execution
 * result. This is the only supported way to turn a `"completed"` execution result into
 * `"approved"` when the configured workflow itself never produced that outcome, so a
 * human can unblock automation (for example Auto Mode intake) that specifically requires
 * an approved result before continuing. It never changes run status, workflow routing, or
 * repository state; it only records that a human reviewed and accepted the finished work.
 */
export async function approveRun(
  id: string,
): Promise<Run | null> {
  const [run] =
    await db
      .select()
      .from(runs)
      .where(
        eq(
          runs.id,
          id,
        ),
      );

  if (!run) {
    return null;
  }

  if (run.status !== "completed") {
    throw new WorkflowServiceError(
      "Only a completed run can be approved",
      409,
    );
  }

  const [execution] =
    await db
      .select()
      .from(agentExecutions)
      .where(
        eq(
          agentExecutions.runId,
          id,
        ),
      )
      .orderBy(
        desc(
          agentExecutions.createdAt,
        ),
      )
      .limit(1);

  if (!execution) {
    throw new WorkflowServiceError(
      "Run has no execution to approve",
      409,
    );
  }

  if (execution.resultStatus === "approved") {
    throw new WorkflowServiceError(
      "Run result is already approved",
      409,
    );
  }

  if (execution.resultStatus !== "completed") {
    throw new WorkflowServiceError(
      "Only a `completed` execution result can be approved",
      409,
    );
  }

  await db
    .update(agentExecutions)
    .set({
      resultStatus: "approved",
      updatedAt: new Date(),
    })
    .where(
      eq(
        agentExecutions.id,
        execution.id,
      ),
    );

  await recordEvent({
    type: "result.approved",
    projectPath: run.projectPath,
    taskId: run.taskId,
    runId: run.id,
    agentExecutionId: execution.id,
    data: {
      reason: "Approved by operator",
    },
  });

  return serializeRun(run);
}

/**
 * Records an operator resolution for a blocked or skipped Notion task whose
 * requested work was verified as already present in the selected repository.
 * The original terminal event remains in the audit trail; the terminal state
 * is corrected so lifecycle synchronization can report Done and intake may
 * continue.
 */
export async function completeVerifiedExistingNotionRun(
  id: string,
): Promise<Run | null> {
  const [run] = await db
    .select()
    .from(runs)
    .where(eq(runs.id, id));

  if (!run) return null;

  if ((run.status !== "blocked" && run.status !== "skipped") || !run.taskId) {
    throw new WorkflowServiceError(
      "Only a blocked or skipped Notion Auto Mode run can be completed as already implemented",
      409,
    );
  }

  const [task] = await db
    .select()
    .from(tasks)
    .where(eq(tasks.id, run.taskId));

  if (!task || task.source !== "notion") {
    throw new WorkflowServiceError(
      "Only a blocked or skipped Notion Auto Mode run can be completed as already implemented",
      409,
    );
  }

  const [execution] = await db
    .select()
    .from(agentExecutions)
    .where(eq(agentExecutions.runId, id))
    .orderBy(desc(agentExecutions.createdAt))
    .limit(1);

  if (!execution) {
    throw new WorkflowServiceError(
      "A completed-as-existing run requires an execution record",
      409,
    );
  }

  const now = new Date();
  const reason = "Completed by operator: verified already implemented";

  await db.transaction(async (tx) => {
    if (execution.resultStatus === "blocked") {
      await tx
        .update(agentExecutions)
        .set({
          status: "completed",
          resultStatus: "approved",
          resultPayload: {
            status: "approved",
            summary: reason,
            details: {
              operatorResolution: true,
              originalResultStatus: "blocked",
            },
            findings: [],
            filesChanged: [],
            commandsRun: [],
            validation: {},
            commit: null,
          },
          failureReason: null,
          updatedAt: now,
        })
        .where(eq(agentExecutions.id, execution.id));
    }

    await tx
      .update(runs)
      .set({
        status: "completed",
        currentAgentId: null,
        terminalReason: reason,
        updatedAt: now,
      })
      .where(and(eq(runs.id, id), inArray(runs.status, ["blocked", "skipped"])));

    await tx
      .update(tasks)
      .set({ status: "completed", updatedAt: now })
      .where(eq(tasks.id, task.id));

    await tx.insert(domainEvents).values({
      type: "run.completed",
      projectPath: run.projectPath,
      taskId: task.id,
      runId: run.id,
      agentExecutionId: execution.id,
      data: { reason, operatorResolution: "already_implemented" },
    });
  });

  requestAutoModeCycle();

  const [updated] = await db
    .select()
    .from(runs)
    .where(eq(runs.id, id));

  return updated ? serializeRun(updated) : null;
}

/**
 * Restarts the final snapshot agent of a failed or blocked run with optional
 * one-execution overrides while retaining the original immutable snapshot.
 */
export async function retryLastExecution(
  id:
    string,
  override?:
    RetryRun,
): Promise<Run | null> {
  const [run] =
    await db
      .select()
      .from(runs)
      .where(
        eq(
          runs.id,
          id,
        ),
      );

  if (
    !run
  ) {
    return null;
  }

  if (
    run.status !==
      "failed" &&
    run.status !==
      "blocked"
  ) {
    throw new WorkflowServiceError(
      "Only failed or blocked runs can be retried",
      409,
    );
  }

  const [execution] =
    await db
      .select()
      .from(
        agentExecutions,
      )
      .where(
        eq(
          agentExecutions.runId,
          id,
        ),
      )
      .orderBy(
        desc(
          agentExecutions.createdAt,
        ),
      )
      .limit(1);

  if (
    !execution
      ?.agentId
  ) {
    throw new WorkflowServiceError(
      "The final execution cannot be retried because its agent snapshot is unavailable",
      409,
    );
  }

  const snapshot =
    snapshotOf(
      run,
    );

  if (
    !snapshot.agents.some(
      (agent) =>
        agent.id ===
        execution.agentId,
    )
  ) {
    throw new WorkflowServiceError(
      "The final execution is outside this run's workflow snapshot",
      409,
    );
  }

  const updated =
    await db.transaction(
      async (tx) => {
        const now =
          new Date();

        const [retriedRun] =
          await tx
            .update(runs)
            .set({
              status:
                "running",
              currentAgentId:
                null,
              terminalReason:
                null,
              executionCount:
                run.executionCount >=
                  env.MAX_WORKFLOW_EXECUTIONS
                  ? 0
                  : run.executionCount,
              updatedAt:
                now,
            })
            .where(
              and(
                eq(
                  runs.id,
                  id,
                ),
                inArray(
                  runs.status,
                  [
                    "failed",
                    "blocked",
                  ],
                ),
                sql`${runs.currentAgentId} is null`,
              ),
            )
            .returning();

        if (
          !retriedRun
        ) {
          throw new WorkflowServiceError(
            "The run changed while the retry was being started",
            409,
          );
        }

        if (
          retriedRun.taskId
        ) {
          await tx
            .update(tasks)
            .set({
              status:
                "running",
              updatedAt:
                now,
            })
            .where(
              eq(
                tasks.id,
                retriedRun.taskId,
              ),
            );
        }

        await tx
          .insert(
            domainEvents,
          )
          .values({
            type:
              "execution.retried",
            projectPath:
              retriedRun.projectPath,
            taskId:
              retriedRun.taskId,
            runId:
              retriedRun.id,
            agentExecutionId:
              execution.id,
            data: {
              agentId:
                execution.agentId,
              ...(
                override
                  ? {
                      override,
                    }
                  : {}
              ),
              ...(
                run.executionCount >=
                env.MAX_WORKFLOW_EXECUTIONS
                  ? {
                      executionBudgetReset: true,
                    }
                  : {}
              ),
            },
          });

        return retriedRun;
      },
    );

  void claimAndLaunchAgent(
    id,
    execution.agentId,
    undefined,
    override,
  );

  return serializeRun(
    updated,
  );
}

/**
 * Blocks workflows left active by a previous server process without automatically resuming repository work.
 */
export async function recoverInterruptedWorkflows():
  Promise<void> {
  const active =
    await db
      .select()
      .from(runs)
      .where(
        inArray(
          runs.status,
          [
            "pending",
            "running",
          ],
        ),
      );

  for (
    const run of
    active
  ) {
    const recovered =
      await recoverPersistedTerminalResult(
        run,
      );

    if (
      recovered
    ) {
      continue;
    }

    const transitioned =
      await updateTerminal(
        run,
        "blocked",
        "Server restarted while this workflow was active; it was not resumed.",
      );

    if (
      !transitioned
    ) {
      continue;
    }

    await db
      .update(
        agentExecutions,
      )
      .set({
        status:
          "blocked",
        failureReason:
          "Server restarted while worker state was unavailable.",
        completedAt:
          new Date(),
        updatedAt:
          new Date(),
      })
      .where(
        and(
          eq(
            agentExecutions.runId,
            run.id,
          ),
          inArray(
            agentExecutions.status,
            [
              "pending",
              "starting",
              "running",
            ],
          ),
        ),
      );
  }
}

/**
 * Finalizes a durable worker result left behind by a server restart without
 * resuming any worker process. Only terminal workflow transitions are replayed;
 * a result that would hand off to another agent remains blocked for operator retry.
 */
async function recoverPersistedTerminalResult(
  run: typeof runs.$inferSelect,
): Promise<boolean> {
  if (
    !run.currentAgentId &&
    run.workflowSnapshot ===
      null
  ) {
    const [execution] =
      await db
        .select({
          status: agentExecutions.status,
          failureReason: agentExecutions.failureReason,
        })
        .from(agentExecutions)
        .where(
          eq(agentExecutions.runId, run.id),
        )
        .orderBy(desc(agentExecutions.createdAt))
        .limit(1);

    if (
      execution &&
      (
        execution.status === "completed" ||
        execution.status === "failed" ||
        execution.status === "blocked" ||
        execution.status === "cancelled"
      )
    ) {
      return updateTerminal(
        run,
        execution.status,
        execution.failureReason,
      );
    }

    return false;
  }

  if (
    !run.currentAgentId
  ) {
    return false;
  }

  const [execution] =
    await db
      .select()
      .from(agentExecutions)
      .where(
        and(
          eq(agentExecutions.runId, run.id),
          eq(agentExecutions.agentId, run.currentAgentId),
        ),
      )
      .orderBy(desc(agentExecutions.createdAt))
      .limit(1);

  if (
    !execution ||
    ![
      "completed",
      "failed",
      "blocked",
    ].includes(execution.status) ||
    !execution.resultStatus
  ) {
    return false;
  }

  const parsed =
    agentResultSchema.safeParse(
      execution.resultPayload,
    );

  if (
    !parsed.success ||
    parsed.data.status !==
      execution.resultStatus
  ) {
    return false;
  }

  let transition: WorkflowTransition;

  try {
    transition =
      resolveWorkflowTransition(
        snapshotOf(run),
        run.currentAgentId,
        execution.resultStatus,
        execution.failureReason,
      );
  } catch {
    return false;
  }

  if (
    transition.kind !==
    "terminal"
  ) {
    return false;
  }

  const applied =
    await applyFinalizationTransition(
      run.id,
      run.currentAgentId,
      execution.id,
      execution.resultStatus,
      execution.failureReason,
      parsed.data,
    );

  return applied !== null;
}
