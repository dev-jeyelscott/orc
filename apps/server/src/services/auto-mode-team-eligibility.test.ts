import {
  eq,
  inArray,
} from "drizzle-orm";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  db,
} from "../db/client.js";
import {
  agentExecutions,
  runs,
  tasks,
  teams,
} from "../db/schema.js";
import {
  evaluateProjectAutoModeEligibility,
} from "./auto-mode-service.js";

const projectPath =
  `/tmp/orc-auto-mode-team-eligibility-${crypto.randomUUID()}`;

const resolutionTeamId =
  crypto.randomUUID();

const developmentTeamId =
  crypto.randomUUID();

const createdRunIds =
  new Set<string>();

/**
 * Creates isolated Team fixtures so assertions never depend on mutable seeded Team history.
 */
async function createTestTeams(): Promise<void> {
  await db
    .insert(teams)
    .values([
      {
        id:
          resolutionTeamId,
        slug:
          `eligibility-resolution-${crypto.randomUUID()}`,
        name:
          "Eligibility Resolution Team",
      },
      {
        id:
          developmentTeamId,
        slug:
          `eligibility-development-${crypto.randomUUID()}`,
        name:
          "Eligibility Development Team",
      },
    ]);
}

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

  await db
    .delete(teams)
    .where(
      inArray(
        teams.id,
        [
          resolutionTeamId,
          developmentTeamId,
        ],
      ),
    );
}

beforeEach(
  createTestTeams,
);

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
          resolutionTeamId,
          "completed",
          "approved",
        );

        await evaluateProjectAutoModeEligibility(
          projectPath,
          resolutionTeamId,
          new Date(
            "2099-01-01T00:00:01.000Z",
          ),
        );

        const development =
          await evaluateProjectAutoModeEligibility(
            projectPath,
            developmentTeamId,
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
          resolutionTeamId,
          "blocked",
        );

        const resolution =
          await evaluateProjectAutoModeEligibility(
            projectPath,
            resolutionTeamId,
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
          await evaluateProjectAutoModeEligibility(
            projectPath,
            developmentTeamId,
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
          resolutionTeamId,
          "running",
        );

        const resolution =
          await evaluateProjectAutoModeEligibility(
            projectPath,
            resolutionTeamId,
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
          await evaluateProjectAutoModeEligibility(
            projectPath,
            developmentTeamId,
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
