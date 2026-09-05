import assert from "node:assert/strict";

import type {
  AgentExecution,
  RunMonitoringDetail,
  RunMonitoringSummary,
  WorkflowPlanAgent,
} from "@orc/shared";

import {
  aggregateRunUsage,
  buildRunsOverTime,
  calculateRunMetrics,
  deriveWorkflowSteps,
  filterRunSummaries,
  normalizeContextUsage,
  normalizeTokenUsage,
} from "./run-observability";

const TEAM_ID =
  "00000000-0000-4000-9000-000000000001";

/**
 * Creates a deterministic Team-scoped monitoring summary for pure helper verification.
 */
function createRun(
  input:
    Partial<RunMonitoringSummary> = {},
): RunMonitoringSummary {
  return {
    id:
      crypto.randomUUID(),
    taskId:
      crypto.randomUUID(),
    teamId:
      TEAM_ID,
    projectPath:
      "/workspace/shop-portal",
    status:
      "completed",
    currentAgentId:
      null,
    executionCount:
      1,
    terminalReason:
      null,
    createdAt:
      "2026-09-04T00:00:00.000Z",
    updatedAt:
      "2026-09-04T00:10:00.000Z",
    taskTitle:
      "Implement checkout retry flow",
    plannedExecutionCount:
      3,
    currentAgent:
      null,
    ...input,
  };
}

/**
 * Creates a deterministic workflow-plan Agent.
 */
function createPlanAgent(
  input:
    Partial<WorkflowPlanAgent> = {},
): WorkflowPlanAgent {
  return {
    id:
      crypto.randomUUID(),
    name:
      "Generic Worker",
    role:
      "Implementation",
    layer:
      1,
    executionOrder:
      1,
    harness:
      "codex",
    model:
      "default",
    reasoning:
      "high",
    ...input,
  };
}

/**
 * Creates a deterministic persisted execution.
 */
