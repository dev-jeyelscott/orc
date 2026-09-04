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
  AgentResultStatus,
  Run,
} from "@orc/shared";

import {
  db,
} from "../db/client.js";
import {
  agentExecutions,
  runs,
  tasks,
} from "../db/schema.js";
import {
  getLatestNotionLifecycleTarget,
  resolveNotionLifecycleStatus,
  runNotionAutoModeCycle,
} from "./notion-auto-mode-cycle.js";

const projectPath =
  `/tmp/orc-notion-lifecycle-${crypto.randomUUID()}`;

const createdRunIds =
  new Set<string>();

/**
 * Inserts one Notion-sourced task and its latest run for lifecycle reconciliation tests.
 */
async function createNotionRun(
  runStatus:
    Run["status"],
  resultStatus:
    AgentResultStatus | null = null,
) {
  const externalId =
    crypto.randomUUID();

  const lifecycleTime =
    new Date(
      "2099-01-01T00:00:00.000Z",
    );

  const [task] =
    await db
      .insert(tasks)
      .values({
        projectPath,
        title:
          `Lifecycle ${externalId}`,
        instruction:
          "Validate Notion lifecycle synchronization.",
        status:
          runStatus,
        source:
          "notion",
        externalId,
        externalUrl:
          `https://www.notion.so/${externalId}`,
        priority:
          100,
        createdAt:
          lifecycleTime,
        updatedAt:
          lifecycleTime,
      })
      .returning();

  const [run] =
    await db
      .insert(runs)
      .values({
        taskId:
          task.id,
        projectPath,
        status:
          runStatus,
        createdAt:
          lifecycleTime,
        updatedAt:
          lifecycleTime,
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
          lifecycleTime,
        createdAt:
          lifecycleTime,
        updatedAt:
          lifecycleTime,
      });
  }

  return {
    task,
    run,
    externalId,
  };
}

/**
 * Removes lifecycle test data without touching unrelated development records.
 */
async function cleanupLifecycleData(): Promise<void> {
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
  async () => {
    await cleanupLifecycleData();
  },
);

describe.sequential(
  "Notion lifecycle projection",
  () => {
    it.each([
      [
        "pending",
        null,
        "In Progress",
      ],
      [
        "running",
        "changes_requested",
        "In Progress",
      ],
      [
        "completed",
        "approved",
        "Done",
      ],
      [
        "completed",
        "completed",
        "In Progress",
      ],
      [
        "blocked",
        "blocked",
        "Blocked",
      ],
      [
        "failed",
        "failed",
        "Failed",
      ],
      [
        "cancelled",
        null,
        null,
      ],
    ] as const)(
      "maps run %s with result %s to %s",
      (
        runStatus,
        resultStatus,
        expected,
      ) => {
        expect(
          resolveNotionLifecycleStatus(
            runStatus,
            resultStatus,
          ),
        ).toBe(
          expected,
        );
      },
    );

    it(
      "writes Done only when the latest persisted execution is approved",
      async () => {
        const {
          run,
          externalId,
        } =
          await createNotionRun(
            "completed",
          );

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
            resultStatus:
              "approved",
            completedAt:
              new Date(
                "2099-01-01T00:00:01.000Z",
              ),
            createdAt:
              new Date(
                "2099-01-01T00:00:01.000Z",
              ),
            updatedAt:
              new Date(
                "2099-01-01T00:00:01.000Z",
              ),
          });

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
            resultStatus:
              "changes_requested",
            completedAt:
              new Date(
                "2099-01-01T00:00:02.000Z",
              ),
            createdAt:
              new Date(
                "2099-01-01T00:00:02.000Z",
              ),
            updatedAt:
              new Date(
                "2099-01-01T00:00:02.000Z",
              ),
          });

        expect(
          await getLatestNotionLifecycleTarget(),
        ).toEqual({
          pageId:
            externalId,
          status:
            "In Progress",
        });
      },
    );

    it(
      "derives Done from a locally completed run whose latest execution is approved",
      async () => {
        const {
          externalId,
        } =
          await createNotionRun(
            "completed",
            "approved",
          );

        expect(
          await getLatestNotionLifecycleTarget(),
        ).toEqual({
          pageId:
            externalId,
          status:
            "Done",
        });
      },
    );

    it(
      "returns no external status mapping for a cancelled latest run",
      async () => {
        const {
          externalId,
        } =
          await createNotionRun(
            "cancelled",
          );

        expect(
          await getLatestNotionLifecycleTarget(),
        ).toEqual({
          pageId:
            externalId,
          status:
            null,
        });
      },
    );
  },
);

