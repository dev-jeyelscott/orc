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
  type AutoModeNotionAdapter,
} from "./auto-mode-service.js";
import {
  upsertProjectTeamAssignment,
} from "./project-team-assignment-service.js";

const created = {
  teamIds: new Set<string>(),
  departmentIds: new Set<string>(),
  agentIds: new Set<string>(),
};

let team:
  typeof teams.$inferSelect;

let projectPath: string;

let notionDataSourceId: string;

/**
 * Creates one fully-runnable Team (enabled Agent under an enabled Department)
 * and assigns it to a dedicated Project path with Auto Mode enabled.
 */
async function createRunnableProjectTeam(): Promise<
  void
> {
  const [createdTeam] =
    await db
      .insert(teams)
      .values({
        slug:
          `auto-mode-service-${crypto.randomUUID()}`,
        name:
          "Auto Mode Service Test Team",
        description:
          "",
        enabled:
          true,
      })
      .returning();

  team =
    createdTeam;

  created.teamIds.add(
    team.id,
  );

  const [department] =
    await db
      .insert(departments)
      .values({
        slug:
          `auto-mode-service-department-${crypto.randomUUID()}`,
        name:
          "Auto Mode Service Test Department",
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
          `auto-mode-service-agent-${crypto.randomUUID()}`,
        name:
          "Auto Mode Service Test Agent",
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

  projectPath =
    `/tmp/orc-auto-mode-${crypto.randomUUID()}`;

  notionDataSourceId =
    `auto-mode-service-source-${crypto.randomUUID()}`;

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
}

const createdExternalIds =
  new Set<string>();

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
    createdTime:
      new Date().toISOString(),
    project: {
      id:
        projectPath,
      name:
        "orc",
      path:
        projectPath,
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
 * Runs one claim cycle against the test Project's own Notion data source.
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
  await runAutoModeCycle(
    {
      createNotionAdapter:
        () =>
          adapter,
      startExistingTask,
    },
  );
}

beforeEach(
  async () => {
    createdExternalIds.clear();

    await createRunnableProjectTeam();
  },
);

afterEach(
  async () => {
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
  },
);

describe.sequential(
  "Auto Mode Notion claim flow",
  () => {
    it(
      "reconciles a local pending Notion task instead of duplicating it when the same page wins the cycle",
      async () => {
        const existingExternalId =
          crypto.randomUUID();

        await db
          .insert(tasks)
          .values({
            teamId:
              team.id,
            projectPath,
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

        const matchingCandidate = {
          ...createCandidate(),
          externalId:
            existingExternalId,
        };

        const mocks =
          createAdapter(
            matchingCandidate,
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
        ).toHaveBeenCalledTimes(
          1,
        );

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

        const matching =
          await db
            .select()
            .from(tasks)
            .where(
              eq(
                tasks.externalId,
                existingExternalId,
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
          2,
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
              teamId:
                team.id,
              projectPath,
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

        const matchingCandidate = {
          ...createCandidate(),
          externalId,
        };

        const mocks =
          createAdapter(
            matchingCandidate,
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
            teamId:
              team.id,
            projectPath,
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
      "does not remotely claim or start when the Project's Auto Mode is disabled",
      async () => {
        const candidate =
          createCandidate();

        const mocks =
          createAdapter(
            candidate,
          );

        await upsertProjectTeamAssignment(
          projectPath,
          {
            teamId:
              team.id,
            notionDataSourceId,
            autoModeEnabled:
              false,
          },
        );

        const startExistingTask =
          vi.fn();

        await runCycle(
          mocks.adapter,
          startExistingTask,
        );

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

    it(
      "throws a data-integrity error when a duplicate externalId already exists under a different Team",
      async () => {
        const candidate =
          createCandidate();

        const [otherTeam] =
          await db
            .insert(teams)
            .values({
              slug:
                `auto-mode-service-other-${crypto.randomUUID()}`,
              name:
                "Auto Mode Service Other Team",
              description:
                "",
              enabled:
                true,
            })
            .returning();

        created.teamIds.add(
          otherTeam.id,
        );

        // Not "pending" so it is excluded from recoverable-task recovery and the cycle instead
        // reaches remote candidate selection, where the conflicting externalId is discovered.
        await db
          .insert(tasks)
          .values({
            teamId:
              otherTeam.id,
            projectPath,
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

        await expect(
          runCycle(
            mocks.adapter,
            startExistingTask,
          ),
        ).rejects.toThrow(
          /already claimed by a different Project or Team/,
        );

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
