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
  AgentResultStatus,
  KnowledgeRef,
  UploadedProjectDocumentContext,
} from "@orc/shared";

type MockResultStatus =
  AgentResultStatus;

const runtimeState =
  vi.hoisted(
    () => ({
      instructions:
        [] as Array<{
          agentId: string;
          instruction: string;
        }>,
      resultResolver:
        (() =>
          "completed") as (
          agentId: string,
        ) => MockResultStatus,
      startSnapshotAgentExecution:
        vi.fn(),
      cancelLiveExecution:
        vi.fn(),
    }),
  );

vi.mock(
  "./agent-execution-service.js",
  () => ({
    startSnapshotAgentExecution:
      runtimeState
        .startSnapshotAgentExecution,
    cancelLiveExecution:
      runtimeState
        .cancelLiveExecution,
  }),
);

import {
  db,
} from "../db/client.js";

import {
  agentExecutions,
  agents,
  domainEvents,
  runs,
  tasks,
} from "../db/schema.js";

import {
  composeKnowledgeContext,
  composeTaskDocumentContext,
} from "../runtime/prompt.js";

import type {
  ExecutionFinalization,
  SnapshotAgent,
} from "./agent-execution-service.js";

import {
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
  2_000_000 +
  Math.floor(
    Math.random() *
      100_000_000,
  );

/**
 * Creates one valid generic structured result for the mocked worker runtime.
 */
function createResult(
  status:
    AgentResultStatus,
): AgentResult {
  return {
    status,
    summary:
      `Mock ${status} document-context result`,
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
 * Maps one structured result status to the execution lifecycle state expected by the workflow callback.
 */
function executionStatusForResult(
  status:
    AgentResultStatus,
): ExecutionFinalization["status"] {
  if (
    status ===
    "failed"
  ) {
    return "failed";
  }

  if (
    status ===
    "blocked"
  ) {
    return "blocked";
  }

  return "completed";
}

/**
 * Creates a valid immutable Project Document context fixture without creating mutable document rows.
 */
function createDocumentContext():
  UploadedProjectDocumentContext {
  return [
    {
      source:
        "project_document",
      documentId:
        "00000000-0000-4000-8000-000000000001",
      fileName:
        "worker-context-requirements.md",
      documentContentHash:
        "a".repeat(
          64,
        ),
      chunkSequence:
        2,
      chunkContentHash:
        "b".repeat(
          64,
        ),
      heading:
        "Immutable worker context",
      excerpt:
        "SNAPSHOTTED_PROJECT_DOCUMENT_SENTINEL must remain available to every worker execution in this Run.",
    },
  ];
}

/**
 * Creates the durable knowledge fixture used to prove its existing first-worker-only behavior remains unchanged.
 */
function createKnowledgeContext():
  KnowledgeRef[] {
  return [
    {
      source:
        "vault",
      path:
        "Projects/orc/Decisions/WorkerContext.md",
      heading:
        "Worker context",
      excerpt:
        "KNOWLEDGE_EXCERPT_SENTINEL is intentionally first-worker-only.",
    },
  ];
}

/**
 * Creates one database-backed generic worker with deterministic workflow ordering.
 */
async function createTestAgent(
  input: {
    label: string;
    relativeLayer: number;
    executionOrder?: number;
  },
) {
  const [agent] =
    await db
      .insert(
        agents,
      )
      .values({
        slug:
          `document-context-${input.label
            .toLowerCase()
            .replaceAll(
              /[^a-z0-9]+/g,
              "-",
            )
            .replace(
              /^-|-$/g,
              "",
            )}-${crypto.randomUUID()}`,
        name:
          input.label,
        role:
          `${input.label} Generic Role`,
        description:
          "Project Document worker-context regression agent",
        layer:
          layerBase +
          input.relativeLayer,
        executionOrder:
          input.executionOrder ??
          1,
        harness:
          "codex",
        model:
          "default",
        reasoning:
          "medium",
        systemPrompt:
          `Act as ${input.label}.`,
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
 * Converts one persisted test agent to the immutable workflow snapshot contract.
 */
function toSnapshotAgent(
  agent:
    typeof agents.$inferSelect,
): SnapshotAgent {
  return {
    id:
      agent.id,
    name:
      agent.name,
    role:
      agent.role,
    layer:
      agent.layer,
    executionOrder:
      agent.executionOrder,
    harness:
      agent.harness,
    model:
      agent.model,
    reasoning:
      agent.reasoning,
    systemPrompt:
      agent.systemPrompt,
    canWrite:
      agent.canWrite,
    canRunCommands:
      agent.canRunCommands,
    canCommit:
      agent.canCommit,
  };
}

/**
 * Creates a blocked Run whose immutable workflow snapshot is ready for the public manual retry path.
 */
async function createPreparedRun(
  input: {
    snapshotAgents:
      SnapshotAgent[];
    routes?:
      SnapshotRoute[];
    retryAgentId?:
      string;
    knowledgeContext?:
      KnowledgeRef[];
    taskDocumentContext?:
      UploadedProjectDocumentContext;
  },
) {
  const projectPath =
    `/tmp/orc-document-context-${crypto.randomUUID()}`;

  const [task] =
    await db
      .insert(
        tasks,
      )
      .values({
        projectPath,
        title:
          "Project Document worker-context propagation",
        instruction:
          "Complete the generic workflow using the supplied reference context.",
        status:
          "blocked",
      })
      .returning();

  createdTaskIds.add(
    task.id,
  );

  const [run] =
    await db
      .insert(
        runs,
      )
      .values({
        taskId:
          task.id,
        projectPath,
        status:
          "blocked",
        workflowSnapshot: {
          agents:
            input.snapshotAgents,
          routes:
            input.routes ??
            [],
          knowledgeContext:
            input.knowledgeContext ??
            [],
          taskDocumentContext:
            input.taskDocumentContext ??
            [],
        },
        executionCount:
          0,
        terminalReason:
          "Prepared for Project Document propagation regression test",
      })
      .returning();

  createdRunIds.add(
    run.id,
  );

  const retryAgentId =
    input.retryAgentId ??
    input.snapshotAgents[0]
      ?.id;

  const retryAgent =
    input.snapshotAgents.find(
      (agent) =>
        agent.id ===
        retryAgentId,
    );

  if (
    !retryAgent
  ) {
    throw new Error(
      "Prepared workflow requires a valid retry agent",
    );
  }

  await db
    .insert(
      agentExecutions,
    )
    .values({
      runId:
        run.id,
      agentId:
        retryAgent.id,
      agentName:
        retryAgent.name,
      agentRole:
        retryAgent.role,
      layer:
        retryAgent.layer,
      executionOrder:
        retryAgent.executionOrder,
      harness:
        retryAgent.harness,
      model:
        retryAgent.model,
      reasoning:
        retryAgent.reasoning,
      status:
        "blocked",
      failureReason:
        "Prepared manual retry execution",
      completedAt:
        new Date(),
    });

  return {
    task,
    run,
  };
}

/**
 * Waits until a prepared workflow finishes after the mocked worker callbacks advance it.
 */
async function waitForTerminalRun(
  runId:
    string,
) {
  for (
    let attempt = 0;
    attempt <
    500;
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
    `Timed out waiting for Run ${runId}`,
  );
}

/**
 * Uses the public manual retry behavior to enter the normal workflow execution path.
 */
async function executePreparedRun(
  runId:
    string,
) {
  const retried =
    await retryLastExecution(
      runId,
    );

  if (
    !retried
  ) {
    throw new Error(
      `Unable to retry prepared Run ${runId}`,
    );
  }

  return waitForTerminalRun(
    runId,
  );
}

beforeEach(
  () => {
    layerBase +=
      100;

    runtimeState
      .instructions
      .length =
      0;

    runtimeState
      .resultResolver =
      () =>
        "completed";

    runtimeState
      .startSnapshotAgentExecution
      .mockReset();

    runtimeState
      .cancelLiveExecution
      .mockReset();

    runtimeState
      .startSnapshotAgentExecution
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
          onFinalized?: (
            finalization:
              ExecutionFinalization,
          ) =>
            | Promise<void>
            | void,
        ) => {
          runtimeState
            .instructions
            .push({
              agentId:
                snapshotAgent.id,
              instruction,
            });

          const resultStatus =
            runtimeState
              .resultResolver(
                snapshotAgent.id,
              );

          const finalization:
            ExecutionFinalization = {
              executionId:
                crypto.randomUUID(),
              status:
                executionStatusForResult(
                  resultStatus,
                ),
              resultStatus,
              failureReason:
                null,
              result:
                createResult(
                  resultStatus,
                ),
            };

          queueMicrotask(
            () => {
              void Promise.resolve(
                onFinalized?.(
                  finalization,
                ),
              ).catch(
                () =>
                  undefined,
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
    for (
      const runId of
      createdRunIds
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
        .delete(
          agentExecutions,
        )
        .where(
          eq(
            agentExecutions.runId,
            runId,
          ),
        );

      await db
        .delete(
          runs,
        )
        .where(
          eq(
            runs.id,
            runId,
          ),
        );
    }

    for (
      const taskId of
      createdTaskIds
    ) {
      await db
        .delete(
          tasks,
        )
        .where(
          eq(
            tasks.id,
            taskId,
          ),
        );
    }

    for (
      const agentId of
      createdAgentIds
    ) {
      await db
        .delete(
          agents,
        )
        .where(
          eq(
            agents.id,
            agentId,
          ),
        );
    }

    createdRunIds.clear();
    createdTaskIds.clear();
    createdAgentIds.clear();
  },
);

describe(
  "Project Document worker-context propagation",
  () => {
    it(
      "supplies the same immutable Project Document context to first and normal downstream workers",
      async () => {
        const first =
          await createTestAgent({
            label:
              "Context Intake",
            relativeLayer:
              1,
          });

        const second =
          await createTestAgent({
            label:
              "Context Consumer",
            relativeLayer:
              2,
          });

        const taskDocumentContext =
          createDocumentContext();

        const expectedDocumentNote =
          composeTaskDocumentContext(
            taskDocumentContext,
          );

        expect(
          expectedDocumentNote,
        ).not.toBeNull();

        const {
          run,
        } =
          await createPreparedRun({
            snapshotAgents: [
              toSnapshotAgent(
                first,
              ),
              toSnapshotAgent(
                second,
              ),
            ],
            taskDocumentContext,
          });

        const finalRun =
          await executePreparedRun(
            run.id,
          );

        expect(
          finalRun.status,
        ).toBe(
          "completed",
        );

        expect(
          runtimeState.instructions.map(
            (entry) =>
              entry.agentId,
          ),
        ).toEqual([
          first.id,
          second.id,
        ]);

        for (
          const entry of
          runtimeState.instructions
        ) {
          expect(
            entry.instruction,
          ).toContain(
            expectedDocumentNote!,
          );

          expect(
            entry.instruction,
          ).toContain(
            "SNAPSHOTTED_PROJECT_DOCUMENT_SENTINEL",
          );
        }
      },
    );

    it(
      "retains the same snapshot context through configured routing loops",
      async () => {
        const first =
          await createTestAgent({
            label:
              "Requirements Worker",
            relativeLayer:
              1,
          });

        const implementer =
          await createTestAgent({
            label:
              "Implementation Worker",
            relativeLayer:
              2,
          });

        const reviewer =
          await createTestAgent({
            label:
              "Review Worker",
            relativeLayer:
              3,
          });

        const taskDocumentContext =
          createDocumentContext();

        const expectedDocumentNote =
          composeTaskDocumentContext(
            taskDocumentContext,
          );

        let reviewAttempts =
          0;

        runtimeState
          .resultResolver =
          (
            agentId,
          ) => {
            if (
              agentId ===
              reviewer.id
            ) {
              reviewAttempts +=
                1;

              return reviewAttempts ===
                1
                ? "changes_requested"
                : "approved";
            }

            return "completed";
          };

        const {
          run,
        } =
          await createPreparedRun({
            snapshotAgents: [
              toSnapshotAgent(
                first,
              ),
              toSnapshotAgent(
                implementer,
              ),
              toSnapshotAgent(
                reviewer,
              ),
            ],
            routes: [
              {
                sourceAgentId:
                  reviewer.id,
                outcome:
                  "changes_requested",
                targetAgentId:
                  implementer.id,
                terminalAction:
                  null,
              },
            ],
            taskDocumentContext,
          });

        const finalRun =
          await executePreparedRun(
            run.id,
          );

        expect(
          finalRun.status,
        ).toBe(
          "completed",
        );

        expect(
          runtimeState.instructions.map(
            (entry) =>
              entry.agentId,
          ),
        ).toEqual([
          first.id,
          implementer.id,
          reviewer.id,
          implementer.id,
          reviewer.id,
        ]);

        for (
          const entry of
          runtimeState.instructions
        ) {
          expect(
            entry.instruction,
          ).toContain(
            expectedDocumentNote!,
          );
        }
      },
    );

    it(
      "reuses snapshot context when manually retrying a non-first worker without mutable document lookup",
      async () => {
        const first =
          await createTestAgent({
            label:
              "Initial Worker",
            relativeLayer:
              1,
          });

        const downstream =
          await createTestAgent({
            label:
              "Retried Downstream Worker",
            relativeLayer:
              2,
          });

        const taskDocumentContext =
          createDocumentContext();

        const expectedDocumentNote =
          composeTaskDocumentContext(
            taskDocumentContext,
          );

        const {
          run,
        } =
          await createPreparedRun({
            snapshotAgents: [
              toSnapshotAgent(
                first,
              ),
              toSnapshotAgent(
                downstream,
              ),
            ],
            retryAgentId:
              downstream.id,
            taskDocumentContext,
          });

        const finalRun =
          await executePreparedRun(
            run.id,
          );

        expect(
          finalRun.status,
        ).toBe(
          "completed",
        );

        expect(
          runtimeState.instructions,
        ).toHaveLength(
          1,
        );

        expect(
          runtimeState.instructions[0],
        ).toMatchObject({
          agentId:
            downstream.id,
        });

        expect(
          runtimeState.instructions[0]
            ?.instruction,
        ).toContain(
          expectedDocumentNote!,
        );

        expect(
          runtimeState.instructions[0]
            ?.instruction,
        ).toContain(
          "SNAPSHOTTED_PROJECT_DOCUMENT_SENTINEL",
        );
      },
    );

    it(
      "leaves document-less Runs unchanged and preserves first-worker-only durable knowledge excerpts",
      async () => {
        const first =
          await createTestAgent({
            label:
              "Knowledge Intake",
            relativeLayer:
              1,
          });

        const downstream =
          await createTestAgent({
            label:
              "Knowledge Handoff Consumer",
            relativeLayer:
              2,
          });

        const knowledgeContext =
          createKnowledgeContext();

        const knowledgeNote =
          composeKnowledgeContext(
            knowledgeContext,
          );

        const {
          run,
        } =
          await createPreparedRun({
            snapshotAgents: [
              toSnapshotAgent(
                first,
              ),
              toSnapshotAgent(
                downstream,
              ),
            ],
            knowledgeContext,
          });

        const finalRun =
          await executePreparedRun(
            run.id,
          );

        expect(
          finalRun.status,
        ).toBe(
          "completed",
        );

        expect(
          runtimeState.instructions,
        ).toHaveLength(
          2,
        );

        expect(
          runtimeState.instructions[0]
            ?.instruction,
        ).toContain(
          knowledgeNote!,
        );

        expect(
          runtimeState.instructions[0]
            ?.instruction,
        ).toContain(
          "KNOWLEDGE_EXCERPT_SENTINEL",
        );

        expect(
          runtimeState.instructions[1]
            ?.instruction,
        ).not.toContain(
          "KNOWLEDGE_EXCERPT_SENTINEL",
        );

        expect(
          runtimeState.instructions[1]
            ?.instruction,
        ).toContain(
          "Projects/orc/Decisions/WorkerContext.md",
        );

        for (
          const entry of
          runtimeState.instructions
        ) {
          expect(
            entry.instruction,
          ).not.toContain(
            "Uploaded project document context:",
          );
        }
      },
    );
  },
);
