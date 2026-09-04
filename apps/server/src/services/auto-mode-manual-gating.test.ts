import {
  eq,
} from "drizzle-orm";
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  db,
} from "../db/client.js";
import {
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

afterEach(
  async () => {
    await cleanupManualGatingData();
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

        await runAutoModeCycle({
          getSettings:
            async () => ({
              autoModeEnabled:
                true,
            }),
          createNotionAdapter,
          startExistingTask,
        });

        expect(
          createNotionAdapter,
        ).not.toHaveBeenCalled();

        expect(
          startExistingTask,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "does no eligibility, source, or claim work when Auto Mode is already off",
      async () => {
        const evaluateEligibility =
          vi.fn();

        const createNotionAdapter =
          vi.fn();

        const startExistingTask =
          vi.fn();

        await runAutoModeCycle({
          getSettings:
            async () => ({
              autoModeEnabled:
                false,
            }),
          evaluateEligibility,
          createNotionAdapter,
          startExistingTask,
        });

        expect(
          evaluateEligibility,
        ).not.toHaveBeenCalled();

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
