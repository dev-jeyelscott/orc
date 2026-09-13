import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentResult } from "@orc/shared";

const mocks = vi.hoisted(() => ({
  getProject: vi.fn(),
  getProjectByPath: vi.fn(),
  startSnapshotAgentExecution: vi.fn(),
  cancelLiveExecution: vi.fn(),
  instructions: [] as { agentId: string; instruction: string }[],
  firstAgentResult: null as AgentResult | null,
}));

vi.mock("./project-discovery.js", () => ({
  getProject: mocks.getProject,
  getProjectByPath: mocks.getProjectByPath,
}));

vi.mock("./agent-execution-service.js", () => ({
  startSnapshotAgentExecution: mocks.startSnapshotAgentExecution,
  cancelLiveExecution: mocks.cancelLiveExecution,
}));

const { db } = await import("../db/client.js");
const { RESOLUTION_TEAM_ID } = await import("../db/seed-ids.js");
const {
  agents,
  departments,
  domainEvents,
  runs,
  tasks,
  teamMembers,
} = await import("../db/schema.js");
const { createTask, startTask } = await import("./workflow-service.js");
const { createKnowledgeCategory, deleteKnowledgeCategory } = await import(
  "./knowledge-category-service.js"
);

const project = {
  id: "phase9-knowledge-gate-project",
  name: "orc",
  path: `/tmp/orc-phase9-knowledge-gate-${crypto.randomUUID()}`,
  branch: "main",
  gitState: "clean" as const,
  primaryFiles: ["package.json"],
  packageManager: "pnpm" as const,
  stack: "node",
};

let departmentId: string | null = null;
let secondDepartmentId: string | null = null;
let firstAgentId: string | null = null;
let secondAgentId: string | null = null;
let taskId: string | null = null;
let runId: string | null = null;
let originalAgentStates: Array<{ id: string; enabled: boolean }> = [];

function completedResult(overrides: Partial<AgentResult> = {}): AgentResult {
  return {
    status: "completed",
    summary: "Completed the generic step.",
    details: {},
    findings: [],
    filesChanged: [],
    commandsRun: [],
    validation: {},
    commit: null,
    ...overrides,
  };
}

async function waitForTerminalRun(id: string) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const [run] = await db.select().from(runs).where(eq(runs.id, id));

    if (run && ["completed", "failed", "blocked", "cancelled"].includes(run.status)) {
      return run;
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(`Timed out waiting for Run ${id}`);
}

beforeEach(async () => {
  mocks.getProject.mockReset();
  mocks.getProjectByPath.mockReset();
  mocks.startSnapshotAgentExecution.mockReset();
  mocks.cancelLiveExecution.mockReset();
  mocks.instructions.length = 0;
  mocks.firstAgentResult = completedResult();

  mocks.getProject.mockResolvedValue(project);
  mocks.getProjectByPath.mockResolvedValue(project);

  originalAgentStates = await db.select({ id: agents.id, enabled: agents.enabled }).from(agents);
  await db.update(agents).set({ enabled: false });

  const [department] = await db
    .insert(departments)
    .values({
      slug: `phase9-knowledge-gate-department-${crypto.randomUUID()}`,
      name: "Knowledge Gate Department",
      role: "Custom Engineering Role",
      harness: "codex",
      defaultModel: "default",
      defaultReasoning: "medium",
      systemPrompt: "Complete the supplied task generically.",
      canWrite: false,
      canRunCommands: true,
      canCommit: false,
    })
    .returning();
  departmentId = department.id;

  const [secondDepartment] = await db
    .insert(departments)
    .values({
      slug: `phase9-knowledge-gate-department-2-${crypto.randomUUID()}`,
      name: "Knowledge Gate Department 2",
      role: "Custom Engineering Role",
      harness: "codex",
      defaultModel: "default",
      defaultReasoning: "medium",
      systemPrompt: "Complete the supplied task generically.",
      canWrite: false,
      canRunCommands: true,
      canCommit: false,
    })
    .returning();
  secondDepartmentId = secondDepartment.id;

  const [first] = await db
    .insert(agents)
    .values({
      departmentId: department.id,
      slug: `phase9-knowledge-gate-first-${crypto.randomUUID()}`,
      name: "First Agent",
      enabled: true,
    })
    .returning();
  firstAgentId = first.id;

  const [second] = await db
    .insert(agents)
    .values({
      departmentId: secondDepartment.id,
      slug: `phase9-knowledge-gate-second-${crypto.randomUUID()}`,
      name: "Second Agent",
      enabled: true,
    })
    .returning();
  secondAgentId = second.id;

  const baseLayer = 1_600_000 + Math.floor(Math.random() * 100_000);

  await db.insert(teamMembers).values([
    {
      teamId: RESOLUTION_TEAM_ID,
      departmentId: first.departmentId,
      agentId: first.id,
      layer: baseLayer,
      executionOrder: 1,
    },
    {
      teamId: RESOLUTION_TEAM_ID,
      departmentId: second.departmentId,
      agentId: second.id,
      layer: baseLayer + 1,
      executionOrder: 1,
    },
  ]);

  mocks.startSnapshotAgentExecution.mockImplementation(
    async (
      _run: unknown,
      snapshotAgent: { id: string },
      instruction: string,
      onFinalized?: (finalization: {
        executionId: string;
        status: "completed";
        resultStatus: "completed";
        failureReason: null;
        result: AgentResult;
      }) => Promise<void> | void,
    ) => {
      mocks.instructions.push({ agentId: snapshotAgent.id, instruction });

      const result =
        snapshotAgent.id === firstAgentId ? (mocks.firstAgentResult as AgentResult) : completedResult();

      queueMicrotask(() => {
        void Promise.resolve(
          onFinalized?.({
            executionId: crypto.randomUUID(),
            status: "completed",
            resultStatus: "completed",
            failureReason: null,
            result,
          }),
        );
      });

      return {} as never;
    },
  );
});

