import assert from "node:assert/strict";

import type {
  RunMonitoringSummary,
} from "@orc/shared";

import {
  deriveRunCollection,
  filterRunCollection,
  getRunCollectionState,
  getRunProjectName,
  getRunProjectOptions,
  sortRunCollection,
} from "./run-collection";

const TEAM_ID =
  "00000000-0000-4000-9000-000000000001";

/**
 * Creates deterministic Run summary input for collection helper verification.
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
      "2026-09-10T00:00:00.000Z",
    updatedAt:
      "2026-09-10T00:10:00.000Z",
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
 * Verifies search, status, and project filters compose without mutating unrelated Run data.
 */
function testFiltering(): void {
  const shop =
    createRun();
  const billing =
    createRun({
      projectPath:
        "/workspace/billing-api",
      taskTitle:
        "Fix payment timeout",
      status:
        "failed",
    });

  assert.deepEqual(
    filterRunCollection(
      [
        shop,
        billing,
      ],
      {
        search:
          "payment",
        status:
          "failed",
        projectPath:
          "/workspace/billing-api",
      },
    ).map(
      (run) =>
        run.id,
    ),
    [
      billing.id,
    ],
  );
}

/**
 * Verifies newest-first and oldest-first ordering use persisted Run creation time.
 */
function testSorting(): void {
  const older =
    createRun({
      createdAt:
        "2026-09-09T00:00:00.000Z",
    });
  const newer =
    createRun({
      createdAt:
        "2026-09-11T00:00:00.000Z",
    });

  assert.deepEqual(
    sortRunCollection(
      [
        older,
        newer,
      ],
      "newest",
    ).map(
      (run) =>
        run.id,
    ),
    [
      newer.id,
      older.id,
    ],
  );

  assert.deepEqual(
    sortRunCollection(
      [
        older,
        newer,
      ],
      "oldest",
    ).map(
      (run) =>
        run.id,
    ),
    [
      older.id,
      newer.id,
    ],
  );
}

/**
 * Verifies project options are unique, path-backed, and consistently labeled.
 */
function testProjectOptions(): void {
  const runs = [
    createRun({
      projectPath:
        "/workspace/shop-portal",
    }),
    createRun({
      projectPath:
        "/workspace/billing-api",
    }),
    createRun({
      projectPath:
        "/workspace/shop-portal",
    }),
  ];

  assert.equal(
    getRunProjectName(
      "/workspace/shop-portal/",
    ),
    "shop-portal",
  );

  assert.deepEqual(
    getRunProjectOptions(
      runs,
    ),
    [
      {
        value:
          "/workspace/billing-api",
        label:
          "billing-api",
      },
      {
        value:
          "/workspace/shop-portal",
        label:
          "shop-portal",
      },
    ],
  );
}

/**
 * Verifies every presentation mode can consume one deterministic collection result instead of recomputing data.
 */
function testViewIndependentCollection(): void {
  const older =
    createRun({
      taskTitle:
        "Older task",
      createdAt:
        "2026-09-09T00:00:00.000Z",
    });
  const newer =
    createRun({
      taskTitle:
        "Newer task",
      createdAt:
        "2026-09-11T00:00:00.000Z",
    });

  const result =
    deriveRunCollection(
      [
        older,
        newer,
      ],
      {
        search:
          "",
        status:
          "all",
        projectPath:
          "all",
      },
      "newest",
    );

  assert.deepEqual(
    result.map(
      (run) =>
        run.id,
    ),
    [
      newer.id,
      older.id,
    ],
  );
}

/**
 * Verifies the collection distinguishes true emptiness from filters that temporarily hide every Run.
 */
function testEmptyStates(): void {
  assert.equal(
    getRunCollectionState(
      0,
      0,
      {
        search:
          "",
        status:
          "all",
        projectPath:
          "all",
      },
    ),
    "empty",
  );

  assert.equal(
    getRunCollectionState(
      4,
      0,
      {
        search:
          "missing",
        status:
          "all",
        projectPath:
          "all",
      },
    ),
    "filtered-empty",
  );
}

testFiltering();
testSorting();
testProjectOptions();
testViewIndependentCollection();
testEmptyStates();

console.log(
  "run collection helper tests passed",
);
