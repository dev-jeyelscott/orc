import {
  eq,
} from "drizzle-orm";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  db,
} from "../db/client.js";
import {
  projectTeamAssignments,
  runs,
  tasks,
} from "../db/schema.js";
import {
  runAutoModeCycle,
} from "./auto-mode-service.js";

const projectPath =
  `/tmp/orc-manual-gating-${crypto.randomUUID()}`;

/**
 * Removes the test workflow rows without affecting unrelated development data.
 */
async function cleanupManualGatingData(): Promise<void> {
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

/**
 * Creates one active manually sourced workflow that must block automatic Notion intake.
 */
async function createActiveManualWorkflow(): Promise<void> {
  const [task] =
    await db
      .insert(tasks)
      .values({
        projectPath,
        title:
          "Manual gating test",
        instruction:
          "Keep the global workflow slot occupied.",
        status:
          "running",
        source:
          "manual",
      })
      .returning();

  await db
    .insert(runs)
    .values({
      taskId:
        task.id,
      projectPath,
      status:
        "running",
    });
}

let suspendedAssignments:
  Array<{
    projectPath:
      string;
    autoModeEnabled:
      boolean;
  }> = [];

/**
 * Temporarily disables every Auto Mode Project assignment that predates this test file (real
 * Project automation configured outside these tests) so a global intake cycle sees no
 * automation-ready Team unless a given test explicitly creates one.
 */
beforeEach(
  async () => {
    suspendedAssignments =
      await db
        .select({
          projectPath:
            projectTeamAssignments.projectPath,
          autoModeEnabled:
            projectTeamAssignments.autoModeEnabled,
        })
        .from(projectTeamAssignments)
        .where(
          eq(
            projectTeamAssignments.autoModeEnabled,
            true,
          ),
        );

    await db
      .update(projectTeamAssignments)
      .set({
        autoModeEnabled:
          false,
      })
      .where(
        eq(
          projectTeamAssignments.autoModeEnabled,
          true,
        ),
      );
  },
);

afterEach(
  async () => {
    await cleanupManualGatingData();

    for (
      const assignment of
      suspendedAssignments
    ) {
      await db
        .update(projectTeamAssignments)
        .set({
          autoModeEnabled:
            assignment.autoModeEnabled,
        })
        .where(
          eq(
            projectTeamAssignments.projectPath,
            assignment.projectPath,
          ),
        );
    }

    suspendedAssignments = [];
  },
);

describe.sequential(
  "Auto Mode manual-task gating",
  () => {
    it(
      "does not query or claim Notion work while a manual workflow is active",
      async () => {
        await createActiveManualWorkflow();

        const createNotionAdapter =
          vi.fn(
            () => ({
              getNextReadyTask:
                vi.fn(),
              updateStatus:
                vi.fn(),
            }),
          );

        const startExistingTask =
          vi.fn();

        await runAutoModeCycle(
          {
            createNotionAdapter,
            startExistingTask,
          },
        );

        expect(
          createNotionAdapter,
        ).not.toHaveBeenCalled();

        expect(
          startExistingTask,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "does no source or claim work when no Project has an automation-ready Team",
      async () => {
        const createNotionAdapter =
          vi.fn();

        const startExistingTask =
          vi.fn();

        await runAutoModeCycle(
          {
            createNotionAdapter,
            startExistingTask,
          },
        );

        expect(
          createNotionAdapter,
        ).not.toHaveBeenCalled();

        expect(
          startExistingTask,
        ).not.toHaveBeenCalled();
      },
    );
  },
);
