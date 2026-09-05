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
  DEVELOPMENT_TEAM_ID,
  RESOLUTION_TEAM_ID,
} from "../db/seed-ids.js";
import {
  agents,
  domainEvents,
  runs,
  tasks,
  teams,
} from "../db/schema.js";
import type {
  ExecutionFinalization,
} from "./agent-execution-service.js";
import {
  createAndStartTask,
  createTask,
  startTask,
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

const createdAgentIds =
  new Set<string>();

let originalAgentStates:
  Array<{
    id:
      string;
    enabled:
      boolean;
  }> = [];

let originalTeamStates:
  Array<{
    id:
      string;
    enabled:
      boolean;
  }> = [];

let resolutionAgentId:
  string | null =
    null;

/**
 * Builds a successful structured worker result for Team-scoped workflow regression tests.
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
 * Creates one enabled generic worker for a specific Team.
 */
async function createTestAgent(
  teamId:
    string,
  label:
    string,
) {
  const [agent] =
    await db
      .insert(agents)
      .values({
        teamId,
        slug:
          `workflow-start-${label}-${crypto.randomUUID()}`,
        name:
          `${label} Worker`,
        role:
          "Generic Engineering Role",
        description:
          "Workflow Team scope regression agent",
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

  createdAgentIds.add(
    agent.id,
  );

  return agent;
}

/**
 * Waits until one persisted Run reaches a terminal state.
 */
async function waitForTerminalRun(
  runId:
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

    originalTeamStates =
      await db
        .select({
          id:
            teams.id,
          enabled:
            teams.enabled,
        })
        .from(teams);

    await db
      .update(agents)
      .set({
        enabled:
          false,
      });

    await db
      .update(teams)
      .set({
        enabled:
          true,
      });

    const agent =
      await createTestAgent(
        RESOLUTION_TEAM_ID,
        "resolution",
      );

    resolutionAgentId =
      agent.id;

    mocks.startSnapshotAgentExecution
      .mockImplementation(
        async (
          _run:
            unknown,
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

          const finalization:
            ExecutionFinalization =
              {
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

    for (
      const id of
      createdAgentIds
    ) {
      await db
        .delete(agents)
        .where(
          eq(
            agents.id,
            id,
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

    for (
      const state of
      originalTeamStates
    ) {
      await db
        .update(teams)
        .set({
          enabled:
            state.enabled,
        })
        .where(
          eq(
            teams.id,
            state.id,
          ),
        );
    }

    createdAgentIds.clear();

    resolutionAgentId =
      null;

    originalAgentStates =
      [];

    originalTeamStates =
      [];
  },
);

describe(
  "Team-scoped workflow start",
  () => {
    it(
      "persists Task and Run Team and snapshots only enabled agents from that Team",
      async () => {
        const developmentAgent =
          await createTestAgent(
            DEVELOPMENT_TEAM_ID,
            "development",
          );

        const result =
          await createAndStartTask({
            projectId:
              project.id,
            teamId:
              RESOLUTION_TEAM_ID,
            title:
              "Manual workflow task",
            instruction:
              "Complete the generic workflow.",
          });

        expect(
          result.task.teamId,
        ).toBe(
          RESOLUTION_TEAM_ID,
        );

        expect(
          result.run.teamId,
        ).toBe(
          RESOLUTION_TEAM_ID,
        );

        const [persistedRun] =
          await db
            .select()
            .from(runs)
            .where(
              eq(
                runs.id,
                result.run.id,
              ),
            );

        const snapshot =
          persistedRun.workflowSnapshot as {
            agents:
              Array<{
                id:
                  string;
              }>;
          };

        expect(
          snapshot.agents.map(
            (agent) =>
              agent.id,
          ),
        ).toContain(
          resolutionAgentId,
        );

        expect(
          snapshot.agents.map(
            (agent) =>
              agent.id,
          ),
        ).not.toContain(
          developmentAgent.id,
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
      },
    );

    it(
      "uses the persisted Task Team when startTask builds its immutable snapshot",
      async () => {
        const developmentAgent =
          await createTestAgent(
            DEVELOPMENT_TEAM_ID,
            "development-start-existing",
          );

        const pending =
          await createTask({
            projectId:
              project.id,
            teamId:
              RESOLUTION_TEAM_ID,
            title:
              "Pending Team Task",
            instruction:
              "Start this persisted Task.",
          });

        const started =
          await startTask(
            pending.id,
          );

        expect(
          started?.task.teamId,
        ).toBe(
          RESOLUTION_TEAM_ID,
        );

        expect(
          started?.run.teamId,
        ).toBe(
          RESOLUTION_TEAM_ID,
        );

        const [persistedRun] =
          await db
            .select()
            .from(runs)
            .where(
              eq(
                runs.id,
                started!.run.id,
              ),
            );

        const snapshot =
          persistedRun.workflowSnapshot as {
            agents:
              Array<{
                id:
                  string;
              }>;
          };

        expect(
          snapshot.agents.map(
            (agent) =>
              agent.id,
          ),
        ).not.toContain(
          developmentAgent.id,
        );
      },
    );

    it(
      "rejects a disabled Team",
      async () => {
        await db
          .update(teams)
          .set({
            enabled:
              false,
          })
          .where(
            eq(
              teams.id,
              DEVELOPMENT_TEAM_ID,
            ),
          );

        await expect(
          createAndStartTask({
            projectId:
              project.id,
            teamId:
              DEVELOPMENT_TEAM_ID,
            title:
              "Disabled Team task",
            instruction:
              "This must not start.",
          }),
        ).rejects.toMatchObject({
          statusCode:
            409,
          message:
            "The selected team is disabled",
        });
      },
    );

    it(
      "rejects an enabled Team with no enabled agents",
      async () => {
        await expect(
          createAndStartTask({
            projectId:
              project.id,
            teamId:
              DEVELOPMENT_TEAM_ID,
            title:
              "Empty Team task",
            instruction:
              "This must not start.",
          }),
        ).rejects.toMatchObject({
          statusCode:
            409,
          message:
            "The selected team has no enabled agents",
        });
      },
    );

    it(
      "preserves the one-active-run-global invariant across different Teams",
      async () => {
        mocks.startSnapshotAgentExecution
          .mockImplementation(
            async (
              _run:
                unknown,
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

        await createTestAgent(
          DEVELOPMENT_TEAM_ID,
          "development-active-conflict",
        );

        await createAndStartTask({
          projectId:
            project.id,
          teamId:
            RESOLUTION_TEAM_ID,
          title:
            "Active Resolution task",
          instruction:
            "Remain active for the global conflict assertion.",
        });

        await expect(
          createAndStartTask({
            projectId:
              project.id,
            teamId:
              DEVELOPMENT_TEAM_ID,
            title:
              "Conflicting Development task",
            instruction:
              "This Task must not be persisted.",
          }),
        ).rejects.toMatchObject({
          statusCode:
            409,
          message:
            "Another task is already active",
        });

        const conflictingTasks =
          await db
            .select()
            .from(tasks)
            .where(
              eq(
                tasks.title,
                "Conflicting Development task",
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
