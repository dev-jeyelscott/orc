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

vi.mock(
  "./project-discovery.js",
  () => ({
    getProjectByPath:
      vi.fn(
        async (
          _workspaceRoot: string,
          projectPath: string,
        ): Promise<Project> => ({
          id: projectPath,
          name: "orc",
          path: projectPath,
          branch: "main",
          gitState: "clean",
          primaryFiles: [
            "package.json",
          ],
          packageManager: "pnpm",
          stack: "node",
        }),
      ),
    getProject:
      vi.fn(),
  }),
);

import {
  db,
} from "../db/client.js";
import {
  agents,
  departments,
  projectTeamAssignments,
  runs,
  tasks,
  teamMembers,
  teams,
} from "../db/schema.js";
import {
  runAutoModeCycle,
  type AutoModeCycleDependencies,
  type AutoModeNotionAdapter,
} from "./auto-mode-service.js";
import {
  upsertProjectTeamAssignment,
} from "./project-team-assignment-service.js";

const created = {
  teamIds: new Set<string>(),
  departmentIds: new Set<string>(),
  agentIds: new Set<string>(),
  projectPaths: new Set<string>(),
};

/**
 * Creates one fully-runnable Team (enabled Agent under an enabled Department)
 * and assigns it to a dedicated Project path with Auto Mode enabled.
 */
async function createRunnableProjectTeam(
  label: string,
): Promise<{
  team:
    typeof teams.$inferSelect;
  projectPath:
    string;
  notionDataSourceId:
    string;
}> {
  const [team] =
    await db
      .insert(teams)
      .values({
        slug:
          `team-scope-${label}-${crypto.randomUUID()}`,
        name:
          `Team Scope ${label}`,
        description:
          "",
        enabled:
          true,
      })
      .returning();

  created.teamIds.add(
    team.id,
  );

  const [department] =
    await db
      .insert(departments)
      .values({
        slug:
          `team-scope-department-${label}-${crypto.randomUUID()}`,
        name:
          `Team Scope Department ${label}`,
        role:
          "Worker",
        harness:
          "codex",
        defaultModel:
          "default",
        defaultReasoning:
          "low",
        systemPrompt:
          "Perform the task.",
      })
      .returning();

  created.departmentIds.add(
    department.id,
  );

  const [agent] =
    await db
      .insert(agents)
      .values({
        departmentId:
          department.id,
        slug:
          `team-scope-agent-${label}-${crypto.randomUUID()}`,
        name:
          `Team Scope Agent ${label}`,
        enabled:
          true,
      })
      .returning();

  created.agentIds.add(
    agent.id,
  );

  await db
    .insert(teamMembers)
    .values({
      teamId:
        team.id,
      departmentId:
        department.id,
      agentId:
        agent.id,
      layer:
        1,
      executionOrder:
        1,
    });

  const projectPath =
    `/tmp/orc-auto-mode-team-scope-${label}-${crypto.randomUUID()}`;

  created.projectPaths.add(
    projectPath,
  );

  const notionDataSourceId =
    `team-scope-source-${label}-${crypto.randomUUID()}`;

  await upsertProjectTeamAssignment(
    projectPath,
    {
      teamId:
        team.id,
      notionDataSourceId,
      autoModeEnabled:
        true,
    },
  );

  return {
    team,
    projectPath,
    notionDataSourceId,
  };
}

/**
 * Removes local Auto Mode test rows after every Project/Team ownership assertion.
 */
