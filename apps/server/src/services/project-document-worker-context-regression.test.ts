import { and, eq } from "drizzle-orm";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MAX_PROJECT_DOCUMENT_CONTEXT_CHARS,
  MAX_PROJECT_DOCUMENT_CONTEXT_ITEMS,
  MAX_PROJECT_DOCUMENT_EXCERPT_CHARS,
  uploadedProjectDocumentContextCollectionSchema,
  type AgentResult,
  type AgentResultStatus,
  type OrchestratorTurn,
  type Project,
} from "@orc/shared";

import type { RuntimeEvent } from "../runtime/index.js";

import type { ExecutionFinalization } from "./agent-execution-service.js";

type WorkerLaunch = {
  agentId: string;
  instruction: string;
  finalize: (status?: AgentResultStatus) => Promise<void>;
};

const testState = vi.hoisted(() => ({
  project: null as Project | null,
  supervisorTurns: [] as Array<OrchestratorTurn | Error>,
  workerLaunches: [] as WorkerLaunch[],
  startSnapshotAgentExecution: vi.fn(),
  cancelLiveExecution: vi.fn(),
}));

vi.mock("./project-discovery.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./project-discovery.js")>();

  return {
    ...actual,

    /**
     * Returns the configured test Project for its stable discovery identifier.
     */
    getProject: vi.fn(async (_root: string, projectId: string) =>
      testState.project?.id === projectId ? testState.project : null,
    ),

    /**
     * Returns the configured test Project for its canonical filesystem path.
     */
    getProjectByPath: vi.fn(async (_root: string, projectPath: string) =>
      testState.project?.path === projectPath ? testState.project : null,
    ),
  };
});

vi.mock("../runtime/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../runtime/index.js")>();

  return {
    ...actual,

    /**
     * Returns the minimal adapter needed to decode fake supervisor output.
     */
    getHarnessAdapter: () => ({
      extractMessageText: (event: Record<string, unknown>) =>
        typeof event.text === "string" ? event.text : undefined,
    }),

    /**
     * Emits one queued supervisor turn without launching provider traffic.
     */
    startHarnessSession: () => {
      const next = testState.supervisorTurns.shift();

      return {
        metadata: {
          id: crypto.randomUUID(),
          pid: null,
          state: next instanceof Error ? "failed" : "exited",
          exitCode: next instanceof Error ? null : 0,
          signal: null,
          usage: null,
        },

        /**
         * Emits one synthetic supervisor provider response followed by process exit.
         */
        subscribe(listener: (event: RuntimeEvent) => void) {
          if (next instanceof Error) {
            listener({
              type: "diagnostic",
              sequence: 1,
              diagnostic: {
                code: "launch_failed",
                message: next.message,
              },
            });

            return () => undefined;
          }

          if (!next) {
            throw new Error("No queued supervisor turn");
          }

          listener({
            type: "provider",
            sequence: 1,
            provider: "test",
            event: {
              text: `<orc-supervisor>${JSON.stringify(next)}</orc-supervisor>`,
            },
          });

          listener({
            type: "exit",
            sequence: 2,
            exitCode: 0,
          });

          return () => undefined;
        },

        /**
         * Rejects interactive instructions because this fake supervisor is non-interactive.
         */
        sendInstruction() {
          return false;
        },

        /**
         * Rejects resize requests because this fake supervisor has no PTY.
         */
        resize() {
          return false;
        },

        /**
         * Stops the fake supervisor session without side effects.
         */
        stop() {},
      };
    },
  };
});

// Preserve the real read-side execution API used by Run monitoring while replacing only process-launch boundaries.
vi.mock("./agent-execution-service.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./agent-execution-service.js")>();

  return {
    ...actual,
    startSnapshotAgentExecution: testState.startSnapshotAgentExecution,
    cancelLiveExecution: testState.cancelLiveExecution,
  };
});

const { db } = await import("../db/client.js");

const { RESOLUTION_TEAM_ID } = await import("../db/seed-ids.js");

