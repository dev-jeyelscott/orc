import {
  eq,
} from "drizzle-orm";
import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  db,
} from "../db/client.js";
import {
  DEVELOPMENT_TEAM_ID,
  RESOLUTION_TEAM_ID,
} from "../db/seed-ids.js";
import {
  agentExecutions,
  runs,
  tasks,
} from "../db/schema.js";
import {
  evaluateAutoModeEligibility,
} from "./auto-mode-service.js";

const projectPath =
  `/tmp/orc-auto-mode-team-eligibility-${crypto.randomUUID()}`;

const createdRunIds =
  new Set<string>();

/**
 * Inserts one Task and Run owned by the given Team for eligibility isolation tests.
 */
async function createTeamRun(
  teamId:
    string,
  runStatus:
    "pending" | "running" | "completed" | "failed" | "blocked" | "cancelled",
  resultStatus:
    "approved" | "changes_requested" | null = null,
  timestamp:
    Date = new Date(
      "2099-01-01T00:00:00.000Z",
    ),
) {
  const [task] =
    await db
      .insert(tasks)
      .values({
        teamId,
        projectPath,
        title:
          "Team eligibility isolation task",
        instruction:
          "Validate Team-local eligibility isolation.",
        status:
          runStatus,
        source:
          "manual",
        createdAt:
          timestamp,
        updatedAt:
          timestamp,
      })
      .returning();

  const [run] =
    await db
      .insert(runs)
      .values({
        teamId,
        taskId:
          task.id,
        projectPath,
        status:
          runStatus,
        createdAt:
          timestamp,
        updatedAt:
          timestamp,
      })
      .returning();

  createdRunIds.add(
    run.id,
  );

  if (
    resultStatus !== null
  ) {
    await db
      .insert(
        agentExecutions,
      )
      .values({
        runId:
          run.id,
        agentName:
          "QA",
        agentRole:
          "Reviewer",
        layer:
          3,
        executionOrder:
          1,
        harness:
          "codex",
        model:
          "default",
        reasoning:
          "medium",
        status:
          "completed",
        resultStatus,
        completedAt:
          timestamp,
        createdAt:
          timestamp,
        updatedAt:
          timestamp,
      });
  }

  return {
    task,
    run,
  };
}

/**
 * Removes eligibility test data without touching unrelated development records.
 */
async function cleanup(): Promise<void> {
  for (
    const runId of
    createdRunIds
  ) {
    await db
      .delete(
        agentExecutions,
      )
      .where(
        eq(
          agentExecutions.runId,
          runId,
        ),
      );
  }

  createdRunIds.clear();

  await db
    .delete(runs)
    .where(
      eq(
        runs.projectPath,
        projectPath,
      ),
    );

  await db
    .delete(tasks)
    .where(
      eq(
        tasks.projectPath,
        projectPath,
      ),
    );
}

afterEach(
  cleanup,
);

describe.sequential(
  "Auto Mode Team-local eligibility isolation",
  () => {
    it(
      "never lets Resolution Team's recent approval history affect Development Team's own eligibility",
      async () => {
        await createTeamRun(
          RESOLUTION_TEAM_ID,
          "completed",
          "approved",
        );

        // Resolution's own history now reflects a just-approved completion (ready or cooldown
        // depending on the configured post-approval delay); the important assertion is that
        // Development, with no history of its own, is entirely unaffected by it.
        await evaluateAutoModeEligibility(
          RESOLUTION_TEAM_ID,
          new Date(
            "2099-01-01T00:00:01.000Z",
          ),
        );

        const development =
          await evaluateAutoModeEligibility(
            DEVELOPMENT_TEAM_ID,
            new Date(
              "2099-01-01T00:00:01.000Z",
            ),
          );

        expect(
          development.state,
        ).toBe(
          "ready",
        );

        expect(
          development.eligible,
        ).toBe(
          true,
        );
      },
    );

    it(
      "never lets Resolution Team failed/blocked history block Development Team",
      async () => {
        await createTeamRun(
          RESOLUTION_TEAM_ID,
          "blocked",
        );

        const resolution =
          await evaluateAutoModeEligibility(
            RESOLUTION_TEAM_ID,
            new Date(
              "2099-01-01T00:00:01.000Z",
            ),
          );

        expect(
          resolution.eligible,
        ).toBe(
          false,
        );

        const development =
          await evaluateAutoModeEligibility(
            DEVELOPMENT_TEAM_ID,
            new Date(
              "2099-01-01T00:00:01.000Z",
            ),
          );

        expect(
          development.eligible,
        ).toBe(
          true,
        );

        expect(
          development.state,
        ).toBe(
          "ready",
        );
      },
    );

    it(
      "blocks both Teams from claiming while any Team's Run is active, without collapsing one Team's status into the other's",
      async () => {
        await createTeamRun(
          RESOLUTION_TEAM_ID,
          "running",
        );

        const resolution =
          await evaluateAutoModeEligibility(
            RESOLUTION_TEAM_ID,
          );

        expect(
          resolution,
        ).toMatchObject({
          eligible:
            false,
          state:
            "running",
          blockedByActiveRun:
            true,
        });

        const development =
          await evaluateAutoModeEligibility(
            DEVELOPMENT_TEAM_ID,
          );

        expect(
          development.eligible,
        ).toBe(
          false,
        );

        expect(
          development.blockedByActiveRun,
        ).toBe(
          true,
        );

        expect(
          development.state,
        ).not.toBe(
          "running",
        );
      },
    );
  },
);
