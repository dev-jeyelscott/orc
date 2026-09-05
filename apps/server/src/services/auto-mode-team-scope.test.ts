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

import type {
  Project,
} from "@orc/shared";

import {
  db,
} from "../db/client.js";
import {
  RESOLUTION_TEAM_ID,
} from "../db/seed-ids.js";
import {
  runs,
  tasks,
} from "../db/schema.js";
import {
  runAutoModeCycle,
  type AutoModeNotionAdapter,
} from "./auto-mode-service.js";

const project:
  Project =
    {
      id:
        "auto-mode-team-test-project",
      name:
        "orc",
      path:
        `/tmp/orc-auto-mode-team-${crypto.randomUUID()}`,
      branch:
        "main",
      gitState:
        "clean",
      primaryFiles: [
        "package.json",
      ],
      packageManager:
        "pnpm",
      stack:
        "node",
    };

/**
 * Removes local Auto Mode test rows after every Team ownership assertion.
 */
async function cleanup(): Promise<void> {
  await db
    .delete(runs)
    .where(
      eq(
        runs.projectPath,
        project.path,
      ),
    );

  await db
    .delete(tasks)
    .where(
      eq(
        tasks.projectPath,
        project.path,
      ),
    );
}

afterEach(
  cleanup,
);

describe.sequential(
  "Auto Mode Team scope",
  () => {
    it(
      "assigns newly persisted Notion Tasks to Resolution Team",
      async () => {
        const externalId =
          crypto.randomUUID();

        const getNextReadyTask =
          vi.fn()
            .mockResolvedValue({
              source:
                "notion" as const,
              externalId,
              externalUrl:
                `https://www.notion.so/${externalId}`,
              title:
                "Team-scoped Notion Task",
              instruction:
                "# Task\n\nExecute this task.",
              priority:
                100,
              project,
            });

        const updateStatus =
          vi.fn()
            .mockResolvedValue(
              undefined,
            );

        const adapter = {
          getNextReadyTask,
          updateStatus,
        } satisfies
          AutoModeNotionAdapter;

        const startExistingTask =
          vi.fn()
            .mockResolvedValue(
              {},
            );

        await runAutoModeCycle({
          getSettings:
            async () => ({
              autoModeEnabled:
                true,
            }),
          evaluateEligibility:
            async () => ({
              eligible:
                true,
              state:
                "ready",
              nextEligibleAt:
                null,
            }),
          isEnabled:
            async () =>
              true,
          createNotionAdapter:
            () =>
              adapter,
          startExistingTask,
        });

        const [persisted] =
          await db
            .select()
            .from(tasks)
            .where(
              eq(
                tasks.externalId,
                externalId,
              ),
            );

        expect(
          persisted.teamId,
        ).toBe(
          RESOLUTION_TEAM_ID,
        );

        expect(
          persisted.source,
        ).toBe(
          "notion",
        );

        expect(
          startExistingTask,
        ).toHaveBeenCalledWith(
          persisted.id,
        );
      },
    );
  },
);
