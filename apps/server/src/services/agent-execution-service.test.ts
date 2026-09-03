import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  HarnessAdapter,
  PtyExitEvent,
  PtyFactory,
  PtyProcess,
  StartWorkerInput,
} from "../runtime/contracts.js";
import { InMemoryRuntimeSession } from "../runtime/session.js";

// These tests exercise real Postgres (see vitest.config.ts, which loads DATABASE_URL from .env
// the same way `db:migrate` does). They require the docker-compose Postgres service or an
// equivalent local instance to be running and migrated.
class FakePty implements PtyProcess {
  pid = 4321;
  readonly writes: string[] = [];

  private readonly dataListeners = new Set<(data: string) => void>();
  private readonly exitListeners = new Set<(event: PtyExitEvent) => void>();

  /** Registers a fake PTY output listener. */
  onData(listener: (data: string) => void) {
    this.dataListeners.add(listener);
    return { dispose: () => this.dataListeners.delete(listener) };
  }

  /** Registers a fake PTY exit listener. */
  onExit(listener: (event: PtyExitEvent) => void) {
    this.exitListeners.add(listener);
    return { dispose: () => this.exitListeners.delete(listener) };
  }

  /** Records input written through the expanded PTY contract. */
  write(data: string) {
    this.writes.push(data);
  }

  /** Accepts process termination requests for this fake PTY. */
  kill() {}

  /** Emits fake PTY output to all registered listeners. */
  data(value: string) {
    for (const listener of this.dataListeners) listener(value);
  }

  /** Emits a fake PTY process exit event. */
  exit(exitCode: number, signal?: number) {
    for (const listener of this.exitListeners) {
      listener({ exitCode, signal });
    }
  }
}

// Fake harness that treats each line of raw PTY output as JSON `{"text": "..."}` and surfaces
// that `text` field via extractMessageText, mirroring how a real HarnessAdapter would extract
// assistant message text from harness-specific stream-json fields. Non-JSON lines are ignored.
function makeFakeAdapter(
  harness: StartWorkerInput["agent"]["harness"],
): HarnessAdapter {
  return {
    harness,

    /** Builds the fake invocation while forwarding the environment supplied by the runtime. */
    createInvocation: (value, _prompt, environment) => ({
      command: "fake",
      args: [],
      cwd: value.projectPath,
      env: environment,
    }),

    /** Converts fake JSON PTY output into a normalized provider event. */
    translateOutput: (data) => {
      try {
        const event = JSON.parse(data) as Record<string, unknown>;

        return [
          {
            type: "provider",
            provider: "fake",
            event,
          },
        ];
      } catch {
        return [];
      }
    },

    /** Extracts assistant text from the fake provider event. */
    extractMessageText: (event) =>
      typeof event.text === "string"
        ? event.text
        : undefined,
  };
}

// The service resolves its own HarnessAdapter via getHarnessAdapter(agent.harness), so this must
// return the same fake adapter shape used by the mocked startWorker implementation.
const mockFakeAdapter = makeFakeAdapter("codex");

// Tracks every PTY spawned via startWorker(), in order, so tests covering the one-repair-attempt
// flow can drive both attempts independently.
let ptyInstances: FakePty[] = [];

/** Returns a previously spawned fake PTY and fails clearly when it does not exist. */
function pty(index: number): FakePty {
  const instance = ptyInstances[index];

  if (!instance) {
    throw new Error(`Expected a spawned PTY at index ${index}`);
  }

  return instance;
}

/** Emits a valid structured ORC result through the fake provider stream. */
function feedResult(
  instance: FakePty,
  payload: Record<string, unknown>,
): void {
  instance.data(
    JSON.stringify({
      text: `<orc-result>${JSON.stringify(payload)}</orc-result>`,
    }),
  );
}

vi.mock("../runtime/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../runtime/index.js")>();

  return {
    ...actual,

    // Starts the real in-memory runtime session while replacing only the external harness PTY.
    startWorker: (input: StartWorkerInput) => {
      const instance = new FakePty();

      ptyInstances.push(instance);

      const adapter = makeFakeAdapter(input.agent.harness);

      const factory: PtyFactory = {
        /** Returns the fake process instead of launching a real harness CLI. */
        spawn: () => instance,
      };

      return InMemoryRuntimeSession.start(
        input,
        adapter,
        factory,
      );
    },

    // Keeps structured-result extraction aligned with the provider events produced by this test.
    getHarnessAdapter: () => mockFakeAdapter,
  };
});

