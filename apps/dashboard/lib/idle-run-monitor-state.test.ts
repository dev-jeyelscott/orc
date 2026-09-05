import assert from "node:assert/strict";

import type {
  AgentExecution,
  RunMonitoringDetail,
  RunMonitoringSummary,
} from "@orc/shared";

import {
  IDLE_RUN_THRESHOLD_MS,
  isIdleRunEligible,
  nextIdleDialogRunId,
  selectActiveRun,
  selectIdleRunExecution,
} from "./idle-run-monitor-state";

const RUN_ONE_ID =
  "10000000-0000-4000-8000-000000000001";

const RUN_TWO_ID =
  "10000000-0000-4000-8000-000000000002";

const EXECUTION_ONE_ID =
  "20000000-0000-4000-8000-000000000001";

const EXECUTION_TWO_ID =
  "20000000-0000-4000-8000-000000000002";

const AGENT_ONE_ID =
  "30000000-0000-4000-8000-000000000001";

const AGENT_TWO_ID =
  "30000000-0000-4000-8000-000000000002";

/**
 * Creates one deterministic persisted monitoring summary for idle-run tests.
 */
function createRunSummary(
  status:
    RunMonitoringSummary["status"],
  id:
    string = RUN_ONE_ID,
): RunMonitoringSummary {
  return {
    id,
    taskId: null,
    projectPath:
      "/workspace/orc",
    status,
    currentAgentId: null,
    executionCount: 0,
    terminalReason: null,
    createdAt:
      "2026-09-05T00:00:00.000Z",
    updatedAt:
      "2026-09-05T00:00:00.000Z",
    taskTitle:
      "Idle monitor test",
    plannedExecutionCount:
      2,
    currentAgent: null,
  };
}

/**
 * Creates one deterministic persisted execution for preferred-execution tests.
 */
