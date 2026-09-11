import assert from "node:assert/strict";
import type {
  Run,
  Task,
} from "@orc/shared";

import {
  DEFAULT_TASK_SORT_ORDER,
  DEFAULT_TASK_VIEW_MODE,
  buildLatestRunByTaskId,
  canCancelRun,
  canRetryRun,
  canSkipRun,
  getVisibleTasks,
  matchesTaskQuery,
  normalizeTaskInstruction,
  sortTasks,
} from "./task-collection-state";

/**
 * Creates a complete Task fixture while allowing each focused test to override
 * only the fields relevant to the behavior under test.
 */
function createTask(
  overrides:
    Partial<Task> = {},
): Task {
  return {
    id:
      "11111111-1111-4111-8111-111111111111",
    teamId:
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    projectPath:
      "/home/developer/workspace/orc",
    title:
      "Redesign Tasks",
    instruction:
      "Redesign the Tasks interface while preserving current behavior.",
    status:
      "pending",
    source:
      "manual",
    externalId:
      null,
    externalUrl:
      null,
    priority:
      0,
    createdAt:
      "2026-09-10T10:00:00.000Z",
    updatedAt:
      "2026-09-10T10:00:00.000Z",
    ...overrides,
  };
}

/**
 * Creates a complete Run fixture for latest-run and state-aware action tests.
 */
function createRun(
  overrides:
    Partial<Run> = {},
): Run {
  return {
    id:
      "22222222-2222-4222-8222-222222222222",
    teamId:
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    projectPath:
      "/home/developer/workspace/orc",
    taskId:
      "11111111-1111-4111-8111-111111111111",
    status:
      "pending",
    currentAgentId:
      null,
    executionCount:
      0,
    terminalReason:
      null,
    createdAt:
      "2026-09-10T10:00:00.000Z",
    updatedAt:
      "2026-09-10T10:00:00.000Z",
    ...overrides,
  };
}

/**
 * Verifies Table and newest-first ordering remain the default collection
 * presentation.
 */
function testCollectionDefaults(): void {
  assert.equal(
    DEFAULT_TASK_VIEW_MODE,
    "table",
  );

  assert.equal(
    DEFAULT_TASK_SORT_ORDER,
    "newest",
  );
}

/**
 * Verifies long instructions become compact normalized previews without
 * changing the underlying Task instruction value.
 */
function testInstructionPreview(): void {
  assert.equal(
    normalizeTaskInstruction(
      "First line\n\nSecond   line",
      40,
    ),
    "First line Second line",
  );

  assert.equal(
    normalizeTaskInstruction(
      "abcdefghijklmnopqrstuvwxyz",
      10,
    ),
    "abcdefg...",
  );
}

/**
 * Verifies task search includes instruction text and resolved Team names.
 */
function testTaskSearch(): void {
  const task =
    createTask();

  assert.equal(
    matchesTaskQuery(
      task,
      "preserving current",
      "Development",
    ),
    true,
  );

  assert.equal(
    matchesTaskQuery(
      task,
      "development",
      "Development",
    ),
    true,
  );

  assert.equal(
    matchesTaskQuery(
      task,
      "resolution",
      "Development",
    ),
    false,
  );
}

/**
 * Verifies creation-time ordering is stable in both supported directions.
 */
function testTaskSorting(): void {
  const older =
    createTask({
      id:
        "11111111-1111-4111-8111-111111111110",
      title:
        "Older task",
      createdAt:
        "2026-09-09T10:00:00.000Z",
    });

  const newer =
    createTask({
      id:
        "11111111-1111-4111-8111-111111111112",
      title:
        "Newer task",
      createdAt:
        "2026-09-11T10:00:00.000Z",
    });

  assert.deepEqual(
    sortTasks(
      [
        older,
        newer,
      ],
      "newest",
    ).map(
      (task) =>
        task.title,
    ),
    [
      "Newer task",
      "Older task",
    ],
  );

  assert.deepEqual(
    sortTasks(
      [
        newer,
        older,
      ],
      "oldest",
    ).map(
      (task) =>
        task.title,
    ),
    [
      "Older task",
      "Newer task",
    ],
  );
}

/**
 * Verifies every collection view can consume the same filtered and sorted Task
 * array rather than implementing view-specific data rules.
 */
function testVisibleTasks(): void {
  const teams =
    new Map([
      [
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "Development",
      ],
    ]);

  const first =
    createTask({
      id:
        "11111111-1111-4111-8111-111111111110",
      title:
        "Older Development task",
      createdAt:
        "2026-09-09T10:00:00.000Z",
    });

  const second =
    createTask({
      id:
        "11111111-1111-4111-8111-111111111112",
      title:
        "Recent Development task",
      createdAt:
        "2026-09-11T10:00:00.000Z",
    });

  assert.deepEqual(
    getVisibleTasks(
      [
        first,
        second,
      ],
      "development",
      teams,
      "newest",
    ).map(
      (task) =>
        task.id,
    ),
    [
      second.id,
      first.id,
    ],
  );
}

/**
 * Verifies latest Run resolution remains correct when API results are
 * intentionally supplied out of order.
 */
function testLatestRunIndex(): void {
  const oldRun =
    createRun({
      id:
        "22222222-2222-4222-8222-222222222220",
      createdAt:
        "2026-09-09T10:00:00.000Z",
    });

  const latestRun =
    createRun({
      id:
        "22222222-2222-4222-8222-222222222222",
      createdAt:
        "2026-09-11T10:00:00.000Z",
    });

  const index =
    buildLatestRunByTaskId(
      [
        latestRun,
        oldRun,
      ],
    );

  assert.equal(
    index.get(
      latestRun.taskId!,
    )?.id,
    latestRun.id,
  );
}

/**
 * Verifies collection actions expose only backend-supported states and keep
 * Notion skip behavior source-aware.
 */
function testActionEligibility(): void {
  const manualTask =
    createTask();

  const notionTask =
    createTask({
      source:
        "notion",
    });

  const runningRun =
    createRun({
      status:
        "running",
    });

  const failedRun =
    createRun({
      status:
        "failed",
    });

  assert.equal(
    canCancelRun(
      runningRun,
    ),
    true,
  );

  assert.equal(
    canRetryRun(
      failedRun,
    ),
    true,
  );

  assert.equal(
    canRetryRun(
      runningRun,
    ),
    false,
  );

  assert.equal(
    canSkipRun(
      manualTask,
      runningRun,
    ),
    false,
  );

  assert.equal(
    canSkipRun(
      notionTask,
      runningRun,
    ),
    true,
  );
}

testCollectionDefaults();
testInstructionPreview();
testTaskSearch();
testTaskSorting();
testVisibleTasks();
testLatestRunIndex();
testActionEligibility();

console.log(
  "task collection state tests passed",
);