async function cleanup(): Promise<void> {
  for (
    const projectPath of
    created.projectPaths
  ) {
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
      .delete(projectTeamAssignments)
      .where(
        eq(
          projectTeamAssignments.projectPath,
          projectPath,
        ),
      );
  }

  for (
    const agentId of
    created.agentIds
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

  for (
    const departmentId of
    created.departmentIds
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
    const teamId of
    created.teamIds
  ) {
    await db
      .delete(teams)
      .where(
        eq(
          teams.id,
          teamId,
        ),
      );
  }

  created.teamIds.clear();
  created.departmentIds.clear();
  created.agentIds.clear();
  created.projectPaths.clear();
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
        projectPath:
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
              project: {
                id:
                  candidate.projectPath,
                name:
                  "orc",
                path:
                  candidate.projectPath,
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
              },
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
 * Runs one multi-Project cycle, dispatching each Project's own Notion data source id to the matching mock adapter.
 */
async function runTeamScopeCycle(
  adapters: Record<
    string,
    AutoModeNotionAdapter
  >,
  startExistingTask:
    (
      id:
        string,
    ) => Promise<unknown>,
  overrides:
    AutoModeCycleDependencies = {},
) {
  await runAutoModeCycle({
    createNotionAdapter:
      (
        notionDataSourceId,
      ) => {
        const adapter =
          adapters[
            notionDataSourceId
          ];

        if (
          !adapter
        ) {
          throw new Error(
            `No adapter configured for Notion data source ${notionDataSourceId}`,
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
      "assigns newly persisted Notion Tasks to the Project's own Team when only that Project has Ready work",
      async () => {
        const a =
          await createRunnableProjectTeam(
            "a",
          );

        const b =
          await createRunnableProjectTeam(
            "b",
          );

        const externalId =
          crypto.randomUUID();

        const adapterA =
          createTeamAdapter({
            externalId,
            priority:
              100,
            createdTime:
              "2099-01-01T00:00:00.000Z",
            projectPath:
              a.projectPath,
          });

        const adapterB =
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
            [a.notionDataSourceId]:
              adapterA.adapter,
            [b.notionDataSourceId]:
              adapterB.adapter,
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
                externalId,
              ),
            );

        expect(
          persisted.teamId,
        ).toBe(
          a.team.id,
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
          adapterB.updateStatus,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "selects the globally lowest-numbered priority candidate across Projects",
      async () => {
        const a =
          await createRunnableProjectTeam(
            "priority-a",
          );

        const b =
          await createRunnableProjectTeam(
            "priority-b",
          );

        const externalIdA =
          crypto.randomUUID();

        const externalIdB =
          crypto.randomUUID();

        const adapterA =
          createTeamAdapter({
            externalId:
              externalIdA,
            priority:
              7,
            createdTime:
              "2099-01-01T00:00:00.000Z",
            projectPath:
              a.projectPath,
          });

        const adapterB =
          createTeamAdapter({
            externalId:
              externalIdB,
            priority:
              1,
            createdTime:
              "2099-01-02T00:00:00.000Z",
            projectPath:
              b.projectPath,
          });

        const startExistingTask =
          vi.fn()
            .mockResolvedValue(
              {},
            );

        await runTeamScopeCycle(
          {
            [a.notionDataSourceId]:
              adapterA.adapter,
            [b.notionDataSourceId]:
              adapterB.adapter,
          },
          startExistingTask,
        );

        expect(
          adapterB.updateStatus,
        ).toHaveBeenCalledWith(
          externalIdB,
          "In Progress",
        );

        expect(
          adapterA.updateStatus,
        ).not.toHaveBeenCalled();

        const [loser] =
          await db
            .select()
            .from(tasks)
            .where(
              eq(
                tasks.externalId,
                externalIdA,
              ),
            );

        expect(
          loser,
        ).toBeUndefined();
      },
    );

    it(
      "selects the older Notion page when priority ties across Projects",
      async () => {
        const a =
          await createRunnableProjectTeam(
            "tie-time-a",
          );

        const b =
          await createRunnableProjectTeam(
            "tie-time-b",
          );

        const externalIdA =
          crypto.randomUUID();

        const externalIdB =
          crypto.randomUUID();

        const adapterA =
          createTeamAdapter({
            externalId:
              externalIdA,
            priority:
              100,
            createdTime:
              "2099-01-01T00:00:00.000Z",
            projectPath:
              a.projectPath,
          });

        const adapterB =
          createTeamAdapter({
            externalId:
              externalIdB,
            priority:
              100,
            createdTime:
              "2099-01-02T00:00:00.000Z",
            projectPath:
              b.projectPath,
          });

        const startExistingTask =
          vi.fn()
            .mockResolvedValue(
              {},
            );

        await runTeamScopeCycle(
          {
            [a.notionDataSourceId]:
              adapterA.adapter,
            [b.notionDataSourceId]:
              adapterB.adapter,
          },
          startExistingTask,
        );

        expect(
          adapterA.updateStatus,
        ).toHaveBeenCalledWith(
          externalIdA,
          "In Progress",
        );

        expect(
          adapterB.updateStatus,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "breaks an exact priority and creation-time tie deterministically by Team id then external id",
      async () => {
        const a =
          await createRunnableProjectTeam(
            "tie-break-a",
          );

        const b =
          await createRunnableProjectTeam(
            "tie-break-b",
          );

        const [winner, loser] =
          a.team.id <
          b.team.id
            ? [a, b]
            : [b, a];

        const createdTime =
          "2099-01-01T00:00:00.000Z";

        const winnerAdapter =
          createTeamAdapter({
            externalId:
              "zzzz-tie-external-id",
            priority:
              100,
            createdTime,
            projectPath:
              winner.projectPath,
          });

        const loserAdapter =
          createTeamAdapter({
            externalId:
              "aaaa-tie-external-id",
            priority:
              100,
            createdTime,
            projectPath:
              loser.projectPath,
          });

        const startExistingTask =
          vi.fn()
            .mockResolvedValue(
              {},
            );

        await runTeamScopeCycle(
          {
            [winner.notionDataSourceId]:
              winnerAdapter.adapter,
            [loser.notionDataSourceId]:
              loserAdapter.adapter,
          },
          startExistingTask,
        );

        // The lexically smaller Team id wins the stable tie break regardless
        // of external id ordering.
        expect(
          winnerAdapter.updateStatus,
        ).toHaveBeenCalledWith(
          "zzzz-tie-external-id",
          "In Progress",
        );

        expect(
          loserAdapter.updateStatus,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "leaves the losing Project's candidate Ready and unpersisted",
      async () => {
        const a =
          await createRunnableProjectTeam(
            "losing-a",
          );

        const b =
          await createRunnableProjectTeam(
            "losing-b",
          );

        const externalIdA =
          crypto.randomUUID();

        const externalIdB =
          crypto.randomUUID();

        const adapterA =
          createTeamAdapter({
            externalId:
              externalIdA,
            priority:
              7,
            createdTime:
              "2099-01-01T00:00:00.000Z",
            projectPath:
              a.projectPath,
          });

        const adapterB =
          createTeamAdapter({
            externalId:
              externalIdB,
            priority:
              1,
            createdTime:
              "2099-01-01T00:00:00.000Z",
            projectPath:
              b.projectPath,
          });

        const startExistingTask =
          vi.fn()
            .mockResolvedValue(
              {},
            );

        await runTeamScopeCycle(
          {
            [a.notionDataSourceId]:
              adapterA.adapter,
            [b.notionDataSourceId]:
              adapterB.adapter,
          },
          startExistingTask,
        );

        expect(
          adapterA.updateStatus,
        ).not.toHaveBeenCalled();

        const [loserTask] =
          await db
            .select()
            .from(tasks)
            .where(
              eq(
                tasks.externalId,
                externalIdA,
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
        const a =
          await createRunnableProjectTeam(
            "single-a",
          );

        const b =
          await createRunnableProjectTeam(
            "single-b",
          );

        const adapterA =
          createTeamAdapter({
            externalId:
              crypto.randomUUID(),
            priority:
              50,
            createdTime:
              "2099-01-01T00:00:00.000Z",
            projectPath:
              a.projectPath,
          });

        const adapterB =
          createTeamAdapter({
            externalId:
              crypto.randomUUID(),
            priority:
              200,
            createdTime:
              "2099-01-01T00:00:00.000Z",
            projectPath:
              b.projectPath,
          });

        const startExistingTask =
          vi.fn()
            .mockResolvedValue(
              {},
            );

        await runTeamScopeCycle(
          {
            [a.notionDataSourceId]:
              adapterA.adapter,
            [b.notionDataSourceId]:
              adapterB.adapter,
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
      "does not query any Project's Notion source while another Project's Run is globally active",
      async () => {
        const a =
          await createRunnableProjectTeam(
            "active-a",
          );

        const b =
          await createRunnableProjectTeam(
            "active-b",
          );

        const [activeTask] =
          await db
            .insert(tasks)
            .values({
              teamId:
                b.team.id,
              projectPath:
                b.projectPath,
              title:
                "Active run",
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
              b.team.id,
            projectPath:
              b.projectPath,
            status:
              "running",
          });

        const adapterA =
          createTeamAdapter({
            externalId:
              crypto.randomUUID(),
            priority:
              100,
            createdTime:
              "2099-01-01T00:00:00.000Z",
            projectPath:
              a.projectPath,
          });

        const adapterB =
          createTeamAdapter(
            null,
          );

        const startExistingTask =
          vi.fn();

        await runTeamScopeCycle(
          {
            [a.notionDataSourceId]:
              adapterA.adapter,
            [b.notionDataSourceId]:
              adapterB.adapter,
          },
          startExistingTask,
        );

        expect(
          adapterA.getNextReadyTask,
        ).not.toHaveBeenCalled();

        expect(
          adapterB.getNextReadyTask,
        ).not.toHaveBeenCalled();

        expect(
          startExistingTask,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "preserves a recoverable pending Task's original Team even while another Project is also eligible",
      async () => {
        const a =
          await createRunnableProjectTeam(
            "recoverable-a",
          );

        const b =
          await createRunnableProjectTeam(
            "recoverable-b",
          );

        const recoverableExternalId =
          crypto.randomUUID();

        await db
          .insert(tasks)
          .values({
            teamId:
              b.team.id,
            projectPath:
              b.projectPath,
            title:
              "Recoverable task",
            instruction:
              "Resume this persisted claim.",
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

        const adapterA =
          createTeamAdapter({
            externalId:
              crypto.randomUUID(),
            priority:
              999,
            createdTime:
              "2099-01-01T00:00:00.000Z",
            projectPath:
              a.projectPath,
          });

        const adapterB =
          createTeamAdapter({
            externalId:
              recoverableExternalId,
            priority:
              100,
            createdTime:
              "2099-01-01T00:00:00.000Z",
            projectPath:
              b.projectPath,
          });

        const startExistingTask =
          vi.fn()
            .mockResolvedValue(
              {},
            );

        await runTeamScopeCycle(
          {
            [a.notionDataSourceId]:
              adapterA.adapter,
            [b.notionDataSourceId]:
              adapterB.adapter,
          },
          startExistingTask,
        );

        expect(
          adapterB.updateStatus,
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
          b.team.id,
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
