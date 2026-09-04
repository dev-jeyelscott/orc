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
  AgentResult,
} from "@orc/shared";

const mocks =
  vi.hoisted(
    () => ({
      getProject:
        vi.fn(),
      getProjectByPath:
        vi.fn(),
      startSnapshotAgentExecution:
        vi.fn(),
      cancelLiveExecution:
        vi.fn(),
      startedAgentIds:
        [] as string[],
    }),
  );

vi.mock(
  "./project-discovery.js",
  () => ({
    getProject:
      mocks.getProject,
    getProjectByPath:
      mocks.getProjectByPath,
  }),
);

vi.mock(
  "./agent-execution-service.js",
  () => ({
    startSnapshotAgentExecution:
      mocks.startSnapshotAgentExecution,
    cancelLiveExecution:
      mocks.cancelLiveExecution,
  }),
);

import {
  db,
} from "../db/client.js";
import {
  agents,
  domainEvents,
  runs,
  tasks,
} from "../db/schema.js";
import type {
  ExecutionFinalization,
} from "./agent-execution-service.js";
import {
  createAndStartTask,
} from "./workflow-service.js";

const project = {
  id:
    "workflow-test-project",
  name:
    "orc",
  path:
    `/tmp/orc-workflow-start-${crypto.randomUUID()}`,
  branch:
    "main",
  gitState:
    "clean" as const,
  primaryFiles: [
    "package.json",
  ],
  packageManager:
    "pnpm" as const,
  stack:
    "node",
};

let testAgentId:
  string | null =
  null;

let originalAgentStates: Array<{
  id:
    string;
  enabled:
    boolean;
}> = [];

/**
 * Builds a successful structured worker result for manual-start regression tests.
 */
function completedResult(): AgentResult {
  return {
    status:
      "completed",
    summary:
      "Completed test workflow.",
    details: {},
    findings: [],
    filesChanged: [],
    commandsRun: [],
    validation: {},
    commit:
      null,
  };
}

/**
 * Waits until one persisted run reaches a terminal state.
 */
async function waitForTerminalRun(
  runId: string,
) {
  for (
    let attempt = 0;
    attempt < 200;
    attempt += 1
  ) {
    const [run] =
      await db
        .select()
        .from(runs)
        .where(
          eq(
            runs.id,
            runId,
          ),
        );

    if (
      run &&
      [
        "completed",
        "failed",
        "blocked",
        "cancelled",
      ].includes(
        run.status,
      )
    ) {
      return run;
    }

    await new Promise<void>(
      (resolve) => {
        setTimeout(
          resolve,
          10,
        );
      },
    );
  }

  throw new Error(
    `Timed out waiting for run ${runId}`,
  );
}

beforeEach(
  async () => {
    mocks.getProject
      .mockReset();

    mocks.getProjectByPath
      .mockReset();

    mocks.startSnapshotAgentExecution
      .mockReset();

    mocks.cancelLiveExecution
      .mockReset();

    mocks.startedAgentIds.length =
      0;

    mocks.getProject
      .mockResolvedValue(
        project,
      );

    mocks.getProjectByPath
      .mockResolvedValue(
        project,
      );

    originalAgentStates =
      await db
        .select({
          id:
            agents.id,
          enabled:
            agents.enabled,
        })
        .from(agents);

    await db
      .update(agents)
      .set({
        enabled:
          false,
      });

    const [agent] =
      await db
        .insert(agents)
        .values({
          slug:
            `workflow-start-${crypto.randomUUID()}`,
          name:
            "Generic Worker",
          role:
            "Generic Engineering Role",
          description:
            "Workflow start regression agent",
          layer:
            1_000_000 +
            Math.floor(
              Math.random() *
              100_000_000,
            ),
          executionOrder:
            1,
          harness:
            "codex",
          model:
            "default",
          reasoning:
            "medium",
          systemPrompt:
            "Complete the supplied task.",
          enabled:
            true,
          canWrite:
            false,
          canRunCommands:
            true,
          canCommit:
            false,
        })
        .returning();

    testAgentId =
      agent.id;

    mocks.startSnapshotAgentExecution
      .mockImplementation(
        async (
          _run: unknown,
          snapshotAgent: {
            id:
              string;
          },
          _instruction:
            string,
          onFinalized?: (
            finalization:
              ExecutionFinalization,
          ) =>
            | Promise<void>
            | void,
        ) => {
          mocks.startedAgentIds.push(
            snapshotAgent.id,
          );

          const finalization: ExecutionFinalization = {
            executionId:
              crypto.randomUUID(),
            status:
              "completed",
            resultStatus:
              "completed",
            failureReason:
              null,
            result:
              completedResult(),
          };

          queueMicrotask(
            () => {
              void Promise.resolve(
                onFinalized?.(
                  finalization,
                ),
              );
            },
          );

          return {} as never;
        },
      );
  },
);

afterEach(
  async () => {
    await db
      .delete(
        domainEvents,
      )
      .where(
        eq(
          domainEvents.projectPath,
          project.path,
        ),
      );

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

    if (
      testAgentId
    ) {
      await db
        .delete(agents)
        .where(
          eq(
            agents.id,
            testAgentId,
          ),
        );
    }

    for (
      const state of
        originalAgentStates
    ) {
      await db
        .update(agents)
        .set({
          enabled:
            state.enabled,
        })
        .where(
          eq(
            agents.id,
            state.id,
          ),
        );
    }

    testAgentId =
      null;

    originalAgentStates =
      [];
  },
);

describe(
  "manual create-and-start workflow",
  () => {
    it(
      "keeps the manual create endpoint service contract as create and immediately start",
      async () => {
        const result =
          await createAndStartTask({
            projectId:
              project.id,
            title:
              "Manual workflow task",
            instruction:
              "Complete the generic workflow.",
          });

        expect(
          result.task.source,
        ).toBe(
          "manual",
        );

        expect(
          result.task.priority,
        ).toBe(
          0,
        );

        expect(
          result.task.externalId,
        ).toBeNull();

        expect(
          result.run.taskId,
        ).toBe(
          result.task.id,
        );

        const terminalRun =
          await waitForTerminalRun(
            result.run.id,
          );

        expect(
          terminalRun.status,
        ).toBe(
          "completed",
        );

        expect(
          mocks.startedAgentIds,
        ).toEqual([
          testAgentId,
        ]);

        const [task] =
          await db
            .select()
            .from(tasks)
            .where(
              eq(
                tasks.id,
                result.task.id,
              ),
            );

        expect(
          task.status,
        ).toBe(
          "completed",
        );
      },
    );

    it(
      "does not leave a second manual task when another run is already active",
      async () => {
        mocks.startSnapshotAgentExecution
          .mockImplementation(
            async (
              _run: unknown,
              snapshotAgent: {
                id:
                  string;
              },
            ) => {
              mocks.startedAgentIds.push(
                snapshotAgent.id,
              );

              return {} as never;
            },
          );

        await createAndStartTask({
          projectId:
            project.id,
          title:
            "Active manual task",
          instruction:
            "Remain active for the conflict assertion.",
        });

        await expect(
          createAndStartTask({
            projectId:
              project.id,
            title:
              "Conflicting manual task",
            instruction:
              "This task must not remain persisted.",
          }),
        ).rejects.toMatchObject({
          statusCode:
            409,
        });

        const conflictingTasks =
          await db
            .select()
            .from(tasks)
            .where(
              eq(
                tasks.title,
                "Conflicting manual task",
              ),
            );

        expect(
          conflictingTasks,
        ).toHaveLength(
          0,
        );
      },
    );
  },
);