function createExecution(
  agent:
    WorkflowPlanAgent,
  input:
    Partial<AgentExecution> = {},
): AgentExecution {
  return {
    id:
      crypto.randomUUID(),
    runId:
      crypto.randomUUID(),
    agentId:
      agent.id,
    agentName:
      agent.name,
    agentRole:
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
    status:
      "completed",
    pid:
      1234,
    startedAt:
      "2026-09-04T00:00:00.000Z",
    completedAt:
      "2026-09-04T00:05:00.000Z",
    exitCode:
      0,
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
      commit:
        null,
    },
    tokenUsage:
      null,
    contextUsage:
      null,
    commitHash:
      null,
    failureReason:
      null,
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
 * Verifies status and text filtering remain deterministic.
 */
function testFiltering(): void {
  const completed =
    createRun();

  const failed =
    createRun({
      id:
        crypto.randomUUID(),
      taskTitle:
        "Fix payment timeout",
      projectPath:
        "/workspace/billing-api",
      status:
        "failed",
    });

  assert.deepEqual(
    filterRunSummaries(
      [
        completed,
        failed,
      ],
      "payment",
      "all",
    ).map(
      (
        run,
      ) =>
        run.id,
    ),
    [
      failed.id,
    ],
  );

  assert.deepEqual(
    filterRunSummaries(
      [
        completed,
        failed,
      ],
      "",
      "completed",
    ).map(
      (
        run,
      ) =>
        run.id,
    ),
    [
      completed.id,
    ],
  );
}

/**
 * Verifies success-rate denominator and median duration semantics.
 */
function testMetrics(): void {
  const runs = [
    createRun({
      status:
        "completed",
      updatedAt:
        "2026-09-04T00:10:00.000Z",
    }),
    createRun({
      status:
        "failed",
      updatedAt:
        "2026-09-04T00:20:00.000Z",
    }),
    createRun({
      status:
        "blocked",
      updatedAt:
        "2026-09-04T00:30:00.000Z",
    }),
    createRun({
      status:
        "cancelled",
      updatedAt:
        "2026-09-04T00:40:00.000Z",
    }),
  ];

  const metrics =
    calculateRunMetrics(
      runs,
    );

  assert.equal(
    Math.round(
      metrics.successRate ??
        0,
    ),
    33,
  );

  assert.equal(
    metrics.failedBlocked,
    2,
  );

  assert.equal(
    metrics.medianDurationMs,
    25 * 60 * 1000,
  );
}

/**
 * Verifies known usage shapes normalize and unknown shapes fail closed.
 */
function testUsage(): void {
  assert.deepEqual(
    normalizeTokenUsage({
      input_tokens:
        100,
      output_tokens:
        50,
    }),
    {
      inputTokens:
        100,
      outputTokens:
        50,
      cachedTokens:
        null,
      totalTokens:
        150,
    },
  );

  assert.equal(
    normalizeTokenUsage({
      mystery:
        100,
    }),
    null,
  );

  assert.deepEqual(
    normalizeContextUsage({
      used_tokens:
        500,
      limit_tokens:
        1000,
    }),
    {
      percent:
        50,
      usedTokens:
        500,
      limitTokens:
        1000,
    },
  );

  const agent =
    createPlanAgent();

  const aggregate =
    aggregateRunUsage([
      createExecution(
        agent,
        {
          tokenUsage: {
            input_tokens:
              100,
            output_tokens:
              50,
          },
          contextUsage: {
            used_tokens:
              500,
            limit_tokens:
              1000,
          },
        },
      ),
    ]);

  assert.equal(
    aggregate.tokens
      ?.totalTokens,
    150,
  );

  assert.equal(
    aggregate.context
      ?.percent,
    50,
  );
}

/**
 * Verifies pipeline state comes from snapshot data and persisted execution attempts.
 */
function testWorkflowPlan(): void {
  const first =
    createPlanAgent({
      name:
        "Worker A",
      layer:
        1,
      executionOrder:
        1,
    });

  const second =
    createPlanAgent({
      name:
        "Worker B",
      layer:
        2,
      executionOrder:
        1,
    });

  const runId =
    crypto.randomUUID();

  const execution =
    createExecution(
      first,
      {
        runId,
      },
    );

  const detail:
    RunMonitoringDetail =
      {
        run: {
          id:
            runId,
          taskId:
            crypto.randomUUID(),
          teamId:
            TEAM_ID,
          projectPath:
            "/workspace/test",
          status:
            "running",
          currentAgentId:
            second.id,
          executionCount:
            2,
          terminalReason:
            null,
          createdAt:
            "2026-09-04T00:00:00.000Z",
          updatedAt:
            "2026-09-04T00:05:00.000Z",
        },
        task:
          null,
        executions: [
          execution,
        ],
        events: [],
        executionPlan: [
          first,
          second,
        ],
      };

  const steps =
    deriveWorkflowSteps(
      detail,
      Date.parse(
        "2026-09-04T00:10:00.000Z",
      ),
    );

  assert.equal(
    steps[0].state,
    "completed",
  );

  assert.equal(
    steps[1].state,
    "running",
  );
}

/**
 * Verifies chart bucketing counts only persisted Run creation timestamps inside the window.
 */
function testChartBuckets(): void {
  const now =
    Date.parse(
      "2026-09-04T01:00:00.000Z",
    );

  const buckets =
    buildRunsOverTime(
      [
        createRun({
          createdAt:
            "2026-09-04T00:30:00.000Z",
        }),
        createRun({
          createdAt:
            "2026-09-04T00:45:00.000Z",
        }),
      ],
      "1h",
      now,
      10,
    );

  assert.equal(
    buckets.reduce(
      (
        total,
        bucket,
      ) =>
        total +
        bucket.count,
      0,
    ),
    2,
  );
}

testFiltering();
testMetrics();
testUsage();
testWorkflowPlan();
testChartBuckets();

console.log(
  "run-observability helper tests passed",
);
