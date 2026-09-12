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
      instructions:
        [] as
          string[],
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

const {
  db,
} =
  await import(
    "../db/client.js"
  );

const {
  RESOLUTION_TEAM_ID,
} =
  await import(
    "../db/seed-ids.js"
  );

const {
  agents,
  departments,
  domainEvents,
  runs,
  tasks,
  teamMembers,
} =
  await import(
    "../db/schema.js"
  );

const {
  createTask,
  startTask,
} =
  await import(
    "./workflow-service.js"
  );

const project = {
  id:
    "phase8-workflow-project",
  name:
    "orc",
  path:
    `/tmp/orc-phase8-workflow-${crypto.randomUUID()}`,
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

let agentId:
  string | null =
    null;

let departmentId:
  string | null =
    null;

let taskId:
  string | null =
    null;

let runId:
  string | null =
    null;

let originalAgentStates:
  Array<{
    id:
      string;
    enabled:
      boolean;
  }> = [];

/**
 * Creates the generic completed structured result returned by the fake runtime.
 */
function completedResult():
  AgentResult {
  return {
    status:
      "completed",
    summary:
      "Completed the generic knowledge-assisted workflow.",
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
 * Waits for the workflow Run to reach a terminal state after the fake worker finalizes.
 */
async function waitForTerminalRun(
  id:
    string,
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
            id,
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
      (
        resolve,
      ) => {
        setTimeout(
          resolve,
          10,
        );
      },
    );
  }

  throw new Error(
    `Timed out waiting for Run ${id}`,
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

    mocks.instructions.length =
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

    const [department] =
      await db
        .insert(departments)
        .values({
          slug:
            `phase8-context-synthesizer-department-${crypto.randomUUID()}`,
          name:
            "Context Synthesizer Department",
          role:
            "Custom Engineering Role",
          harness:
            "codex",
          defaultModel:
            "default",
          defaultReasoning:
            "medium",
          systemPrompt:
            "Complete the supplied task generically.",
          canWrite:
            false,
          canRunCommands:
            true,
          canCommit:
            false,
        })
        .returning();

    departmentId =
      department.id;

    const [agent] =
      await db
        .insert(agents)
        .values({
          departmentId:
            department.id,
          slug:
            `phase8-context-synthesizer-${crypto.randomUUID()}`,
          name:
            "Context Synthesizer",
          enabled:
            true,
        })
        .returning();

    agentId =
      agent.id;

    await db
      .insert(teamMembers)
      .values({
        teamId:
          RESOLUTION_TEAM_ID,
        departmentId:
          agent.departmentId,
        agentId:
          agent.id,
        layer:
          1_500_000 +
          Math.floor(
            Math.random() *
              100_000,
          ),
        executionOrder:
          1,
      });

    mocks.startSnapshotAgentExecution
      .mockImplementation(
        async (
          _run:
            unknown,
          snapshotAgent: {
            id:
              string;
          },
          instruction:
            string,
          onFinalized?:
            (
              finalization: {
                executionId:
                  string;
                status:
                  "completed";
                resultStatus:
                  "completed";
                failureReason:
                  null;
                result:
                  AgentResult;
              },
            ) =>
              | Promise<void>
              | void,
        ) => {
          mocks.instructions.push(
            instruction,
          );

          queueMicrotask(
            () => {
              void Promise.resolve(
                onFinalized?.({
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
                }),
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
    if (
      runId
    ) {
      await db
        .delete(
          domainEvents,
        )
        .where(
          eq(
            domainEvents.runId,
            runId,
          ),
        );

      await db
        .delete(runs)
        .where(
          eq(
            runs.id,
            runId,
          ),
        );
    }

    if (
      taskId
    ) {
      await db
        .delete(tasks)
        .where(
          eq(
            tasks.id,
            taskId,
          ),
        );
    }

    if (
      agentId
    ) {
      await db
        .delete(teamMembers)
        .where(
          eq(
            teamMembers.agentId,
            agentId,
          ),
        );

      await db
        .delete(agents)
        .where(
          eq(
            agents.id,
            agentId,
          ),
        );
    }

    if (
      departmentId
    ) {
      await db
        .delete(departments)
        .where(
          eq(
            departments.id,
            departmentId,
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

    agentId =
      null;

    taskId =
      null;

    runId =
      null;

    originalAgentStates =
      [];
  },
);

describe(
  "generic workflow knowledge context",
  () => {
    it(
      "persists bounded context in the immutable Run snapshot and injects it into a renamed first worker",
      async () => {
        const task =
          await createTask({
            projectId:
              project.id,
            teamId:
              RESOLUTION_TEAM_ID,
            title:
              "Knowledge-assisted task",
            instruction:
              "Inspect the selected repository.",
          });

        taskId =
          task.id;

        const knowledgeContext = [
          {
            source:
              "vault" as const,
            path:
              "Projects/orc/Decisions/Workflow.md",
            heading:
              "Snapshots",
            excerpt:
              "Persist execution-affecting state at Run creation.",
          },
        ];

        const started =
          await startTask(
            task.id,
            knowledgeContext,
          );

        if (
          !started
        ) {
          throw new Error(
            "Expected workflow to start",
          );
        }

        runId =
          started.run.id;

        const [persistedRun] =
          await db
            .select()
            .from(runs)
            .where(
              eq(
                runs.id,
                runId,
              ),
            );

        const snapshot =
          persistedRun.workflowSnapshot as {
            agents:
              Array<{
                id:
                  string;
                name:
                  string;
              }>;
            routes:
              unknown[];
            knowledgeContext:
              typeof knowledgeContext;
          };

        expect(
          snapshot
            .agents[0],
        ).toMatchObject({
          id:
            agentId,
          name:
            "Context Synthesizer",
        });

        expect(
          snapshot
            .knowledgeContext,
        ).toEqual(
          knowledgeContext,
        );

        await waitForTerminalRun(
          runId,
        );

        expect(
          mocks.instructions[0],
        ).toContain(
          "Durable vault knowledge:",
        );

        expect(
          mocks.instructions[0],
        ).toContain(
          "Persist execution-affecting state at Run creation.",
        );
      },
    );

    it(
      "completes normally when knowledge context is empty",
      async () => {
        const task =
          await createTask({
            projectId:
              project.id,
            teamId:
              RESOLUTION_TEAM_ID,
            title:
              "Knowledge-disabled task",
            instruction:
              "Run the unchanged generic workflow.",
          });

        taskId =
          task.id;

        const started =
          await startTask(
            task.id,
          );

        if (
          !started
        ) {
          throw new Error(
            "Expected workflow to start",
          );
        }

        runId =
          started.run.id;

        const terminal =
          await waitForTerminalRun(
            runId,
          );

        expect(
          terminal.status,
        ).toBe(
          "completed",
        );

        expect(
          mocks.instructions[0],
        ).not.toContain(
          "Durable vault knowledge:",
        );
      },
    );
  },
);
