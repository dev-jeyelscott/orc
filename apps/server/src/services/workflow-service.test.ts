import { asc, eq } from "drizzle-orm";
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
  AgentResultStatus,
} from "@orc/shared";

type MockResultStatus =
  AgentResultStatus;

const runtimeState = vi.hoisted(
  () => ({
    startedAgentIds: [] as string[],
    resultResolver: ((
      _agentId: string,
    ) =>
      "completed") as (
      agentId: string,
    ) => MockResultStatus,
    startSnapshotAgentExecution:
      vi.fn(),
    cancelLiveExecution: vi.fn(),
  }),
);

vi.mock(
  "./agent-execution-service.js",
  () => ({
    startSnapshotAgentExecution:
      runtimeState.startSnapshotAgentExecution,
    cancelLiveExecution:
      runtimeState.cancelLiveExecution,
  }),
);

import { env } from "../config/env.js";
import { db } from "../db/client.js";
import {
  agentExecutions,
  agents,
  domainEvents,
  runs,
  tasks,
} from "../db/schema.js";
import type {
  ExecutionFinalization,
  SnapshotAgent,
} from "./agent-execution-service.js";
import {
  orderWorkflowAgents,
  retryLastExecution,
} from "./workflow-service.js";

type SnapshotRoute = {
  sourceAgentId: string;
  outcome: AgentResultStatus;
  targetAgentId: string | null;
  terminalAction:
    | "complete_run"
    | "fail_run"
    | "block_run"
    | null;
};

const createdAgentIds =
  new Set<string>();
const createdTaskIds =
  new Set<string>();
const createdRunIds =
  new Set<string>();

let layerBase =
  200_000 +
  Math.floor(
    Math.random() * 100_000_000,
  );

/**
 * Creates the normalized structured result returned by the mocked worker runtime.
 */
function createResult(
  status: AgentResultStatus,
): AgentResult {
  return {
    status,
    summary:
      `Mock ${status} result`,
    details: {},
    findings: [],
    filesChanged: [],
    commandsRun: [],
    validation: {},
    commit: null,
  };
}

/**
 * Maps a structured result onto the execution lifecycle state used by the runtime callback.
 */
function executionStatusForResult(
  status: AgentResultStatus,
): ExecutionFinalization["status"] {
  if (status === "failed") {
    return "failed";
  }

  if (status === "blocked") {
    return "blocked";
  }

  return "completed";
}

/**
 * Creates a database-backed test agent with a unique layer and slug.
 */
async function createTestAgent(
  input: {
    label: string;
    relativeLayer: number;
    executionOrder: number;
  },
) {
  const [agent] = await db
    .insert(agents)
    .values({
      slug:
        `workflow-${input.label
          .toLowerCase()
          .replaceAll(
            /[^a-z0-9]+/g,
            "-",
          )
          .replace(
            /^-|-$/g,
            "",
          )}-${crypto.randomUUID()}`,
      name: input.label,
      role:
        `${input.label} Role`,
      description:
        `${input.label} workflow test agent`,
      layer:
        layerBase +
        input.relativeLayer,
      executionOrder:
        input.executionOrder,
      harness: "codex",
      model: "default",
      reasoning: "high",
      systemPrompt:
        `Act as ${input.label}.`,
      enabled: true,
      canWrite: false,
      canRunCommands: true,
      canCommit: false,
    })
    .returning();

  createdAgentIds.add(agent.id);

  return agent;
}

/**
 * Converts an agent database row into the workflow-owned snapshot shape.
 */
function toSnapshotAgent(
  agent: typeof agents.$inferSelect,
): SnapshotAgent {
  return {
    id: agent.id,
    name: agent.name,
    role: agent.role,
    layer: agent.layer,
    executionOrder:
      agent.executionOrder,
    harness: agent.harness,
    model: agent.model,
    reasoning: agent.reasoning,
    systemPrompt:
      agent.systemPrompt,
    canWrite: agent.canWrite,
    canRunCommands:
      agent.canRunCommands,
    canCommit: agent.canCommit,
  };
}

