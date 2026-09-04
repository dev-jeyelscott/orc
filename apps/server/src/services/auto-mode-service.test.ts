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

import type {
  Project,
} from "@orc/shared";

import {
  db,
} from "../db/client.js";
import {
  runs,
  tasks,
} from "../db/schema.js";
import {
  runAutoModeCycle,
  type AutoModeEligibility,
  type AutoModeNotionAdapter,
} from "./auto-mode-service.js";

const project: Project = {
  id:
    "auto-mode-test-project",
  name:
    "orc",
  path:
    `/tmp/orc-auto-mode-${crypto.randomUUID()}`,
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

const createdExternalIds =
  new Set<string>();

/**
 * Returns the always-enabled persisted settings dependency used by claim-flow tests.
 */
async function enabledSettings() {
  return {
    autoModeEnabled:
      true,
  };
}

/**
 * Returns the always-enabled recheck dependency used by claim-flow tests.
 */
async function enabledState(): Promise<boolean> {
  return true;
}

/**
 * Returns an eligible gate so claim-flow tests can isolate crash and idempotency semantics.
 */
async function eligibleState(): Promise<AutoModeEligibility> {
  return {
    eligible:
      true,
    state:
      "ready",
    nextEligibleAt:
      null,
  };
}

/**
 * Creates one unique Notion candidate mapped to the test project.
 */
function createCandidate() {
  const externalId =
    crypto.randomUUID();

  createdExternalIds.add(
    externalId,
  );

  return {
    source:
      "notion" as const,
    externalId,
    externalUrl:
      `https://www.notion.so/${externalId}`,
    title:
      `Auto Mode test ${externalId}`,
    instruction:
      "# Test\n\nRun the task.",
    priority:
      100,
    project,
  };
}

/**
 * Creates a mock Notion adapter with direct Vitest handles.
 */
function createAdapter(
  candidate:
    ReturnType<
      typeof createCandidate
    > | null,
) {
  const getNextReadyTask =
    vi.fn()
      .mockResolvedValue(
        candidate,
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
 * Loads the local task row for one Notion external page id.
 */
async function getLocalTask(
  externalId:
    string,
) {
  const [task] =
    await db
      .select()
      .from(tasks)
      .where(
        eq(
          tasks.externalId,
          externalId,
        ),
      );

  return (
    task ??
    null
  );
}

/**
 * Runs one claim cycle with test-only deterministic eligibility and Auto Mode settings.
 */
async function runCycle(
  adapter:
    AutoModeNotionAdapter,
  startExistingTask:
    (
      id:
        string,
    ) => Promise<unknown>,
) {
  await runAutoModeCycle({
    getSettings:
      enabledSettings,
    evaluateEligibility:
      eligibleState,
    isEnabled:
      enabledState,
    createNotionAdapter:
      () =>
        adapter,
    startExistingTask,
  });
}

beforeEach(
  () => {
    createdExternalIds.clear();
  },
);

afterEach(
  async () => {
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
  },
);

describe.sequential(
  "Auto Mode Notion claim flow",
  () => {
    it(
      "recovers a local pending Notion task with no run before querying another Ready page",
      async () => {
        const existingExternalId =
          crypto.randomUUID();

        await db
          .insert(tasks)
          .values({
            projectPath:
              project.path,
            title:
              "Recover persisted task",
            instruction:
              "Resume this persisted claim.",
            status:
              "pending",
            source:
              "notion",
            externalId:
              existingExternalId,
            externalUrl:
              `https://www.notion.so/${existingExternalId}`,
            priority:
              100,
          });

        const nextCandidate =
          createCandidate();

        const mocks =
          createAdapter(
            nextCandidate,
          );

        const startExistingTask =
          vi.fn()
            .mockResolvedValue(
              {},
            );

        await runCycle(
          mocks.adapter,
          startExistingTask,
        );

        expect(
          mocks.getNextReadyTask,
        ).not.toHaveBeenCalled();

        expect(
          mocks.updateStatus,
        ).toHaveBeenCalledWith(
          existingExternalId,
          "In Progress",
        );

        expect(
          startExistingTask,
        ).toHaveBeenCalledTimes(
          1,
        );
      },
    );

    it(
      "persists the local task before updating Notion to In Progress",
      async () => {
        const candidate =
          createCandidate();

        const mocks =
          createAdapter(
            candidate,
          );

        mocks.updateStatus
          .mockImplementation(
            async (
              pageId:
                string,
            ) => {
              const localTask =
                await getLocalTask(
                  pageId,
                );

              expect(
                localTask,
              ).toMatchObject({
                source:
                  "notion",
                externalId:
                  pageId,
                status:
                  "pending",
              });
            },
          );

        const startExistingTask =
          vi.fn()
            .mockResolvedValue(
              {},
            );

        await runCycle(
          mocks.adapter,
          startExistingTask,
        );

        expect(
          mocks.updateStatus,
        ).toHaveBeenCalledWith(
          candidate.externalId,
          "In Progress",
        );

        expect(
          startExistingTask,
        ).toHaveBeenCalledTimes(
          1,
        );
      },
    );

    it(
      "leaves the local task pending and unstarted when the remote claim update fails",
      async () => {
        const candidate =
          createCandidate();

        const mocks =
          createAdapter(
            candidate,
          );

        mocks.updateStatus
          .mockRejectedValue(
            new Error(
              "Notion unavailable",
            ),
          );

        const startExistingTask =
          vi.fn();

        await expect(
          runCycle(
            mocks.adapter,
            startExistingTask,
          ),
        ).rejects.toThrow(
          "Notion unavailable",
        );

        const localTask =
          await getLocalTask(
            candidate.externalId,
          );

        expect(
          localTask,
        ).toMatchObject({
          status:
            "pending",
          source:
            "notion",
        });

        expect(
          startExistingTask,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "resumes the same persisted task after a crash between Notion claim and local run start",
      async () => {
        const candidate =
          createCandidate();

        const mocks =
          createAdapter(
            candidate,
          );

        const firstStart =
          vi.fn()
            .mockRejectedValue(
              new Error(
                "simulated process failure before run start",
              ),
            );

        await expect(
          runCycle(
            mocks.adapter,
            firstStart,
          ),
        ).rejects.toThrow(
          "simulated process failure",
        );

        const persisted =
          await getLocalTask(
            candidate.externalId,
          );

        expect(
          persisted?.status,
        ).toBe(
          "pending",
        );

        const secondStart =
          vi.fn()
            .mockImplementation(
              async (
                id:
                  string,
              ) => {
                await db
                  .update(tasks)
                  .set({
                    status:
                      "running",
                    updatedAt:
                      new Date(),
                  })
                  .where(
                    eq(
                      tasks.id,
                      id,
                    ),
                  );

                return {};
              },
            );

        await runCycle(
          mocks.adapter,
          secondStart,
        );

        expect(
          mocks.getNextReadyTask,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          mocks.updateStatus,
        ).toHaveBeenCalledTimes(
          2,
        );

        expect(
          secondStart,
        ).toHaveBeenCalledWith(
          persisted?.id,
        );
      },
    );

    it(
      "keeps the local task pending when start-existing-task loses the active-run race",
      async () => {
        const externalId =
          crypto.randomUUID();

        const [task] =
          await db
            .insert(tasks)
            .values({
              projectPath:
                project.path,
              title:
                "Active conflict recovery",
              instruction:
                "Remain pending.",
              status:
                "pending",
              source:
                "notion",
              externalId,
              externalUrl:
                `https://www.notion.so/${externalId}`,
              priority:
                100,
            })
            .returning();

        const mocks =
          createAdapter(
            null,
          );

        const conflict =
          Object.assign(
            new Error(
              "Another task is already active",
            ),
            {
              statusCode:
                409,
            },
          );

        const startExistingTask =
          vi.fn()
            .mockRejectedValue(
              conflict,
            );

        await expect(
          runCycle(
            mocks.adapter,
            startExistingTask,
          ),
        ).rejects.toMatchObject({
          statusCode:
            409,
        });

        const [persisted] =
          await db
            .select()
            .from(tasks)
            .where(
              eq(
                tasks.id,
                task.id,
              ),
            );

        expect(
          persisted.status,
        ).toBe(
          "pending",
        );
      },
    );

    it(
      "reconciles an existing completed page id instead of duplicating the task",
      async () => {
        const candidate =
          createCandidate();

        await db
          .insert(tasks)
          .values({
            projectPath:
              project.path,
            title:
              candidate.title,
            instruction:
              candidate.instruction,
            status:
              "completed",
            source:
              "notion",
            externalId:
              candidate.externalId,
            externalUrl:
              candidate.externalUrl,
            priority:
              candidate.priority,
          });

        const mocks =
          createAdapter(
            candidate,
          );

        const startExistingTask =
          vi.fn();

        await runCycle(
          mocks.adapter,
          startExistingTask,
        );

        expect(
          mocks.updateStatus,
        ).toHaveBeenCalledWith(
          candidate.externalId,
          "Done",
        );

        expect(
          startExistingTask,
        ).not.toHaveBeenCalled();

        const matching =
          await db
            .select()
            .from(tasks)
            .where(
              eq(
                tasks.externalId,
                candidate.externalId,
              ),
            );

        expect(
          matching,
        ).toHaveLength(
          1,
        );
      },
    );

    it(
      "does not remotely claim or start after Auto Mode is disabled during the cycle",
      async () => {
        const candidate =
          createCandidate();

        const mocks =
          createAdapter(
            candidate,
          );

        const isEnabled =
          vi.fn()
            .mockResolvedValueOnce(
              false,
            );

        const startExistingTask =
          vi.fn();

        await runAutoModeCycle({
          getSettings:
            enabledSettings,
          evaluateEligibility:
            eligibleState,
          isEnabled,
          createNotionAdapter:
            () =>
              mocks.adapter,
          startExistingTask,
        });

        expect(
          mocks.getNextReadyTask,
        ).not.toHaveBeenCalled();

        expect(
          mocks.updateStatus,
        ).not.toHaveBeenCalled();

        expect(
          startExistingTask,
        ).not.toHaveBeenCalled();
      },
    );
  },
);
