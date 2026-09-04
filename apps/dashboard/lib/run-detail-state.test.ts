import assert from "node:assert/strict";

import type {
  AgentExecution,
  RunMonitoringDetail,
} from "@orc/shared";

import {
  currentRunStateLabel,
  executionProgress,
  isRunActive,
  isRunRetryable,
  runStatusVariant,
  selectPreferredExecutionId,
  terminalRunDurationMs,
} from "./run-detail-state";

/**
 * Creates one deterministic persisted execution for Run Detail state verification.
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
    harness: "codex",
    model: "default",
    reasoning: "high",
    status: "completed",
    pid: null,
    startedAt:
      "2026-09-04T00:00:00.000Z",
    completedAt:
      "2026-09-04T00:05:00.000Z",
    exitCode: 0,
    resultStatus:
      "completed",
    resultPayload: {
      status:
        "completed",
      summary: "Done",
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
    failureReason: null,
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
 * Creates one deterministic monitoring detail for current-state verification.
 */
function createDetail(
  executions:
    AgentExecution[],
): RunMonitoringDetail {
  return {
    run: {
      id:
        crypto.randomUUID(),
      taskId: null,
      projectPath:
        "/workspace/test",
      status: "running",
      currentAgentId:
        executions[
          executions.length - 1
        ]?.agentId ??
        null,
      executionCount:
        executions.length,
      terminalReason: null,
      createdAt:
        "2026-09-04T00:00:00.000Z",
      updatedAt:
        "2026-09-04T00:10:00.000Z",
    },
    task: null,
    executions,
    events: [],
    executionPlan: [],
  };
}

/**
 * Verifies selection prefers live work and otherwise uses the latest persisted attempt.
 */
function testPreferredExecution(): void {
  const completed =
    createExecution({
      createdAt:
        "2026-09-04T00:00:00.000Z",
    });

  const running =
    createExecution({
      status: "running",
      completedAt: null,
      exitCode: null,
      resultStatus: null,
      resultPayload: null,
      createdAt:
        "2026-09-04T00:10:00.000Z",
    });

  assert.equal(
    selectPreferredExecutionId([
      completed,
      running,
    ]),
    running.id,
  );

  const latest =
    createExecution({
      createdAt:
        "2026-09-04T00:20:00.000Z",
    });

  assert.equal(
    selectPreferredExecutionId([
      completed,
      latest,
    ]),
    latest.id,
  );
}

/**
 * Verifies operator current-state text comes only from persisted execution/run state.
 */
function testCurrentState(): void {
  const running =
    createExecution({
      status: "running",
      completedAt: null,
      exitCode: null,
      resultStatus: null,
      resultPayload: null,
    });

  assert.equal(
    currentRunStateLabel(
      createDetail([
        running,
      ]),
    ),
    "Executing",
  );
}

/**
 * Verifies plan progress remains bounded even when retries exceed configured plan length.
 */
function testProgress(): void {
  assert.equal(
    executionProgress(
      3,
      6,
    ),
    50,
  );

  assert.equal(
    executionProgress(
      8,
      6,
    ),
    100,
  );

  assert.equal(
    executionProgress(
      3,
      0,
    ),
    0,
  );
}

/**
 * Verifies run actions and badge semantics remain tied to persisted lifecycle state.
 */
function testRunStatePredicates(): void {
  assert.equal(
    isRunActive(
      "running",
    ),
    true,
  );

  assert.equal(
    isRunRetryable(
      "blocked",
    ),
    true,
  );

  assert.equal(
    runStatusVariant(
      "failed",
    ),
    "error",
  );
}

/**
 * Verifies duration is exposed only for terminal runs with valid persisted timestamps.
 */
function testTerminalDuration(): void {
  const detail =
    createDetail([]);

  assert.equal(
    terminalRunDurationMs(
      detail.run,
    ),
    null,
  );

  assert.equal(
    terminalRunDurationMs({
      ...detail.run,
      status:
        "completed",
      updatedAt:
        "2026-09-04T00:10:00.000Z",
    }),
    10 * 60 * 1000,
  );
}

testPreferredExecution();
testCurrentState();
testProgress();
testRunStatePredicates();
testTerminalDuration();

console.log(
  "run-detail-state helper tests passed",
);