/**
 * Creates a blocked workflow that can be restarted through the public retry path.
 */
async function createRetryableRun(
  snapshotAgents: SnapshotAgent[],
  routes: SnapshotRoute[],
) {
  const projectPath =
    `/tmp/orc-workflow-${crypto.randomUUID()}`;

  const [task] = await db
    .insert(tasks)
    .values({
      projectPath,
      title:
        "Workflow service test",
      instruction:
        "Return the configured test result.",
      status: "blocked",
    })
    .returning();

  createdTaskIds.add(task.id);

  const [run] = await db
    .insert(runs)
    .values({
      taskId: task.id,
      projectPath,
      status: "blocked",
      workflowSnapshot: {
        agents: snapshotAgents,
        routes,
      },
      executionCount: 0,
      terminalReason:
        "Prepared for workflow test",
    })
    .returning();

  createdRunIds.add(run.id);

  const firstAgent =
    snapshotAgents[0];

  if (!firstAgent) {
    throw new Error(
      "Workflow test requires at least one agent",
    );
  }

  await db
    .insert(agentExecutions)
    .values({
      runId: run.id,
      agentId: firstAgent.id,
      agentName: firstAgent.name,
      agentRole: firstAgent.role,
      layer: firstAgent.layer,
      executionOrder:
        firstAgent.executionOrder,
      harness: firstAgent.harness,
      model: firstAgent.model,
      reasoning:
        firstAgent.reasoning,
      status: "blocked",
      failureReason:
        "Prepared retry execution",
      completedAt: new Date(),
    });

  return {
    task,
    run,
  };
}

/**
 * Waits until the requested run reaches a terminal workflow state.
 */
async function waitForTerminalRun(
  runId: string,
) {
  for (
    let attempt = 0;
    attempt < 500;
    attempt += 1
  ) {
    const [run] = await db
      .select()
      .from(runs)
      .where(eq(runs.id, runId));

    if (
      run &&
      [
        "completed",
        "failed",
        "blocked",
        "cancelled",
      ].includes(run.status)
    ) {
      return run;
    }

    await new Promise<void>(
      (resolve) => {
        setTimeout(resolve, 10);
      },
    );
  }

  throw new Error(
    `Timed out waiting for run ${runId} to finish`,
  );
}

/**
 * Restarts a prepared workflow and waits for its final persisted state.
 */
async function executePreparedRun(
  runId: string,
) {
  const retried =
    await retryLastExecution(runId);

  if (!retried) {
    throw new Error(
      `Unable to retry test run ${runId}`,
    );
  }

  return waitForTerminalRun(runId);
}

/**
 * Loads transition events in execution-count order for deterministic assertions.
 */
async function listTransitionEvents(
  runId: string,
) {
  const rows = await db
    .select()
    .from(domainEvents)
    .where(
      eq(
        domainEvents.runId,
        runId,
      ),
    )
    .orderBy(
      asc(
        domainEvents.createdAt,
      ),
    );

  return rows
    .filter(
      (event) =>
        event.type ===
        "workflow.transition",
    )
    .sort((left, right) => {
      const leftData =
        left.data as Record<
          string,
          unknown
        >;
      const rightData =
        right.data as Record<
          string,
          unknown
        >;

      return (
        Number(
          leftData.executionCount,
        ) -
        Number(
          rightData.executionCount,
        )
      );
    });
}

/**
 * Returns one transition event payload as a typed assertion-friendly record.
 */
function transitionData(
  event: Awaited<
    ReturnType<
      typeof listTransitionEvents
    >
  >[number],
): Record<string, unknown> {
  return event.data as Record<
    string,
    unknown
  >;
}

