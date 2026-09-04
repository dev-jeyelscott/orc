import assert from "node:assert/strict";

import type {
  AgentExecution,
  DomainEvent,
  RunMonitoringDetail,
} from "@orc/shared";

import {
  executionPlanPosition,
  getExecutionHandoffEvents,
  isExecutionRetryable,
} from "./agent-execution-detail-state";

/**
 * Creates one deterministic execution suitable for execution-detail state tests.
 */
function createExecution(
  input:
    Partial<AgentExecution> = {},
): AgentExecution {
  return {
    id:
      crypto.randomUUID(),
    runId:
      crypto.randomUUID(),
    agentId:
      crypto.randomUUID(),
    agentName:
      "Generic Worker",
    agentRole:
      "Implementation",
    layer: 1,
    executionOrder: 1,
    harness:
      "codex",
    model:
      "default",
    reasoning:
      "high",
    status:
      "failed",
    pid: null,
    startedAt:
      "2026-09-04T00:00:00.000Z",
    completedAt:
      "2026-09-04T00:05:00.000Z",
    exitCode: 1,
    resultStatus:
      "failed",
    resultPayload: {
      status:
        "failed",
      summary:
        "Execution failed",
      details: {},
      findings: [],
      filesChanged: [],
      commandsRun: [],
      validation: {},
      commit: null,
    },
    tokenUsage: null,
    contextUsage: null,
    commitHash: null,
    failureReason:
      "Validation failed",
    repairAttempted:
      false,
    createdAt:
      "2026-09-04T00:00:00.000Z",
    updatedAt:
      "2026-09-04T00:05:00.000Z",
    ...input,
  };
}

/**
 * Creates one domain event associated with an execution-detail test.
 */
function createEvent(
  input:
    Partial<DomainEvent> = {},
): DomainEvent {
  return {
    id:
      crypto.randomUUID(),
    type:
      "workflow.transition",
    projectPath:
      "/workspace/test",
    taskId: null,
    runId:
      crypto.randomUUID(),
    agentExecutionId:
      null,
    data: {},
    createdAt:
      "2026-09-04T00:06:00.000Z",
    ...input,
  };
}

/**
 * Creates monitoring detail with an immutable plan matching the supplied executions.
 */
function createDetail(
  executions:
    AgentExecution[],
  status:
    RunMonitoringDetail["run"]["status"] =
      "failed",
  events:
    DomainEvent[] = [],
): RunMonitoringDetail {
  const runId =
    executions[0]
      ?.runId ??
    crypto.randomUUID();

  return {
    run: {
      id:
        runId,
      taskId: null,
      projectPath:
        "/workspace/test",
      status,
      currentAgentId:
        null,
      executionCount:
        executions.length,
      terminalReason:
        null,
      createdAt:
        "2026-09-04T00:00:00.000Z",
      updatedAt:
        "2026-09-04T00:10:00.000Z",
    },
    task: null,
    executions,
    events,
    executionPlan:
      executions
        .filter(
          (
            execution,
          ) =>
            execution.agentId !==
            null,
        )
        .map(
          (
            execution,
          ) => ({
            id:
              execution.agentId as string,
            name:
              execution.agentName,
            role:
              execution.agentRole,
            layer:
              execution.layer,
            executionOrder:
              execution.executionOrder,
            harness:
              execution.harness,
            model:
              execution.model,
            reasoning:
              execution.reasoning,
          }),
        ),
  };
}

/**
 * Verifies Retry is exposed only for the newest execution of a failed or blocked run.
 */
function testRetryBoundary(): void {
  const runId =
    crypto.randomUUID();

  const older =
    createExecution({
      runId,
      createdAt:
        "2026-09-04T00:00:00.000Z",
    });

  const latest =
    createExecution({
      runId,
      createdAt:
        "2026-09-04T00:10:00.000Z",
    });

  const failedDetail =
    createDetail([
      older,
      latest,
    ]);

  assert.equal(
    isExecutionRetryable(
      failedDetail,
      latest,
    ),
    true,
  );

  assert.equal(
    isExecutionRetryable(
      failedDetail,
      older,
    ),
    false,
  );

  assert.equal(
    isExecutionRetryable(
      createDetail(
        [
          latest,
        ],
        "completed",
      ),
      latest,
    ),
    false,
  );

  const deletedAgentExecution =
    createExecution({
      runId,
      agentId: null,
      createdAt:
        "2026-09-04T00:20:00.000Z",
    });

  assert.equal(
    isExecutionRetryable(
      createDetail([
        deletedAgentExecution,
      ]),
      deletedAgentExecution,
    ),
    false,
  );
}

/**
 * Verifies layer and global workflow-step presentation remain separate concepts.
 */
function testPlanPosition(): void {
  const runId =
    crypto.randomUUID();

  const first =
    createExecution({
      runId,
      layer: 1,
      executionOrder: 1,
    });

  const second =
    createExecution({
      runId,
      layer: 2,
      executionOrder: 1,
    });

  const third =
    createExecution({
      runId,
      layer: 3,
      executionOrder: 1,
    });

  const position =
    executionPlanPosition(
      createDetail([
        first,
        second,
        third,
      ]),
      second,
    );

  assert.deepEqual(
    position,
    {
      step: 2,
      total: 3,
      maxLayer: 3,
    },
  );
}

/**
 * Verifies the Handoffs tab includes only persisted routing activity related to the selected execution.
 */
function testHandoffFiltering(): void {
  const execution =
    createExecution();

  const matchingByExecution =
    createEvent({
      agentExecutionId:
        execution.id,
      type:
        "execution.retried",
    });

  const matchingByAgent =
    createEvent({
      type:
        "workflow.transition",
      data: {
        sourceAgentId:
          execution.agentId,
      },
      createdAt:
        "2026-09-04T00:07:00.000Z",
    });

  const unrelated =
    createEvent({
      type:
        "result.received",
      agentExecutionId:
        execution.id,
    });

  const detail =
    createDetail(
      [
        execution,
      ],
      "failed",
      [
        matchingByAgent,
        unrelated,
        matchingByExecution,
      ],
    );

  assert.deepEqual(
    getExecutionHandoffEvents(
      detail,
      execution,
    ).map(
      (
        event,
      ) =>
        event.id,
    ),
    [
      matchingByExecution.id,
      matchingByAgent.id,
    ],
  );
}

testRetryBoundary();
testPlanPosition();
testHandoffFiltering();

console.log(
  "agent-execution-detail-state helper tests passed",
);