const {
  agents,
  conversationMessageDocuments,
  conversationMessages,
  conversations,
  departments,
  domainEvents,
  projectDocumentChunks,
  projectDocuments,
  runs,
  taskDocuments,
  tasks,
  teamMemberRoutes,
  teamMembers,
  teams,
} = await import("../db/schema.js");

const { createConversation, postConversationMessage } =
  await import("./conversation-service.js");

const { createProjectDocument } = await import("./project-document-service.js");

const { getRunMonitoringDetail } = await import("./run-monitoring-service.js");

const createdAgentIds = new Set<string>();
const createdDepartmentIds = new Set<string>();

let originalAgentStates: Array<{
  id: string;
  enabled: boolean;
}> = [];

let originalResolutionTeamEnabled = true;

let layerBase = 3_000_000 + Math.floor(Math.random() * 100_000_000);

/**
 * Creates the filesystem-backed Project fixture shared by the real services.
 */
function makeProject(): Project {
  return {
    id: "project-document-worker-context-test",
    name: "orc-project-document-worker-context-test",
    path: `/tmp/orc-project-document-worker-context-${crypto.randomUUID()}`,
    branch: "main",
    gitState: "clean",
    primaryFiles: ["package.json"],
    packageManager: "pnpm",
    stack: "node",
  };
}

/**
 * Builds one valid normalized structured worker result for a chosen workflow outcome.
 */
function createResult(status: AgentResultStatus): AgentResult {
  return {
    status,
    summary: `Mock ${status} Project Document worker-context result.`,
    details: {},
    findings: [],
    filesChanged: [],
    commandsRun: [],
    validation: {},
    commit: null,
  };
}

/**
 * Maps a structured result outcome to the persisted execution lifecycle state.
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
 * Creates one enabled generic Resolution Team worker with deterministic ordering.
 */
async function createTestAgent(input: {
  label: string;
  relativeLayer: number;
}) {
  const [department] = await db
    .insert(departments)
    .values({
      slug: `project-document-worker-context-department-${input.label
        .toLowerCase()
        .replaceAll(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")}-${crypto.randomUUID()}`,
      name: `${input.label} Department`,
      role: `${input.label} Generic Role`,
      harness: "codex",
      defaultModel: "default",
      defaultReasoning: "medium",
      systemPrompt: `Act as ${input.label}.`,
      canWrite: false,
      canRunCommands: true,
      canCommit: false,
    })
    .returning();

  createdDepartmentIds.add(department.id);

  const [agent] = await db
    .insert(agents)
    .values({
      departmentId: department.id,
      teamId: RESOLUTION_TEAM_ID,
      slug: `project-document-worker-context-${input.label
        .toLowerCase()
        .replaceAll(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")}-${crypto.randomUUID()}`,
      name: input.label,
      description:
        "End-to-end Project Document worker-context regression agent",
      layer: layerBase + input.relativeLayer,
      executionOrder: 1,
      enabled: true,
    })
    .returning();

  createdAgentIds.add(agent.id);

  await db.insert(teamMembers).values({
    teamId: RESOLUTION_TEAM_ID,
    departmentId: agent.departmentId,
    agentId: agent.id,
    layer: agent.layer ?? 1,
    executionOrder: agent.executionOrder ?? 1,
  });

  return agent;
}

/**
 * Builds six separately chunkable Markdown sections that all match the Task query.
 */
function createBoundedDocumentContent(): string {
  return Array.from(
    {
      length: MAX_PROJECT_DOCUMENT_CONTEXT_ITEMS + 1,
    },
    (_value, index) => {
      const marker =
        index === 0
          ? "SNAPSHOTTED_PROJECT_DOCUMENT_SENTINEL"
          : `ORIGINAL_CONTEXT_SECTION_${index + 1}`;

      return [
        `# Worker context ${index + 1}`,
        `worker context ${marker} ${"x".repeat(1_100)}`,
      ].join("\n");
    },
  ).join("\n");
}