afterEach(async () => {
  if (runId) {
    await db.delete(domainEvents).where(eq(domainEvents.runId, runId));
    await db.delete(runs).where(eq(runs.id, runId));
  }

  if (taskId) {
    await db.delete(tasks).where(eq(tasks.id, taskId));
  }

  for (const id of [firstAgentId, secondAgentId]) {
    if (!id) continue;
    await db.delete(teamMembers).where(eq(teamMembers.agentId, id));
    await db.delete(agents).where(eq(agents.id, id));
  }

  for (const id of [departmentId, secondDepartmentId]) {
    if (!id) continue;
    await db.delete(departments).where(eq(departments.id, id));
  }

  for (const state of originalAgentStates) {
    await db.update(agents).set({ enabled: state.enabled }).where(eq(agents.id, state.id));
  }

  firstAgentId = null;
  secondAgentId = null;
  departmentId = null;
  secondDepartmentId = null;
  taskId = null;
  runId = null;
  originalAgentStates = [];
});

async function startGateTask(): Promise<string> {
  const task = await createTask({
    projectId: project.id,
    teamId: RESOLUTION_TEAM_ID,
    title: "Knowledge requirement gate task",
    instruction: "Plan the change, then implement it.",
  });
  taskId = task.id;

  const started = await startTask(task.id);

  if (!started) {
    throw new Error("Expected workflow to start");
  }

  runId = started.run.id;
  return runId;
}

describe("required-knowledge handoff gate", () => {
  it("passes a resolved required knowledge declaration through to the next worker", async () => {
    const category = await createKnowledgeCategory({
      slug: `phase9-ui-ux-${crypto.randomUUID()}`,
      name: "UI/UX Guidelines",
      description: "",
      vaultRootPath: "wiki/phase9-ui-ux",
      enabled: true,
    });

    mocks.firstAgentResult = completedResult({
      knowledgeRequirements: [
        {
          categorySlug: category.slug,
          query: "forms validation error states",
          reason: "The implementation adds a multi-step user form.",
          required: true,
        },
      ],
    });

    await startGateTask();
    const terminal = await waitForTerminalRun(runId as string);

    expect(terminal.status).toBe("completed");

    const secondInstruction = mocks.instructions.find((entry) => entry.agentId === secondAgentId);
    expect(secondInstruction?.instruction).toContain("Required knowledge:");
    expect(secondInstruction?.instruction).toContain(category.slug);

    await deleteKnowledgeCategory(category.id);
  });

  it("blocks the handoff when a required Knowledge Category cannot be resolved", async () => {
    mocks.firstAgentResult = completedResult({
      knowledgeRequirements: [
        {
          categorySlug: "does-not-exist",
          query: "anything",
          reason: "Testing the required gate.",
          required: true,
        },
      ],
    });

    await startGateTask();
    const terminal = await waitForTerminalRun(runId as string);

    expect(terminal.status).toBe("blocked");
    expect(terminal.terminalReason).toContain("does-not-exist");
    expect(mocks.instructions.some((entry) => entry.agentId === secondAgentId)).toBe(false);
  });

  it("blocks the handoff when a required Knowledge Category is disabled", async () => {
    const category = await createKnowledgeCategory({
      slug: `phase9-disabled-${crypto.randomUUID()}`,
      name: "Disabled Category",
      description: "",
      vaultRootPath: "wiki/phase9-disabled",
      enabled: false,
    });

    mocks.firstAgentResult = completedResult({
      knowledgeRequirements: [
        {
          categorySlug: category.slug,
          query: "anything",
          reason: "Testing the required gate.",
          required: true,
        },
      ],
    });

    await startGateTask();
    const terminal = await waitForTerminalRun(runId as string);

    expect(terminal.status).toBe("blocked");
    expect(mocks.instructions.some((entry) => entry.agentId === secondAgentId)).toBe(false);

    await deleteKnowledgeCategory(category.id);
  });

  it("does not block the handoff when an optional Knowledge Category cannot be resolved", async () => {
    mocks.firstAgentResult = completedResult({
      knowledgeRequirements: [
        {
          categorySlug: "does-not-exist-optional",
          query: "anything",
          reason: "Testing the optional path.",
          required: false,
        },
      ],
    });

    await startGateTask();
    const terminal = await waitForTerminalRun(runId as string);

    expect(terminal.status).toBe("completed");
    const secondInstruction = mocks.instructions.find((entry) => entry.agentId === secondAgentId);
    expect(secondInstruction).toBeDefined();
    expect(secondInstruction?.instruction).not.toContain("Required knowledge:");
  });
});