const { db } = await import("../db/client.js");
const {
  agents,
  agentExecutions,
  runs,
  terminalChunks,
} = await import("../db/schema.js");
const {
  createRun,
  startAgentExecution,
  getExecution,
  listTerminalChunks,
} = await import("./agent-execution-service.js");

/** Polls the database until a test condition returns a truthy result or times out. */
async function waitFor<T>(
  check: () => Promise<T | undefined | false>,
  timeoutMs = 2000,
): Promise<T> {
  const start = Date.now();

  for (;;) {
    const result = await check();

    if (result) return result;

    if (Date.now() - start > timeoutMs) {
      throw new Error("Timed out waiting for condition");
    }

    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe("agent-execution-service", () => {
  let projectPath: string;
  let agentId: string;
  let runId: string;
  let agentLayer: number;

  beforeEach(async () => {
    projectPath = fs.mkdtempSync(
      path.join(os.tmpdir(), "orc-execution-service-"),
    );

    const [agent] = await db
      .insert(agents)
      .values({
        slug: `test-agent-${crypto.randomUUID()}`,
        name: "Test Agent",
        role: "Tester",
        layer: (agentLayer =
          900 + Math.floor(Math.random() * 100_000)),
        executionOrder: 1,
        harness: "codex",
        model: "gpt-5",
        reasoning: "high",
        systemPrompt: "Test carefully.",
        canWrite: false,
        canRunCommands: true,
        canCommit: false,
      })
      .returning();

    agentId = agent.id;

    const run = await createRun(projectPath);
    runId = run.id;
  });

  afterEach(async () => {
    fs.rmSync(projectPath, {
      recursive: true,
      force: true,
    });

    ptyInstances = [];

    const executions = await db
      .select({ id: agentExecutions.id })
      .from(agentExecutions)
      .where(eq(agentExecutions.runId, runId));

    for (const execution of executions) {
      await db
        .delete(terminalChunks)
        .where(eq(terminalChunks.agentExecutionId, execution.id));
    }

    await db
      .delete(agentExecutions)
      .where(eq(agentExecutions.runId, runId));

    await db
      .delete(runs)
      .where(eq(runs.id, runId));

    await db
      .delete(agents)
      .where(eq(agents.id, agentId));
  });

  it("persists denormalized agent fields when starting an execution", async () => {
    const execution = await startAgentExecution(
      runId,
      agentId,
      "Inspect the repository.",
    );

    expect(execution).toMatchObject({
      runId,
      agentId,
      agentName: "Test Agent",
      agentRole: "Tester",
      layer: agentLayer,
      executionOrder: 1,
      harness: "codex",
      model: "gpt-5",
      reasoning: "high",
      status: "starting",
    });

    const persisted = await getExecution(execution.id);

    expect(persisted).toMatchObject({
      agentName: "Test Agent",
      harness: "codex",
    });
  });

  it("produces ordered terminal_chunks rows from output events and records the pid once running", async () => {
    const execution = await startAgentExecution(
      runId,
      agentId,
      "Inspect the repository.",
    );

    pty(0).data("one");
    pty(0).data("two");

    const chunks = await waitFor(async () => {
      const rows = await listTerminalChunks(execution.id);

      return rows.length >= 2
        ? rows
        : undefined;
    });

    expect(
      chunks.map((chunk) => chunk.data),
    ).toEqual([
      "one",
      "two",
    ]);

    expect(chunks[0].sequence).toBeLessThan(
      chunks[1].sequence,
    );

    const running = await waitFor(async () => {
      const current = await getExecution(execution.id);

      return current?.status === "running"
        ? current
        : undefined;
    });

    expect(running.pid).toBe(pty(0).pid);
    expect(running.startedAt).not.toBeNull();
  });

  it("finalizes on a valid first-attempt result without triggering a repair", async () => {
    const execution = await startAgentExecution(
      runId,
      agentId,
      "Inspect the repository.",
    );

    const payload = {
      status: "completed",
      summary: "Implemented the requested change.",
      commit: null,
    };

    feedResult(pty(0), payload);
    pty(0).exit(0);

    const completed = await waitFor(async () => {
      const current = await getExecution(execution.id);

      return current?.status === "completed"
        ? current
        : undefined;
    });

    expect(completed.exitCode).toBe(0);
    expect(completed.completedAt).not.toBeNull();
    expect(completed.repairAttempted).toBe(false);
    expect(completed.resultStatus).toBe("completed");
    expect(completed.resultPayload).toMatchObject(payload);
    expect(completed.commitHash).toBeNull();
    expect(ptyInstances).toHaveLength(1);
  });

  it("repairs a malformed first attempt and finalizes on a valid repair result", async () => {
    const execution = await startAgentExecution(
      runId,
      agentId,
      "Inspect the repository.",
    );

    pty(0).data(
      JSON.stringify({
        text: "No result block here.",
      }),
    );

    pty(0).exit(0);

    await waitFor(async () => {
      const current = await getExecution(execution.id);

      return current?.repairAttempted
        ? current
        : undefined;
    });

    const repairPayload = {
      status: "changes_requested",
      summary: "Found issues to address.",
      commit: null,
    };

    await waitFor(async () =>
      ptyInstances.length >= 2
        ? true
        : undefined,
    );

    feedResult(pty(1), repairPayload);
    pty(1).exit(0);

    const finalized = await waitFor(async () => {
      const current = await getExecution(execution.id);

      return current?.resultStatus
        ? current
        : undefined;
    });

    expect(finalized.repairAttempted).toBe(true);
    expect(finalized.status).toBe("completed");
    expect(finalized.resultStatus).toBe("changes_requested");
    expect(finalized.resultPayload).toMatchObject(repairPayload);
    expect(ptyInstances).toHaveLength(2);
  });

  it("fails the execution when both the first attempt and the repair attempt are invalid", async () => {
    const execution = await startAgentExecution(
      runId,
      agentId,
      "Inspect the repository.",
    );

    pty(0).data(
      JSON.stringify({
        text: "No result block here either.",
      }),
    );

    pty(0).exit(1);

    await waitFor(async () => {
      const current = await getExecution(execution.id);

      return current?.repairAttempted
        ? current
        : undefined;
    });

    await waitFor(async () =>
      ptyInstances.length >= 2
        ? true
        : undefined,
    );

    pty(1).data(
      JSON.stringify({
        text: "Still no result block.",
      }),
    );

    pty(1).exit(1);

    const failed = await waitFor(async () => {
      const current = await getExecution(execution.id);

      return current?.status === "failed"
        ? current
        : undefined;
    });

    expect(failed.repairAttempted).toBe(true);
    expect(failed.resultStatus).toBeNull();
    expect(failed.failureReason).toBeTruthy();
    expect(ptyInstances).toHaveLength(2);
  });

  it("treats a reported commit from an agent without commit permission as invalid and triggers a repair", async () => {
    const execution = await startAgentExecution(
      runId,
      agentId,
      "Inspect the repository.",
    );

    feedResult(pty(0), {
      status: "completed",
      summary: "Implemented the change.",
      commit: "abc1234",
    });

    pty(0).exit(0);

    await waitFor(async () => {
      const current = await getExecution(execution.id);

      return current?.repairAttempted
        ? current
        : undefined;
    });

    await waitFor(async () =>
      ptyInstances.length >= 2
        ? true
        : undefined,
    );

    const correctedPayload = {
      status: "completed",
      summary: "Implemented the change.",
      commit: null,
    };

    feedResult(pty(1), correctedPayload);
    pty(1).exit(0);

    const finalized = await waitFor(async () => {
      const current = await getExecution(execution.id);

      return current?.resultStatus
        ? current
        : undefined;
    });

    expect(finalized.repairAttempted).toBe(true);
    expect(finalized.status).toBe("completed");
    expect(finalized.commitHash).toBeNull();
    expect(ptyInstances).toHaveLength(2);
  });
});