function createExecution(
  input:
    Partial<AgentExecution> = {},
): AgentExecution {
  return {
    id:
      EXECUTION_ONE_ID,
    runId:
      RUN_ONE_ID,
    agentId:
      AGENT_ONE_ID,
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
      "completed",
    pid: null,
    startedAt:
      "2026-09-05T00:00:00.000Z",
    completedAt:
      "2026-09-05T00:05:00.000Z",
    exitCode: 0,
    resultStatus:
      "completed",
    resultPayload: {
      status:
        "completed",
      summary:
        "Done",
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
      "2026-09-05T00:00:00.000Z",
    updatedAt:
      "2026-09-05T00:05:00.000Z",
    ...input,
  };
}

/**
 * Creates one deterministic monitoring detail aggregate for execution-selection tests.
 */
function createDetail(
  executions:
    AgentExecution[],
): RunMonitoringDetail {
  return {
    run: {
      id:
        RUN_ONE_ID,
      taskId: null,
      projectPath:
        "/workspace/orc",
      status:
        "running",
      currentAgentId:
        executions[
          executions.length -
            1
        ]?.agentId ??
        null,
      executionCount:
        executions.length,
      terminalReason: null,
      createdAt:
        "2026-09-05T00:00:00.000Z",
      updatedAt:
        "2026-09-05T00:10:00.000Z",
    },
    task: null,
    executions,
    events: [],
    executionPlan: [],
  };
}

/**
 * Verifies inactivity alone cannot open the dialog when no persisted run is active.
 */
function testNoActiveRunWhileIdle(): void {
  const runs = [
    createRunSummary(
      "completed",
    ),
  ];

  assert.equal(
    selectActiveRun(
      runs,
    ),
    null,
  );

  assert.equal(
    nextIdleDialogRunId({
      monitoringSucceeded:
        true,
      openRunId: null,
      activeRunId: null,
      idleEligible:
        true,
    }),
    null,
  );
}

/**
 * Verifies an active run opens only after the exact sixty-second threshold.
 */
function testActiveRunBeforeAndAfterThreshold(): void {
  const beforeThreshold =
    isIdleRunEligible({
      now:
        IDLE_RUN_THRESHOLD_MS -
        1,
      lastActivityAt: 0,
      visibilityState:
        "visible",
    });

  const atThreshold =
    isIdleRunEligible({
      now:
        IDLE_RUN_THRESHOLD_MS,
      lastActivityAt: 0,
      visibilityState:
        "visible",
    });

  assert.equal(
    beforeThreshold,
    false,
  );

  assert.equal(
    atThreshold,
    true,
  );

  assert.equal(
    nextIdleDialogRunId({
      monitoringSucceeded:
        true,
      openRunId: null,
      activeRunId:
        RUN_ONE_ID,
      idleEligible:
        beforeThreshold,
    }),
    null,
  );

  assert.equal(
    nextIdleDialogRunId({
      monitoringSucceeded:
        true,
      openRunId: null,
      activeRunId:
        RUN_ONE_ID,
      idleEligible:
        atThreshold,
    }),
    RUN_ONE_ID,
  );
}

/**
 * Verifies fresh dashboard activity restarts the complete inactivity interval.
 */
function testActivityResetsThreshold(): void {
  assert.equal(
    isIdleRunEligible({
      now: 120_000,
      lastActivityAt:
        70_000,
      visibilityState:
        "visible",
    }),
    false,
  );

  assert.equal(
    isIdleRunEligible({
      now: 130_000,
      lastActivityAt:
        70_000,
      visibilityState:
        "visible",
    }),
    true,
  );
}

/**
 * Verifies hidden-tab elapsed time counts without permitting a visible dialog open.
 */
function testHiddenTabElapsedTime(): void {
  assert.equal(
    isIdleRunEligible({
      now: 120_000,
      lastActivityAt: 0,
      visibilityState:
        "hidden",
    }),
    false,
  );
}

/**
 * Verifies returning to a visible tab immediately restores eligibility from the original activity time.
 */
function testVisibleTabReturnEligibility(): void {
  assert.equal(
    isIdleRunEligible({
      now: 120_000,
      lastActivityAt: 0,
      visibilityState:
        "visible",
    }),
    true,
  );
}

/**
 * Verifies manual dismissal behaves like new user activity before the same run may reopen.
 */
function testManualCloseStartsFreshInactivityPeriod(): void {
  const closedAt =
    100_000;

  assert.equal(
    isIdleRunEligible({
      now:
        closedAt +
        IDLE_RUN_THRESHOLD_MS -
        1,
      lastActivityAt:
        closedAt,
      visibilityState:
        "visible",
    }),
    false,
  );

  assert.equal(
    isIdleRunEligible({
      now:
        closedAt +
        IDLE_RUN_THRESHOLD_MS,
      lastActivityAt:
        closedAt,
      visibilityState:
        "visible",
    }),
    true,
  );
}

/**
 * Verifies the terminal and inspector move to the newest active execution within one run.
 */
function testAgentExecutionChangesWithinRun(): void {
  const completed =
    createExecution();

  const running =
    createExecution({
      id:
        EXECUTION_TWO_ID,
      agentId:
        AGENT_TWO_ID,
      agentName:
        "Next Worker",
      status:
        "running",
      pid: 1234,
      startedAt:
        "2026-09-05T00:06:00.000Z",
      completedAt: null,
      exitCode: null,
      resultStatus: null,
      resultPayload: null,
      createdAt:
        "2026-09-05T00:06:00.000Z",
      updatedAt:
        "2026-09-05T00:06:00.000Z",
    });

  const selected =
    selectIdleRunExecution(
      createDetail([
        completed,
        running,
      ]),
    );

  assert.equal(
    selected?.id,
    running.id,
  );
}

/**
 * Verifies authoritative terminal run state closes an already-open dialog.
 */
function testActiveRunBecomesTerminal(): void {
  assert.equal(
    nextIdleDialogRunId({
      monitoringSucceeded:
        true,
      openRunId:
        RUN_ONE_ID,
      activeRunId: null,
      idleEligible:
        true,
    }),
    null,
  );
}

/**
 * Verifies a different active run replaces the prior run immediately when inactivity remains satisfied.
 */
function testDifferentRunStartsWhileIdle(): void {
  assert.equal(
    nextIdleDialogRunId({
      monitoringSucceeded:
        true,
      openRunId:
        RUN_ONE_ID,
      activeRunId:
        RUN_TWO_ID,
      idleEligible:
        true,
    }),
    RUN_TWO_ID,
  );
}

/**
 * Verifies a different run waits when recent interaction has reset inactivity.
 */
function testDifferentRunStartsAfterRecentActivity(): void {
  assert.equal(
    nextIdleDialogRunId({
      monitoringSucceeded:
        true,
      openRunId:
        RUN_ONE_ID,
      activeRunId:
        RUN_TWO_ID,
      idleEligible:
        false,
    }),
    null,
  );
}

/**
 * Verifies monitoring failure preserves the previously confirmed open run.
 */
function testMonitoringFailureDoesNotCompleteRun(): void {
  assert.equal(
    nextIdleDialogRunId({
      monitoringSucceeded:
        false,
      openRunId:
        RUN_ONE_ID,
      activeRunId: null,
      idleEligible:
        false,
    }),
    RUN_ONE_ID,
  );
}

/**
 * Verifies active-run selection uses persisted lifecycle state rather than terminal output.
 */
function testActiveRunSelection(): void {
  const completed =
    createRunSummary(
      "completed",
      RUN_TWO_ID,
    );

  const running =
    createRunSummary(
      "running",
      RUN_ONE_ID,
    );

  assert.equal(
    selectActiveRun([
      completed,
      running,
    ])?.id,
    RUN_ONE_ID,
  );
}

testNoActiveRunWhileIdle();
testActiveRunBeforeAndAfterThreshold();
testActivityResetsThreshold();
testHiddenTabElapsedTime();
testVisibleTabReturnEligibility();
testManualCloseStartsFreshInactivityPeriod();
testAgentExecutionChangesWithinRun();
testActiveRunBecomesTerminal();
testDifferentRunStartsWhileIdle();
testDifferentRunStartsAfterRecentActivity();
testMonitoringFailureDoesNotCompleteRun();
testActiveRunSelection();

console.log(
  "idle-run-monitor-state helper tests passed",
);
