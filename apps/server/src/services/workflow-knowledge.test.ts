import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

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
  agents,
  domainEvents,
  knowledgeCategories,
  runs,
  tasks,
  teamMembers,
  teams,
  workflowEdges,
  workflowNodes,
  workflowRevisions,
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

const {
  backfillTeamWorkflow,
} =
  await import(
    "./workflow-backfill-service.js"
  );

const {
  replaceDepartmentKnowledge,
} =
  await import(
    "./department-knowledge-service.js"
  );

const {
  createDepartment,
  deleteDepartment,
} =
  await import(
    "./department-service.js"
  );

const {
  createAgent,
  deleteAgent,
} =
  await import(
    "./agent-service.js"
  );

const {
  replaceTeamMembers,
} =
  await import(
    "./team-membership.js"
  );

const {
  createTeam,
} =
  await import(
    "./team-service.js"
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

let teamId:
  string | null =
    null;

let configRoot:
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

    // Created through the file-authoritative services (not raw db.insert
    // fixtures, and not the real shared "beta"/RESOLUTION_TEAM_ID seed
    // Team) against a private per-test `.orc/` root, since
    // `backfillTeamWorkflow` -> `saveDraftGraph`/`publishDraft` now require
    // the owning Team to have a canonical `team.yaml` and every Agent node
    // to resolve to a canonical `.orc/agents/<slug>/agent.yaml` (roadmap
    // Spec 8). Using an isolated Team here, rather than the real seeded
    // one, avoids ever writing to (or having to revert) real shared
    // configuration.
    configRoot =
      await fs.mkdtemp(
        path.join(os.tmpdir(), "orc-workflow-knowledge-test-"),
      );

    const department =
      await createDepartment({
        slug:
          `phase8-context-synthesizer-department-${crypto.randomUUID()}`,
        name:
          "Context Synthesizer Department",
        role:
          "Custom Engineering Role",
        harness:
          "codex" as const,
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
      }, configRoot);

    departmentId =
      department.id;

    const agent =
      await createAgent({
        departmentId:
          department.id,
        slug:
          `phase8-context-synthesizer-${crypto.randomUUID()}`,
        name:
          "Context Synthesizer",
        enabled:
          true,
        additionalPrompt:
          "",
      }, configRoot);

    agentId =
      agent.id;

    const team =
      await createTeam({
        slug:
          `phase8-workflow-team-${crypto.randomUUID()}`,
        name:
          "Phase 8 Workflow Team",
        description:
          "",
        enabled:
          true,
      }, configRoot);

    teamId =
      team.id;

    await replaceTeamMembers(
      teamId,
      [
        agent.id,
      ],
      null,
      configRoot,
    );

    await backfillTeamWorkflow(
      teamId,
      configRoot,
    );

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
      teamId
    ) {
      const revisionRows =
        await db
          .select({
            id: workflowRevisions.id,
          })
          .from(workflowRevisions)
          .where(
            eq(
              workflowRevisions.teamId,
              teamId,
            ),
          );

      for (const revision of revisionRows) {
        await db.delete(workflowEdges).where(eq(workflowEdges.revisionId, revision.id));
        await db.delete(workflowNodes).where(eq(workflowNodes.revisionId, revision.id));
      }

      await db
        .delete(workflowRevisions)
        .where(
          eq(
            workflowRevisions.teamId,
            teamId,
          ),
        );

      await db
        .delete(teamMembers)
        .where(
          eq(
            teamMembers.teamId,
            teamId,
          ),
        );

      await db
        .delete(teams)
        .where(
          eq(
            teams.id,
            teamId,
          ),
        );
    }

    if (
      agentId
    ) {
      await deleteAgent(
        agentId,
        null,
        configRoot ?? undefined,
      );
    }

    if (
      departmentId
    ) {
      await deleteDepartment(
        departmentId,
        null,
        configRoot ?? undefined,
      );
    }

    if (
      configRoot
    ) {
      await fs.rm(
        configRoot,
        { recursive: true, force: true },
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

    departmentId =
      null;

    teamId =
      null;

    configRoot =
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
              teamId as string,
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
              teamId as string,
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

    it(
      "does not inject a Department's primary Knowledge Category into the Run automatically",
      async () => {
        const [category] =
          await db
            .insert(knowledgeCategories)
            .values({
              slug:
                `phase8-department-primary-${crypto.randomUUID()}`,
              name:
                "Department Primary Category",
              vaultRootPath:
                "wiki/department-primary",
            })
            .returning();

        await replaceDepartmentKnowledge(
          departmentId as string,
          [category.id],
        );

        const task =
          await createTask({
            projectId:
              project.id,
            teamId:
              teamId as string,
            title:
              "Department-associated task",
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
            knowledgeContext:
              unknown[];
          };

        // A Department declaring primary knowledge is a discovery hint only; it must
        // never be auto-injected into a Run's knowledge context by itself.
        expect(
          snapshot
            .knowledgeContext,
        ).toEqual(
          [],
        );

        await waitForTerminalRun(
          runId,
        );

        expect(
          mocks.instructions[0],
        ).not.toContain(
          "Durable vault knowledge:",
        );

        await replaceDepartmentKnowledge(
          departmentId as string,
          [],
        );

        await db
          .delete(knowledgeCategories)
          .where(
            eq(
              knowledgeCategories.id,
              category.id,
            ),
          );
      },
    );
  },
);
