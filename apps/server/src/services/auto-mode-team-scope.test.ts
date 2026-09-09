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
  DEVELOPMENT_TEAM_ID,
  RESOLUTION_TEAM_ID,
} from "../db/seed-ids.js";
import {
  runs,
  tasks,
} from "../db/schema.js";
import {
  runAutoModeCycle,
  type AutoModeCycleDependencies,
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

const alwaysEligible =
  async () => ({
    eligible:
      true as const,
    state:
      "ready" as const,
    nextEligibleAt:
      null,
    blockedByActiveRun:
      false,
  });

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

/**
 * Creates a mock Notion adapter that returns exactly one candidate (or none) with direct Vitest handles.
 */
function createTeamAdapter(
  candidate:
    | {
        externalId:
          string;
        priority:
          number;
        createdTime:
          string;
      }
    | null,
) {
  const getNextReadyTask =
    vi.fn()
      .mockResolvedValue(
        candidate
          ? {
              source:
                "notion" as const,
              externalId:
                candidate.externalId,
              externalUrl:
                `https://www.notion.so/${candidate.externalId}`,
              title:
                `Team-scoped Notion Task ${candidate.externalId}`,
              instruction:
                "# Task\n\nExecute this task.",
              priority:
                candidate.priority,
              createdTime:
                candidate.createdTime,
              project,
            }
          : null,
      );

  const updateStatus =
    vi.fn()
      .mockResolvedValue(
        undefined,
      );

  return {
    getNextReadyTask,
    updateStatus,
    adapter: {
      getNextReadyTask,
      updateStatus,
    } satisfies
      AutoModeNotionAdapter,
  };
}

/**
 * Runs one multi-Team cycle with both Teams treated as automation-ready and eligible, dispatching each Team's
 * adapter factory call to the matching mock adapter.
 */
async function runTeamScopeCycle(
  adapters: {
    resolution?:
      AutoModeNotionAdapter;
    development?:
      AutoModeNotionAdapter;
  },
  startExistingTask:
    (
      id:
        string,
    ) => Promise<unknown>,
  overrides:
    AutoModeCycleDependencies = {},
) {
  await runAutoModeCycle({
    listAutomationReadyTeamIds:
      async () => [
        RESOLUTION_TEAM_ID,
        DEVELOPMENT_TEAM_ID,
      ],
    isTeamAutomationReady:
      async () =>
        true,
    evaluateEligibility:
      alwaysEligible,
    createNotionAdapter:
      (
        teamId,
      ) => {
        const adapter =
          teamId ===
          RESOLUTION_TEAM_ID
            ? adapters.resolution
            : adapters.development;

        if (
          !adapter
        ) {
          throw new Error(
            `No adapter configured for Team ${teamId}`,
          );
        }

        return adapter;
      },
    startExistingTask,
    ...overrides,
  });
}

describe.sequential(
  "Auto Mode Team scope",
  () => {
    it(
      "assigns newly persisted Notion Tasks to Resolution Team when only Resolution has Ready work",
      async () => {
        const resolutionExternalId =
          crypto.randomUUID();

        const resolution =
          createTeamAdapter({
            externalId:
              resolutionExternalId,
            priority:
              100,
            createdTime:
              "2099-01-01T00:00:00.000Z",
          });

        const development =
          createTeamAdapter(
            null,
          );

        const startExistingTask =
          vi.fn()
            .mockResolvedValue(
              {},
            );

        await runTeamScopeCycle(
          {
            resolution:
              resolution.adapter,
            development:
              development.adapter,
          },
          startExistingTask,
        );

        const [persisted] =
          await db
            .select()
            .from(tasks)
            .where(
              eq(
                tasks.externalId,
                resolutionExternalId,
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

        expect(
          development.updateStatus,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "assigns newly persisted Notion Tasks to Development Team when only Development has Ready work",
      async () => {
        const developmentExternalId =
          crypto.randomUUID();

        const resolution =
          createTeamAdapter(
            null,
          );

        const development =
          createTeamAdapter({
            externalId:
              developmentExternalId,
            priority:
              100,
            createdTime:
              "2099-01-01T00:00:00.000Z",
          });

        const startExistingTask =
          vi.fn()
            .mockResolvedValue(
              {},
            );

        await runTeamScopeCycle(
          {
            resolution:
              resolution.adapter,
            development:
              development.adapter,
          },
          startExistingTask,
        );

        const [persisted] =
          await db
            .select()
            .from(tasks)
            .where(
              eq(
                tasks.externalId,
                developmentExternalId,
              ),
            );

        expect(
          persisted.teamId,
        ).toBe(
          DEVELOPMENT_TEAM_ID,
        );

        expect(
          startExistingTask,
        ).toHaveBeenCalledWith(
          persisted.id,
        );

        expect(
          resolution.updateStatus,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "selects the globally lowest-numbered priority candidate across Teams",
      async () => {
        const resolutionExternalId =
          crypto.randomUUID();

        const developmentExternalId =
          crypto.randomUUID();

        const resolution =
          createTeamAdapter({
            externalId:
              resolutionExternalId,
            priority:
              7,
            createdTime:
              "2099-01-01T00:00:00.000Z",
          });

        const development =
          createTeamAdapter({
            externalId:
              developmentExternalId,
            priority:
              1,
            createdTime:
              "2099-01-02T00:00:00.000Z",
          });

        const startExistingTask =
          vi.fn()
            .mockResolvedValue(
              {},
            );

        await runTeamScopeCycle(
          {
            resolution:
              resolution.adapter,
            development:
              development.adapter,
          },
          startExistingTask,
        );

        expect(
          development.updateStatus,
        ).toHaveBeenCalledWith(
          developmentExternalId,
          "In Progress",
        );

        expect(
          resolution.updateStatus,
        ).not.toHaveBeenCalled();

        const [loser] =
          await db
            .select()
            .from(tasks)
            .where(
              eq(
                tasks.externalId,
                resolutionExternalId,
              ),
            );

        expect(
          loser,
        ).toBeUndefined();
      },
    );

    it(
      "selects the older Notion page when priority ties across Teams",
      async () => {
        const resolutionExternalId =
          crypto.randomUUID();

        const developmentExternalId =
          crypto.randomUUID();

        const resolution =
          createTeamAdapter({
            externalId:
              resolutionExternalId,
            priority:
              100,
            createdTime:
              "2099-01-01T00:00:00.000Z",
          });

        const development =
          createTeamAdapter({
            externalId:
              developmentExternalId,
            priority:
              100,
            createdTime:
              "2099-01-02T00:00:00.000Z",
          });

        const startExistingTask =
          vi.fn()
            .mockResolvedValue(
              {},
            );

        await runTeamScopeCycle(
          {
            resolution:
              resolution.adapter,
            development:
              development.adapter,
          },
          startExistingTask,
        );

        expect(
          resolution.updateStatus,
        ).toHaveBeenCalledWith(
          resolutionExternalId,
          "In Progress",
        );

        expect(
          development.updateStatus,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "breaks an exact priority and creation-time tie deterministically by Team id then external id",
      async () => {
        const createdTime =
          "2099-01-01T00:00:00.000Z";

        const resolution =
          createTeamAdapter({
            externalId:
              "zzzz-tie-external-id",
            priority:
              100,
            createdTime,
          });

        const development =
          createTeamAdapter({
            externalId:
              "aaaa-tie-external-id",
            priority:
              100,
            createdTime,
          });

        const startExistingTask =
          vi.fn()
            .mockResolvedValue(
              {},
            );

        await runTeamScopeCycle(
          {
            resolution:
              resolution.adapter,
            development:
              development.adapter,
          },
          startExistingTask,
        );

        // RESOLUTION_TEAM_ID < DEVELOPMENT_TEAM_ID lexically, so Resolution wins the stable tie break
        // regardless of external id ordering.
        expect(
          resolution.updateStatus,
        ).toHaveBeenCalledWith(
          "zzzz-tie-external-id",
          "In Progress",
        );

        expect(
          development.updateStatus,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "leaves the losing Team's candidate Ready and unpersisted",
      async () => {
        const resolutionExternalId =
          crypto.randomUUID();

        const developmentExternalId =
          crypto.randomUUID();

        const resolution =
          createTeamAdapter({
            externalId:
              resolutionExternalId,
            priority:
              7,
            createdTime:
              "2099-01-01T00:00:00.000Z",
          });

        const development =
          createTeamAdapter({
            externalId:
              developmentExternalId,
            priority:
              1,
            createdTime:
              "2099-01-01T00:00:00.000Z",
          });

        const startExistingTask =
          vi.fn()
            .mockResolvedValue(
              {},
            );

        await runTeamScopeCycle(
          {
            resolution:
              resolution.adapter,
            development:
              development.adapter,
          },
          startExistingTask,
        );

        expect(
          resolution.updateStatus,
        ).not.toHaveBeenCalled();

        const [loserTask] =
          await db
            .select()
            .from(tasks)
            .where(
              eq(
                tasks.externalId,
                resolutionExternalId,
              ),
            );

        expect(
          loserTask,
        ).toBeUndefined();

        expect(
          startExistingTask,
        ).toHaveBeenCalledTimes(
          1,
        );
      },
    );

    it(
      "never starts more than one Task in a single cycle",
      async () => {
        const resolution =
          createTeamAdapter({
            externalId:
              crypto.randomUUID(),
            priority:
              50,
            createdTime:
              "2099-01-01T00:00:00.000Z",
          });

        const development =
          createTeamAdapter({
            externalId:
              crypto.randomUUID(),
            priority:
              200,
            createdTime:
              "2099-01-01T00:00:00.000Z",
          });

        const startExistingTask =
          vi.fn()
            .mockResolvedValue(
              {},
            );

        await runTeamScopeCycle(
          {
            resolution:
              resolution.adapter,
            development:
              development.adapter,
          },
          startExistingTask,
        );

        expect(
          startExistingTask,
        ).toHaveBeenCalledTimes(
          1,
        );
      },
    );

    it(
      "does not query any Team's Notion source while another Team's Run is globally active",
      async () => {
        const [activeTask] =
          await db
            .insert(tasks)
            .values({
              teamId:
                DEVELOPMENT_TEAM_ID,
              projectPath:
                project.path,
              title:
                "Development active run",
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
              activeTask.id,
            teamId:
              DEVELOPMENT_TEAM_ID,
            projectPath:
              project.path,
            status:
              "running",
          });

        const resolution =
          createTeamAdapter({
            externalId:
              crypto.randomUUID(),
            priority:
              100,
            createdTime:
              "2099-01-01T00:00:00.000Z",
          });

        const development =
          createTeamAdapter(
            null,
          );

        const startExistingTask =
          vi.fn();

        await runTeamScopeCycle(
          {
            resolution:
              resolution.adapter,
            development:
              development.adapter,
          },
          startExistingTask,
        );

        expect(
          resolution.getNextReadyTask,
        ).not.toHaveBeenCalled();

        expect(
          development.getNextReadyTask,
        ).not.toHaveBeenCalled();

        expect(
          startExistingTask,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "does not query any Team's Notion source while Resolution's Run is globally active",
      async () => {
        const [activeTask] =
          await db
            .insert(tasks)
            .values({
              teamId:
                RESOLUTION_TEAM_ID,
              projectPath:
                project.path,
              title:
                "Resolution active run",
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
              activeTask.id,
            teamId:
              RESOLUTION_TEAM_ID,
            projectPath:
              project.path,
            status:
              "running",
          });

        const resolution =
          createTeamAdapter(
            null,
          );

        const development =
          createTeamAdapter({
            externalId:
              crypto.randomUUID(),
            priority:
              100,
            createdTime:
              "2099-01-01T00:00:00.000Z",
          });

        const startExistingTask =
          vi.fn();

        await runTeamScopeCycle(
          {
            resolution:
              resolution.adapter,
            development:
              development.adapter,
          },
          startExistingTask,
        );

        expect(
          resolution.getNextReadyTask,
        ).not.toHaveBeenCalled();

        expect(
          development.getNextReadyTask,
        ).not.toHaveBeenCalled();

        expect(
          startExistingTask,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "preserves a recoverable pending Task's original Team even while another Team is also eligible",
      async () => {
        const recoverableExternalId =
          crypto.randomUUID();

        await db
          .insert(tasks)
          .values({
            teamId:
              DEVELOPMENT_TEAM_ID,
            projectPath:
              project.path,
            title:
              "Recoverable Development task",
            instruction:
              "Resume this persisted claim under Development.",
            status:
              "pending",
            source:
              "notion",
            externalId:
              recoverableExternalId,
            externalUrl:
              `https://www.notion.so/${recoverableExternalId}`,
            priority:
              100,
          });

        const resolution =
          createTeamAdapter({
            externalId:
              crypto.randomUUID(),
            priority:
              999,
            createdTime:
              "2099-01-01T00:00:00.000Z",
          });

        const development =
          createTeamAdapter(
            null,
          );

        const startExistingTask =
          vi.fn()
            .mockResolvedValue(
              {},
            );

        await runTeamScopeCycle(
          {
            resolution:
              resolution.adapter,
            development:
              development.adapter,
          },
          startExistingTask,
        );

        expect(
          resolution.getNextReadyTask,
        ).not.toHaveBeenCalled();

        expect(
          development.getNextReadyTask,
        ).not.toHaveBeenCalled();

        expect(
          development.updateStatus,
        ).toHaveBeenCalledWith(
          recoverableExternalId,
          "In Progress",
        );

        const [recovered] =
          await db
            .select()
            .from(tasks)
            .where(
              eq(
                tasks.externalId,
                recoverableExternalId,
              ),
            );

        expect(
          recovered.teamId,
        ).toBe(
          DEVELOPMENT_TEAM_ID,
        );

        expect(
          startExistingTask,
        ).toHaveBeenCalledWith(
          recovered.id,
        );
      },
    );
  },
);