/**
 * Persists one real Project Document through the production normalization and chunking service.
 */
async function createTestDocument(
  content: string = createBoundedDocumentContent(),
) {
  return createProjectDocument({
    teamId: RESOLUTION_TEAM_ID,
    projectPath: testState.project!.path,
    fileName: "worker-context.md",
    extension: ".md",
    mediaType: "text/markdown",
    content,
  });
}

/**
 * Queues the real create_task and start_run tool path followed by a final supervisor response.
 */
function queueCreateStartTurns(): void {
  testState.supervisorTurns.push(
    {
      type: "tool_call",
      tool: {
        name: "create_task",
        arguments: {
          title: "Worker context regression",
          instruction:
            "Use the attached worker context to complete the worker context regression.",
        },
      },
    },
    {
      type: "tool_call",
      tool: {
        name: "start_run",
        arguments: {},
      },
    },
    {
      type: "final",
      response:
        "The Task and Run were created from authoritative application state.",
    },
  );
}

/**
 * Creates one Conversation and drives it through the real trusted Task and Run creation path.
 */
async function createConversationTaskRun(documentIds: string[]) {
  const conversation = await createConversation(
    testState.project!.path,
    RESOLUTION_TEAM_ID,
  );

  queueCreateStartTurns();

  const response = await postConversationMessage(
    conversation.id,
    "Create and start the task using only the documents explicitly attached to this message.",
    documentIds,
  );

  if (!response?.taskId || !response.runId) {
    throw new Error(
      "Expected the supervisor tool path to create both a Task and a Run",
    );
  }

  return {
    conversation,
    taskId: response.taskId,
    runId: response.runId,
  };
}

/**
 * Waits until the requested number of mocked worker executions have been launched.
 */
async function waitForWorkerLaunches(expectedCount: number): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (testState.workerLaunches.length >= expectedCount) {
      return;
    }

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 10);
    });
  }

  throw new Error(`Timed out waiting for ${expectedCount} worker launches`);
}

/**
 * Waits until a Run reaches any persisted terminal workflow state.
 */
async function waitForTerminalRun(runId: string) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const [run] = await db.select().from(runs).where(eq(runs.id, runId));

    if (
      run &&
      ["completed", "failed", "blocked", "cancelled"].includes(run.status)
    ) {
      return run;
    }

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 10);
    });
  }

  throw new Error(`Timed out waiting for Run ${runId}`);
}

/**
 * Reads and validates only the Project Document portion of the immutable Run workflow snapshot.
 */
async function loadRunDocumentContext(runId: string) {
  const [run] = await db
    .select({
      workflowSnapshot: runs.workflowSnapshot,
    })
    .from(runs)
    .where(eq(runs.id, runId));

  if (!run) {
    throw new Error(`Run ${runId} does not exist`);
  }

  const snapshot = run.workflowSnapshot as {
    taskDocumentContext?: unknown;
  };

  return uploadedProjectDocumentContextCollectionSchema.parse(
    snapshot.taskDocumentContext ?? [],
  );
}

/**
 * Mutates the mutable Project Document source after Run creation to prove later workers use only the snapshot.
 */
async function mutateProjectDocument(documentId: string): Promise<void> {
  const mutatedContent =
    "MUTATED_PROJECT_DOCUMENT_SENTINEL worker context changed after the Run snapshot was created.";

  await db
    .update(projectDocuments)
    .set({
      fileName: "mutated-worker-context.md",
      content: mutatedContent,
      contentHash: "f".repeat(64),
      contentBytes: Buffer.byteLength(mutatedContent, "utf8"),
      updatedAt: new Date(),
    })
    .where(eq(projectDocuments.id, documentId));

  await db
    .update(projectDocumentChunks)
    .set({
      content: mutatedContent,
      contentHash: "e".repeat(64),
    })
    .where(eq(projectDocumentChunks.projectDocumentId, documentId));
}

/**
 * Loads the persisted user message created for one Conversation.
 */