describe(
  "Notion synchronized Auto Mode cycle",
  () => {
    /**
     * Returns enabled Auto Mode settings for cycle-order tests.
     */
    async function enabledSettings() {
      return {
        autoModeEnabled:
          true,
      };
    }

    it(
      "completes the authoritative Notion write before running intake",
      async () => {
        const updateStatus =
          vi.fn()
            .mockResolvedValue(
              undefined,
            );

        const runIntakeCycle =
          vi.fn()
            .mockResolvedValue(
              undefined,
            );

        await runNotionAutoModeCycle({
          getLifecycleTarget:
            async () => ({
              pageId:
                "page-1",
              status:
                "Done",
            }),
          getSettings:
            enabledSettings,
          createNotionAdapter:
            () => ({
              getNextReadyTask:
                vi.fn(),
              updateStatus,
            }),
          runIntakeCycle,
        });

        expect(
          updateStatus,
        ).toHaveBeenCalledWith(
          "page-1",
          "Done",
        );

        expect(
          runIntakeCycle,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          updateStatus.mock
            .invocationCallOrder[0],
        ).toBeLessThan(
          runIntakeCycle.mock
            .invocationCallOrder[0],
        );
      },
    );

    it(
      "prevents a new claim when terminal writeback fails and retries it on the next cycle",
      async () => {
        const updateStatus =
          vi.fn()
            .mockRejectedValueOnce(
              new Error(
                "Notion unavailable",
              ),
            )
            .mockResolvedValueOnce(
              undefined,
            );

        const runIntakeCycle =
          vi.fn()
            .mockResolvedValue(
              undefined,
            );

        const dependencies = {
          getLifecycleTarget:
            async () => ({
              pageId:
                "page-1",
              status:
                "Done" as const,
            }),
          getSettings:
            enabledSettings,
          createNotionAdapter:
            () => ({
              getNextReadyTask:
                vi.fn(),
              updateStatus,
            }),
          runIntakeCycle,
        };

        await expect(
          runNotionAutoModeCycle(
            dependencies,
          ),
        ).rejects.toThrow(
          "Notion unavailable",
        );

        expect(
          runIntakeCycle,
        ).not.toHaveBeenCalled();

        await runNotionAutoModeCycle(
          dependencies,
        );

        expect(
          updateStatus,
        ).toHaveBeenCalledTimes(
          2,
        );

        expect(
          runIntakeCycle,
        ).toHaveBeenCalledTimes(
          1,
        );
      },
    );

    it(
      "reapplies the same status idempotently on repeated reconciliation cycles",
      async () => {
        const updateStatus =
          vi.fn()
            .mockResolvedValue(
              undefined,
            );

        const runIntakeCycle =
          vi.fn()
            .mockResolvedValue(
              undefined,
            );

        const dependencies = {
          getLifecycleTarget:
            async () => ({
              pageId:
                "page-1",
              status:
                "Blocked" as const,
            }),
          getSettings:
            enabledSettings,
          createNotionAdapter:
            () => ({
              getNextReadyTask:
                vi.fn(),
              updateStatus,
            }),
          runIntakeCycle,
        };

        await runNotionAutoModeCycle(
          dependencies,
        );

        await runNotionAutoModeCycle(
          dependencies,
        );

        expect(
          updateStatus,
        ).toHaveBeenNthCalledWith(
          1,
          "page-1",
          "Blocked",
        );

        expect(
          updateStatus,
        ).toHaveBeenNthCalledWith(
          2,
          "page-1",
          "Blocked",
        );
      },
    );

    it(
      "still reconciles terminal Notion state when Auto Mode has been switched off",
      async () => {
        const updateStatus =
          vi.fn()
            .mockResolvedValue(
              undefined,
            );

        const runIntakeCycle =
          vi.fn();

        await runNotionAutoModeCycle({
          getLifecycleTarget:
            async () => ({
              pageId:
                "page-1",
              status:
                "Done",
            }),
          getSettings:
            async () => ({
              autoModeEnabled:
                false,
            }),
          createNotionAdapter:
            () => ({
              getNextReadyTask:
                vi.fn(),
              updateStatus,
            }),
          runIntakeCycle,
        });

        expect(
          updateStatus,
        ).toHaveBeenCalledWith(
          "page-1",
          "Done",
        );

        expect(
          runIntakeCycle,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "does not create a Notion adapter for a cancelled lifecycle projection when Auto Mode is off",
      async () => {
        const createNotionAdapter =
          vi.fn();

        const runIntakeCycle =
          vi.fn();

        await runNotionAutoModeCycle({
          getLifecycleTarget:
            async () => ({
              pageId:
                "page-1",
              status:
                null,
            }),
          getSettings:
            async () => ({
              autoModeEnabled:
                false,
            }),
          createNotionAdapter,
          runIntakeCycle,
        });

        expect(
          createNotionAdapter,
        ).not.toHaveBeenCalled();

        expect(
          runIntakeCycle,
        ).not.toHaveBeenCalled();
      },
    );
  },
);
