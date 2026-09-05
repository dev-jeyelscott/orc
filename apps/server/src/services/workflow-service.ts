import {
  and,
  asc,
  desc,
  eq,
  inArray,
  sql,
} from "drizzle-orm";

import type {
  AgentExecution,
  AgentResultStatus,
  CreateTask,
  RetryRun,
  Run,
  Task,
  TaskWithRun,
} from "@orc/shared";

import { env } from "../config/env.js";
import { db } from "../db/client.js";
import {
  agentExecutions,
  agentRoutes,
  agents,
  domainEvents,
  runs,
  tasks,
  teams,
} from "../db/schema.js";
import { composeHandoffNote } from "../runtime/index.js";
import {
  cancelLiveExecution,
  startSnapshotAgentExecution,
  type ExecutionFinalization,
  type SnapshotAgent,
} from "./agent-execution-service.js";
import { listRunEvents, recordEvent } from "./event-service.js";
import { getProject, getProjectByPath } from "./project-discovery.js";
import { requestAutoModeCycle } from "./auto-mode-signal.js";

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

type WorkflowSnapshot = {
  agents: SnapshotAgent[];
  routes: SnapshotRoute[];
};

type TransitionOrigin =
  | "explicit"
  | "default"
  | "fallback"
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
 * Creates an immutable run-owned workflow snapshot from current agent configuration.
 */
function snapshotFromRows(
  agentRows:
    Array<
      typeof agents.$inferSelect
    >,
  routeRows:
    Array<
      typeof agentRoutes.$inferSelect
    >,
): WorkflowSnapshot {
  const orderedAgents =
    orderWorkflowAgents(
      agentRows,
    );

  const enabledIds =
    new Set(
      orderedAgents.map(
        (agent) =>
          agent.id,
      ),
    );

  return {
    agents:
      orderedAgents.map(
        (agent) => ({
          id:
            agent.id,
          name:
            agent.name,
          role:
            agent.role,
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
          systemPrompt:
            agent.systemPrompt,
          canWrite:
            agent.canWrite,
          canRunCommands:
            agent.canRunCommands,
          canCommit:
            agent.canCommit,
        }),
      ),
    routes:
      routeRows
        .filter(
          (route) =>
            route.enabled &&
            enabledIds.has(
              route.sourceAgentId,
            ) &&
            (
              !route.targetAgentId ||
              enabledIds.has(
                route.targetAgentId,
              )
            ),
        )
        .map(
          (route) => ({
            sourceAgentId:
              route.sourceAgentId,
            outcome:
              route.outcome,
            targetAgentId:
              route.targetAgentId ??
              null,
            terminalAction:
              route.terminalAction ??
              null,
          }),
        ),
  };
}

/**
 * Reads the workflow snapshot persisted with a run and rejects malformed snapshots.
 */
function snapshotOf(
  row: typeof runs.$inferSelect,
): WorkflowSnapshot {
  const snapshot =
    row.workflowSnapshot as
      WorkflowSnapshot | null;

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

  return snapshot;
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
 * Resolves one structured result into an explicit route, default progression, or terminal fallback.
 */
function resolveWorkflowTransition(
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
    | "cancelled",
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
 * Starts a worker whose run row has already atomically claimed that agent.
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

    const instruction =
      handoffNote
        ? `${baseInstruction}\n\n${handoffNote}`
        : baseInstruction;

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
 * Atomically persists a structured result transition and either claims the next agent or terminates the run.
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
    finalization.result &&
    applied.sourceAgent
      ? composeHandoffNote(
          applied.sourceAgent,
          finalization.result,
        )
      : undefined;

  await launchClaimedAgent(
    applied.run,
    applied.targetAgent,
    handoffNote,
  );
}

/**
 * Validates that a Team exists, remains enabled, and has at least one enabled worker.
 */
async function requireRunnableTeam(
  teamId:
    string,
): Promise<void> {
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

  const [enabledAgent] =
    await db
      .select({
        id:
          agents.id,
      })
      .from(agents)
      .where(
        and(
          eq(
            agents.teamId,
            teamId,
          ),
          eq(
            agents.enabled,
            true,
          ),
        ),
      )
      .limit(1);

  if (
    !enabledAgent
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

  await requireRunnableTeam(
    input.teamId,
  );

  const [task] =
    await db
      .insert(tasks)
      .values({
        teamId:
          input.teamId,
        projectPath:
          project.path,
        title:
          input.title,
        instruction:
          input.instruction,
        status:
          "pending",
      })
      .returning();

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
 * Starts a pending task through the normal snapshotted workflow execution path.
 */
export async function startTask(
  id: string,
): Promise<
  TaskWithRun | null
> {
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

        const enabledAgents =
          await tx
            .select()
            .from(agents)
            .where(
              and(
                eq(
                  agents.teamId,
                  currentTask.teamId,
                ),
                eq(
                  agents.enabled,
                  true,
                ),
              ),
            )
            .orderBy(
              asc(
                agents.layer,
              ),
              asc(
                agents.executionOrder,
              ),
            );

        if (
          !enabledAgents.length
        ) {
          throw new WorkflowServiceError(
            "The selected team has no enabled agents",
            409,
          );
        }

        const routes =
          await tx
            .select()
            .from(
              agentRoutes,
            )
            .where(
              eq(
                agentRoutes.enabled,
                true,
              ),
            );

        const workflowSnapshot =
          snapshotFromRows(
            enabledAgents,
            routes,
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
              executionCount:
                0,
              updatedAt:
                now,
            })
            .returning();

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
 * Creates a task and immutable workflow snapshot, then starts its first configured worker.
 */
export async function createAndStartTask(
  input:
    CreateTask,
): Promise<TaskWithRun> {
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
                input.teamId,
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

        const enabledAgents =
          await tx
            .select()
            .from(agents)
            .where(
              and(
                eq(
                  agents.teamId,
                  input.teamId,
                ),
                eq(
                  agents.enabled,
                  true,
                ),
              ),
            )
            .orderBy(
              asc(
                agents.layer,
              ),
              asc(
                agents.executionOrder,
              ),
            );

        if (
          !enabledAgents.length
        ) {
          throw new WorkflowServiceError(
            "The selected team has no enabled agents",
            409,
          );
        }

        const routes =
          await tx
            .select()
            .from(
              agentRoutes,
            )
            .where(
              eq(
                agentRoutes.enabled,
                true,
              ),
            );

        const workflowSnapshot =
          snapshotFromRows(
            enabledAgents,
            routes,
          );

        const now =
          new Date();

        const [task] =
          await tx
            .insert(tasks)
            .values({
              teamId:
                input.teamId,
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
              executionCount:
                0,
              updatedAt:
                now,
            })
            .returning();

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
export async function listTasks(): Promise<Task[]> {
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
export async function listRuns(): Promise<Run[]> {
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
 * Restarts the final snapshot agent of a failed or blocked run with optional one-execution overrides.
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
export async function recoverInterruptedWorkflows(): Promise<void> {
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