async function loadUserMessage(conversationId: string) {
  const [message] = await db
    .select()
    .from(conversationMessages)
    .where(
      and(
        eq(conversationMessages.conversationId, conversationId),
        eq(conversationMessages.role, "user"),
      ),
    );

  if (!message) {
    throw new Error(
      `Conversation ${conversationId} has no persisted user message`,
    );
  }

  return message;
}

beforeEach(async () => {
  layerBase += 100;

  testState.project = makeProject();

  testState.supervisorTurns.length = 0;

  testState.workerLaunches.length = 0;

  testState.startSnapshotAgentExecution.mockReset();

  testState.cancelLiveExecution.mockReset();

  testState.cancelLiveExecution.mockResolvedValue(true);

  originalAgentStates = await db
    .select({
      id: agents.id,
      enabled: agents.enabled,
    })
    .from(agents)
    .where(eq(agents.teamId, RESOLUTION_TEAM_ID));

  const [resolutionTeam] = await db
    .select({
      enabled: teams.enabled,
    })
    .from(teams)
    .where(eq(teams.id, RESOLUTION_TEAM_ID));

  originalResolutionTeamEnabled = resolutionTeam?.enabled ?? true;

  await db
    .update(agents)
    .set({
      enabled: false,
    })
    .where(eq(agents.teamId, RESOLUTION_TEAM_ID));

  await db
    .update(teams)
    .set({
      enabled: true,
    })
    .where(eq(teams.id, RESOLUTION_TEAM_ID));

  testState.startSnapshotAgentExecution.mockImplementation(
    async (
      _run: unknown,
      snapshotAgent: {
        id: string;
      },
      instruction: string,
      onFinalized?: (
        finalization: ExecutionFinalization,
      ) => Promise<void> | void,
    ) => {
      let finalized = false;

      const launch: WorkerLaunch = {
        agentId: snapshotAgent.id,
        instruction,

        /**
         * Completes this synthetic worker exactly once using the normal workflow callback.
         */
        async finalize(status: AgentResultStatus = "completed") {
          if (finalized) {
            throw new Error(
              `Worker ${snapshotAgent.id} was finalized more than once`,
            );
          }

          finalized = true;

          const finalization: ExecutionFinalization = {
            executionId: crypto.randomUUID(),
            status: executionStatusForResult(status),
            resultStatus: status,
            failureReason:
              status === "failed" ? "Synthetic worker failure" : null,
            result: createResult(status),
          };

          await Promise.resolve(onFinalized?.(finalization));
        },
      };

      testState.workerLaunches.push(launch);

      return {} as never;
    },
  );
});

afterEach(async () => {
  const projectPath = testState.project?.path;

  if (projectPath) {
    await db
      .delete(domainEvents)
      .where(eq(domainEvents.projectPath, projectPath));

    await db.delete(runs).where(eq(runs.projectPath, projectPath));

    const projectConversations = await db
      .select({
        id: conversations.id,
      })
      .from(conversations)
      .where(eq(conversations.projectPath, projectPath));

    for (const conversation of projectConversations) {
      await db
        .delete(conversationMessages)
        .where(eq(conversationMessages.conversationId, conversation.id));

      await db
        .delete(conversations)
        .where(eq(conversations.id, conversation.id));
    }

    await db.delete(tasks).where(eq(tasks.projectPath, projectPath));

    await db
      .delete(projectDocuments)
      .where(eq(projectDocuments.projectPath, projectPath));
  }

  for (const agentId of createdAgentIds) {
    const [member] = await db
      .select({ id: teamMembers.id })
      .from(teamMembers)
      .where(eq(teamMembers.agentId, agentId));

    if (member) {
      await db
        .delete(teamMemberRoutes)
        .where(eq(teamMemberRoutes.sourceTeamMemberId, member.id));
    }

    await db.delete(teamMembers).where(eq(teamMembers.agentId, agentId));

    await db.delete(agents).where(eq(agents.id, agentId));
  }

  for (const departmentId of createdDepartmentIds) {
    await db.delete(departments).where(eq(departments.id, departmentId));
  }

  for (const state of originalAgentStates) {
    await db
      .update(agents)
      .set({
        enabled: state.enabled,
      })
      .where(eq(agents.id, state.id));
  }

  await db
    .update(teams)
    .set({
      enabled: originalResolutionTeamEnabled,
    })
    .where(eq(teams.id, RESOLUTION_TEAM_ID));

  createdAgentIds.clear();
  createdDepartmentIds.clear();

  originalAgentStates = [];

  testState.project = null;

  testState.supervisorTurns.length = 0;

  testState.workerLaunches.length = 0;
});