describe(
  "workflow-service Phase 7",
  () => {
    beforeEach(() => {
      layerBase += 100;

      runtimeState.startedAgentIds.length =
        0;
      runtimeState.resultResolver =
        () => "completed";

      runtimeState
        .startSnapshotAgentExecution
        .mockReset();

      runtimeState.cancelLiveExecution
        .mockReset();

      runtimeState
        .startSnapshotAgentExecution
        .mockImplementation(
          async (
            _run: unknown,
            agent: {
              id: string;
            },
            _instruction: string,
            onFinalized?: (
              finalization:
                ExecutionFinalization,
            ) =>
              | Promise<void>
              | void,
          ) => {
            runtimeState.startedAgentIds.push(
              agent.id,
            );

            const resultStatus =
              runtimeState.resultResolver(
                agent.id,
              );

            const finalization: ExecutionFinalization =
              {
                executionId:
                  crypto.randomUUID(),
                status:
                  executionStatusForResult(
                    resultStatus,
                  ),
                resultStatus,
                failureReason: null,
                result:
                  createResult(
                    resultStatus,
                  ),
              };

            queueMicrotask(() => {
              void Promise.resolve(
                onFinalized?.(
                  finalization,
                ),
              ).catch(() => undefined);
            });

            return {} as never;
          },
        );
    });

    afterEach(async () => {
      for (const runId of createdRunIds) {
        await db
          .delete(domainEvents)
          .where(
            eq(
              domainEvents.runId,
              runId,
            ),
          );

        await db
          .delete(agentExecutions)
          .where(
            eq(
              agentExecutions.runId,
              runId,
            ),
          );

        await db
          .delete(runs)
          .where(eq(runs.id, runId));
      }

      for (
        const taskId of createdTaskIds
      ) {
        await db
          .delete(tasks)
          .where(
            eq(tasks.id, taskId),
          );
      }

      for (
        const agentId of createdAgentIds
      ) {
        await db
          .delete(agents)
          .where(
            eq(agents.id, agentId),
          );
      }

      createdRunIds.clear();
      createdTaskIds.clear();
      createdAgentIds.clear();
    });

    it(
      "executes renamed agents sequentially by layer and same-layer execution order",
      async () => {
        const planner =
          await createTestAgent({
            label: "Spec Mapper",
            relativeLayer: 1,
            executionOrder: 1,
          });

        const apiWorker =
          await createTestAgent({
            label: "API Crafter",
            relativeLayer: 3,
            executionOrder: 2,
          });

        const uiWorker =
          await createTestAgent({
            label: "UI Crafter",
            relativeLayer: 3,
            executionOrder: 1,
          });

        const reviewer =
          await createTestAgent({
            label: "Risk Auditor",
            relativeLayer: 7,
            executionOrder: 1,
          });

        const ordered =
          orderWorkflowAgents([
            toSnapshotAgent(
              reviewer,
            ),
            toSnapshotAgent(
              apiWorker,
            ),
            toSnapshotAgent(
              planner,
            ),
            toSnapshotAgent(
              uiWorker,
            ),
          ]);

        expect(
          ordered.map(
            (agent) => agent.id,
          ),
        ).toEqual([
          planner.id,
          uiWorker.id,
          apiWorker.id,
          reviewer.id,
        ]);

        const { run } =
          await createRetryableRun(
            ordered,
            [],
          );

        const finalRun =
          await executePreparedRun(
            run.id,
          );

        expect(finalRun.status).toBe(
          "completed",
        );

        expect(
          runtimeState.startedAgentIds,
        ).toEqual([
          planner.id,
          uiWorker.id,
          apiWorker.id,
          reviewer.id,
        ]);

        const transitions =
          await listTransitionEvents(
            run.id,
          );

        expect(transitions).toHaveLength(
          4,
        );

        expect(
          transitionData(
            transitions[0],
          ),
        ).toMatchObject({
          origin: "default",
          sourceAgentId:
            planner.id,
          outcome: "completed",
          targetAgentId:
            uiWorker.id,
          terminalAction: null,
          executionCount: 1,
        });

        expect(
          transitionData(
            transitions[1],
          ),
        ).toMatchObject({
          origin: "default",
          sourceAgentId:
            uiWorker.id,
          targetAgentId:
            apiWorker.id,
          executionCount: 2,
        });

        expect(
          transitionData(
            transitions[2],
          ),
        ).toMatchObject({
          origin: "default",
          sourceAgentId:
            apiWorker.id,
          targetAgentId:
            reviewer.id,
          executionCount: 3,
        });

        expect(
          transitionData(
            transitions[3],
          ),
        ).toMatchObject({
          origin: "default",
          sourceAgentId:
            reviewer.id,
          outcome: "completed",
          targetAgentId: null,
          terminalAction:
            "complete_run",
          executionCount: 4,
        });
      },
    );

    it(
      "routes changes_requested backward and resumes normal forward progression afterward",
      async () => {
        const planner =
          await createTestAgent({
            label:
              "Intent Mapper",
            relativeLayer: 1,
            executionOrder: 1,
          });

        const implementer =
          await createTestAgent({
            label:
              "Feature Maker",
            relativeLayer: 2,
            executionOrder: 1,
          });

        const reviewer =
          await createTestAgent({
            label:
              "Acceptance Inspector",
            relativeLayer: 3,
            executionOrder: 1,
          });

        const snapshotAgents =
          orderWorkflowAgents([
            toSnapshotAgent(
              reviewer,
            ),
            toSnapshotAgent(
              planner,
            ),
            toSnapshotAgent(
              implementer,
            ),
          ]);

        const routes: SnapshotRoute[] =
          [
            {
              sourceAgentId:
                reviewer.id,
              outcome:
                "changes_requested",
              targetAgentId:
                implementer.id,
              terminalAction: null,
            },
          ];

        let reviewAttempts = 0;

        runtimeState.resultResolver =
          (agentId) => {
            if (
              agentId ===
              reviewer.id
            ) {
              reviewAttempts += 1;

              return reviewAttempts ===
                1
                ? "changes_requested"
                : "approved";
            }

            return "completed";
          };

        const { run } =
          await createRetryableRun(
            snapshotAgents,
            routes,
          );

        const finalRun =
          await executePreparedRun(
            run.id,
          );

        expect(finalRun.status).toBe(
          "completed",
        );

        expect(
          runtimeState.startedAgentIds,
        ).toEqual([
          planner.id,
          implementer.id,
          reviewer.id,
          implementer.id,
          reviewer.id,
        ]);

        const transitions =
          await listTransitionEvents(
            run.id,
          );

        expect(
          transitionData(
            transitions[2],
          ),
        ).toMatchObject({
          origin: "explicit",
          sourceAgentId:
            reviewer.id,
          outcome:
            "changes_requested",
          targetAgentId:
            implementer.id,
          terminalAction: null,
          executionCount: 3,
        });

        expect(
          transitionData(
            transitions[3],
          ),
        ).toMatchObject({
          origin: "default",
          sourceAgentId:
            implementer.id,
          outcome: "completed",
          targetAgentId:
            reviewer.id,
          terminalAction: null,
          executionCount: 4,
        });
      },
    );

    it(
      "lets an explicit successful route override default forward progression",
      async () => {
        const first =
          await createTestAgent({
            label:
              "Discovery Worker",
            relativeLayer: 1,
            executionOrder: 1,
          });

        const skipped =
          await createTestAgent({
            label:
              "Middle Worker",
            relativeLayer: 2,
            executionOrder: 1,
          });

        const target =
          await createTestAgent({
            label:
              "Final Worker",
            relativeLayer: 3,
            executionOrder: 1,
          });

        const snapshotAgents =
          orderWorkflowAgents([
            toSnapshotAgent(
              skipped,
            ),
            toSnapshotAgent(
              target,
            ),
            toSnapshotAgent(
              first,
            ),
          ]);

        const routes: SnapshotRoute[] =
          [
            {
              sourceAgentId:
                first.id,
              outcome: "completed",
              targetAgentId:
                target.id,
              terminalAction: null,
            },
          ];

        const { run } =
          await createRetryableRun(
            snapshotAgents,
            routes,
          );

        const finalRun =
          await executePreparedRun(
            run.id,
          );

        expect(finalRun.status).toBe(
          "completed",
        );

        expect(
          runtimeState.startedAgentIds,
        ).toEqual([
          first.id,
          target.id,
        ]);

        expect(
          runtimeState.startedAgentIds,
        ).not.toContain(
          skipped.id,
        );

        const transitions =
          await listTransitionEvents(
            run.id,
          );

        expect(
          transitionData(
            transitions[0],
          ),
        ).toMatchObject({
          origin: "explicit",
          sourceAgentId:
            first.id,
          outcome: "completed",
          targetAgentId:
            target.id,
          terminalAction: null,
          executionCount: 1,
        });
      },
    );

    it.each([
      {
        outcome:
          "completed" as const,
        terminalAction:
          "complete_run" as const,
        expectedStatus:
          "completed" as const,
      },
      {
        outcome:
          "blocked" as const,
        terminalAction:
          "block_run" as const,
        expectedStatus:
          "blocked" as const,
      },
      {
        outcome:
          "failed" as const,
        terminalAction:
          "fail_run" as const,
        expectedStatus:
          "failed" as const,
      },
    ])(
      "terminates through explicit $terminalAction routes",
      async ({
        outcome,
        terminalAction,
        expectedStatus,
      }) => {
        const worker =
          await createTestAgent({
            label:
              `Terminal ${terminalAction}`,
            relativeLayer: 1,
            executionOrder: 1,
          });

        const snapshotAgents = [
          toSnapshotAgent(worker),
        ];

        const routes: SnapshotRoute[] =
          [
            {
              sourceAgentId:
                worker.id,
              outcome,
              targetAgentId: null,
              terminalAction,
            },
          ];

        runtimeState.resultResolver =
          () => outcome;

        const { run } =
          await createRetryableRun(
            snapshotAgents,
            routes,
          );

        const finalRun =
          await executePreparedRun(
            run.id,
          );

        expect(finalRun.status).toBe(
          expectedStatus,
        );

        const transitions =
          await listTransitionEvents(
            run.id,
          );

        expect(transitions).toHaveLength(
          1,
        );

        expect(
          transitionData(
            transitions[0],
          ),
        ).toMatchObject({
          origin: "explicit",
          sourceAgentId:
            worker.id,
          outcome,
          targetAgentId: null,
          terminalAction,
          executionCount: 1,
        });
      },
    );

    it(
      "stops a cyclic route at the configured persisted execution limit",
      async () => {
        const first =
          await createTestAgent({
            label:
              "Cycle Worker One",
            relativeLayer: 1,
            executionOrder: 1,
          });

        const second =
          await createTestAgent({
            label:
              "Cycle Worker Two",
            relativeLayer: 2,
            executionOrder: 1,
          });

        const snapshotAgents =
          orderWorkflowAgents([
            toSnapshotAgent(
              second,
            ),
            toSnapshotAgent(
              first,
            ),
          ]);

        const routes: SnapshotRoute[] =
          [
            {
              sourceAgentId:
                first.id,
              outcome: "completed",
              targetAgentId:
                second.id,
              terminalAction: null,
            },
            {
              sourceAgentId:
                second.id,
              outcome: "completed",
              targetAgentId:
                first.id,
              terminalAction: null,
            },
          ];

        const { run } =
          await createRetryableRun(
            snapshotAgents,
            routes,
          );

        const finalRun =
          await executePreparedRun(
            run.id,
          );

        expect(finalRun.status).toBe(
          "failed",
        );

        expect(
          finalRun.executionCount,
        ).toBe(
          env.MAX_WORKFLOW_EXECUTIONS,
        );

        expect(
          runtimeState.startedAgentIds,
        ).toHaveLength(
          env.MAX_WORKFLOW_EXECUTIONS,
        );

        const transitions =
          await listTransitionEvents(
            run.id,
          );

        const finalTransition =
          transitions.at(-1);

        expect(
          finalTransition,
        ).toBeDefined();

        expect(
          transitionData(
            finalTransition!,
          ),
        ).toMatchObject({
          origin: "limit",
          targetAgentId: null,
          terminalAction:
            "fail_run",
          executionCount:
            env.MAX_WORKFLOW_EXECUTIONS,
        });
      },
    );
  },
);