describe("Project Documents -> worker context regression", () => {
  /**
   * Proves the full same-scope attachment path, bounded snapshot selection, worker propagation, and immutable monitoring history.
   */
  it("carries attached Project Documents through Task creation and every forward worker from one immutable bounded Run snapshot", async () => {
    const first = await createTestAgent({
      label: "First Worker",
      relativeLayer: 1,
    });

    const second = await createTestAgent({
      label: "Second Worker",
      relativeLayer: 2,
    });

    const third = await createTestAgent({
      label: "Third Worker",
      relativeLayer: 3,
    });

    const uploaded = await createTestDocument();

    expect(uploaded.chunkCount).toBe(MAX_PROJECT_DOCUMENT_CONTEXT_ITEMS + 1);

    const flow = await createConversationTaskRun([uploaded.document.id]);

    const userMessage = await loadUserMessage(flow.conversation.id);

    const messageAttachments = await db
      .select()
      .from(conversationMessageDocuments)
      .where(
        eq(conversationMessageDocuments.conversationMessageId, userMessage.id),
      );

    expect(messageAttachments).toEqual([
      expect.objectContaining({
        projectDocumentId: uploaded.document.id,
      }),
    ]);

    const persistedTaskDocuments = await db
      .select()
      .from(taskDocuments)
      .where(eq(taskDocuments.taskId, flow.taskId));

    expect(persistedTaskDocuments).toEqual([
      expect.objectContaining({
        projectDocumentId: uploaded.document.id,
      }),
    ]);

    const snapshotContext = await loadRunDocumentContext(flow.runId);

    expect(snapshotContext).toHaveLength(MAX_PROJECT_DOCUMENT_CONTEXT_ITEMS);

    expect(snapshotContext.map((ref) => ref.chunkSequence)).toEqual([
      0, 1, 2, 3, 4,
    ]);

    expect(
      snapshotContext.every((ref) => ref.documentId === uploaded.document.id),
    ).toBe(true);

    expect(
      snapshotContext.every(
        (ref) => ref.excerpt.length <= MAX_PROJECT_DOCUMENT_EXCERPT_CHARS,
      ),
    ).toBe(true);

    expect(
      snapshotContext.reduce((total, ref) => total + ref.excerpt.length, 0),
    ).toBe(MAX_PROJECT_DOCUMENT_CONTEXT_CHARS);

    await waitForWorkerLaunches(1);

    expect(testState.workerLaunches[0]?.agentId).toBe(first.id);

    expect(testState.workerLaunches[0]?.instruction).toContain(
      "SNAPSHOTTED_PROJECT_DOCUMENT_SENTINEL",
    );

    await mutateProjectDocument(uploaded.document.id);

    await testState.workerLaunches[0]!.finalize("completed");

    await waitForWorkerLaunches(2);

    expect(testState.workerLaunches[1]?.agentId).toBe(second.id);

    await testState.workerLaunches[1]!.finalize("completed");

    await waitForWorkerLaunches(3);

    expect(testState.workerLaunches[2]?.agentId).toBe(third.id);

    await testState.workerLaunches[2]!.finalize("approved");

    const terminalRun = await waitForTerminalRun(flow.runId);

    expect(terminalRun.status).toBe("completed");

    expect(testState.workerLaunches.map((launch) => launch.agentId)).toEqual([
      first.id,
      second.id,
      third.id,
    ]);

    for (const launch of testState.workerLaunches) {
      expect(launch.instruction).toContain(
        "Uploaded project document context:",
      );

      expect(launch.instruction).toContain(
        "SNAPSHOTTED_PROJECT_DOCUMENT_SENTINEL",
      );

      expect(launch.instruction).not.toContain(
        "MUTATED_PROJECT_DOCUMENT_SENTINEL",
      );

      expect(launch.instruction).toContain(uploaded.document.contentHash);
    }

    const monitoring = await getRunMonitoringDetail(flow.runId);

    expect(monitoring).not.toBeNull();

    expect(monitoring!.taskDocumentContext).toHaveLength(
      MAX_PROJECT_DOCUMENT_CONTEXT_ITEMS,
    );

    expect(monitoring!.taskDocumentContext[0]).toEqual(
      expect.objectContaining({
        source: "project_document",
        documentId: uploaded.document.id,
        fileName: "worker-context.md",
        documentContentHash: uploaded.document.contentHash,
        chunkSequence: 0,
      }),
    );

    expect(monitoring!.taskDocumentContext[0]).not.toHaveProperty("excerpt");

    const selectionEvents = await db
      .select()
      .from(domainEvents)
      .where(
        and(
          eq(domainEvents.runId, flow.runId),
          eq(domainEvents.type, "run.document_context_selected"),
        ),
      );

    expect(selectionEvents).toHaveLength(1);

    expect(selectionEvents[0]?.data).toEqual({
      documentIds: snapshotContext.map((ref) => ref.documentId),
      chunkCount: snapshotContext.length,
    });
  });

  /**
   * Proves configured changes_requested routing reuses the original Project Document snapshot after mutable source rows change.
   */
  it("preserves the same snapshotted context through a configured changes_requested routing loop", async () => {
    const first = await createTestAgent({
      label: "Planning Worker",
      relativeLayer: 1,
    });

    const implementer = await createTestAgent({
      label: "Implementation Worker",
      relativeLayer: 2,
    });

    const reviewer = await createTestAgent({
      label: "Review Worker",
      relativeLayer: 3,
    });

    const [reviewerMember] = await db
      .select({ id: teamMembers.id })
      .from(teamMembers)
      .where(eq(teamMembers.agentId, reviewer.id));

    const [implementerMember] = await db
      .select({ id: teamMembers.id })
      .from(teamMembers)
      .where(eq(teamMembers.agentId, implementer.id));

    await db.insert(teamMemberRoutes).values({
      sourceTeamMemberId: reviewerMember!.id,
      outcome: "changes_requested",
      targetTeamMemberId: implementerMember!.id,
      terminalAction: null,
      enabled: true,
    });

    const uploaded = await createTestDocument();

    const flow = await createConversationTaskRun([uploaded.document.id]);

    const originalSnapshot = await loadRunDocumentContext(flow.runId);

    await waitForWorkerLaunches(1);

    await testState.workerLaunches[0]!.finalize("completed");

    await waitForWorkerLaunches(2);

    await testState.workerLaunches[1]!.finalize("completed");

    await waitForWorkerLaunches(3);

    expect(testState.workerLaunches[2]?.agentId).toBe(reviewer.id);

    await mutateProjectDocument(uploaded.document.id);

    await testState.workerLaunches[2]!.finalize("changes_requested");

    await waitForWorkerLaunches(4);

    expect(testState.workerLaunches[3]?.agentId).toBe(implementer.id);

    await testState.workerLaunches[3]!.finalize("completed");

    await waitForWorkerLaunches(5);

    expect(testState.workerLaunches[4]?.agentId).toBe(reviewer.id);

    await testState.workerLaunches[4]!.finalize("approved");

    const terminalRun = await waitForTerminalRun(flow.runId);

    expect(terminalRun.status).toBe("completed");

    expect(testState.workerLaunches.map((launch) => launch.agentId)).toEqual([
      first.id,
      implementer.id,
      reviewer.id,
      implementer.id,
      reviewer.id,
    ]);

    for (const launch of testState.workerLaunches) {
      expect(launch.instruction).toContain(
        "SNAPSHOTTED_PROJECT_DOCUMENT_SENTINEL",
      );

      expect(launch.instruction).not.toContain(
        "MUTATED_PROJECT_DOCUMENT_SENTINEL",
      );
    }

    expect(await loadRunDocumentContext(flow.runId)).toEqual(originalSnapshot);

    const monitoring = await getRunMonitoringDetail(flow.runId);

    expect(
      monitoring!.taskDocumentContext.map((ref) => ({
        documentId: ref.documentId,
        documentContentHash: ref.documentContentHash,
        chunkSequence: ref.chunkSequence,
        chunkContentHash: ref.chunkContentHash,
      })),
    ).toEqual(
      originalSnapshot.map((ref) => ({
        documentId: ref.documentId,
        documentContentHash: ref.documentContentHash,
        chunkSequence: ref.chunkSequence,
        chunkContentHash: ref.chunkContentHash,
      })),
    );

    const selectionEvents = await db
      .select()
      .from(domainEvents)
      .where(
        and(
          eq(domainEvents.runId, flow.runId),
          eq(domainEvents.type, "run.document_context_selected"),
        ),
      );

    expect(selectionEvents).toHaveLength(1);
  });

  /**
   * Proves an existing same-scope Project Document is never treated as ambient worker context unless the user attached it.
   */
  it("keeps unattached Project Documents out of Task, Run, worker, event, and monitoring context", async () => {
    const first = await createTestAgent({
      label: "Unattached First Worker",
      relativeLayer: 1,
    });

    const second = await createTestAgent({
      label: "Unattached Second Worker",
      relativeLayer: 2,
    });

    const uploaded = await createTestDocument(
      [
        "# Ambient document",
        "UNATTACHED_PROJECT_DOCUMENT_SENTINEL must never become ambient worker context.",
      ].join("\n"),
    );

    const flow = await createConversationTaskRun([]);

    const userMessage = await loadUserMessage(flow.conversation.id);

    const messageAttachments = await db
      .select()
      .from(conversationMessageDocuments)
      .where(
        eq(conversationMessageDocuments.conversationMessageId, userMessage.id),
      );

    expect(messageAttachments).toHaveLength(0);

    const persistedTaskDocuments = await db
      .select()
      .from(taskDocuments)
      .where(eq(taskDocuments.taskId, flow.taskId));

    expect(persistedTaskDocuments).toHaveLength(0);

    expect(await loadRunDocumentContext(flow.runId)).toEqual([]);

    await waitForWorkerLaunches(1);

    await testState.workerLaunches[0]!.finalize("completed");

    await waitForWorkerLaunches(2);

    await testState.workerLaunches[1]!.finalize("approved");

    const terminalRun = await waitForTerminalRun(flow.runId);

    expect(terminalRun.status).toBe("completed");

    expect(testState.workerLaunches.map((launch) => launch.agentId)).toEqual([
      first.id,
      second.id,
    ]);

    for (const launch of testState.workerLaunches) {
      expect(launch.instruction).not.toContain(
        "Uploaded project document context:",
      );

      expect(launch.instruction).not.toContain(
        "UNATTACHED_PROJECT_DOCUMENT_SENTINEL",
      );

      expect(launch.instruction).not.toContain(uploaded.document.id);
    }

    const monitoring = await getRunMonitoringDetail(flow.runId);

    expect(monitoring!.taskDocumentContext).toEqual([]);

    const selectionEvents = await db
      .select()
      .from(domainEvents)
      .where(
        and(
          eq(domainEvents.runId, flow.runId),
          eq(domainEvents.type, "run.document_context_selected"),
        ),
      );

    expect(selectionEvents).toHaveLength(0);
  });
});
