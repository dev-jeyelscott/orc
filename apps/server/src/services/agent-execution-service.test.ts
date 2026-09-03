import { execFileSync } from "node:child_process";
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

// Fake harness that treats each complete raw PTY line as JSON `{"text": "..."}` and surfaces
// the `text` field as a completed assistant message. Non-JSON lines are ignored.
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

    /** Extracts completed assistant text from the fake provider event. */
    extractMessageText: (event) =>
      typeof event.text === "string"
        ? event.text
        : undefined,
  };
}

// The service resolves its own HarnessAdapter via getHarnessAdapter(agent.harness), so this must
// return the same fake adapter shape used by the mocked startWorker implementation.
const mockFakeAdapter = makeFakeAdapter("codex");

let ptyInstances: FakePty[] = [];
let workerStarts: Array<{
  input: StartWorkerInput;
  promptOverride?: string;
}> = [];

/** Returns a previously spawned fake PTY and fails clearly when it does not exist. */
function pty(index: number): FakePty {
  const instance = ptyInstances[index];

  if (!instance) {
    throw new Error(`Expected a spawned PTY at index ${index}`);
  }

  return instance;
}

/** Emits one completed assistant message through the fake provider stream. */
function feedCompletion(
  instance: FakePty,
  text: string,
): void {
  instance.data(`${JSON.stringify({ text })}\n`);
}

/** Emits a structured ORC result through the fake provider stream. */
function feedResult(
  instance: FakePty,
  payload: Record<string, unknown>,
): void {
  feedCompletion(
    instance,
    `<orc-result>${JSON.stringify(payload)}</orc-result>`,
  );
}

vi.mock("../runtime/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../runtime/index.js")>();

  return {
    ...actual,

    // Starts the normal worker through the fake PTY while preserving composed prompt behavior.
    startWorker: (input: StartWorkerInput) => {
      const instance = new FakePty();

      ptyInstances.push(instance);
      workerStarts.push({ input });

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

    // Starts caller-owned repair prompts through the same fake PTY and records the prompt override.
    startHarnessSession: (
      input: StartWorkerInput,
      promptOverride: string,
    ) => {
      const instance = new FakePty();

      ptyInstances.push(instance);
      workerStarts.push({ input, promptOverride });

      const adapter = makeFakeAdapter(input.agent.harness);
      const factory: PtyFactory = {
        /** Returns the fake process instead of launching a real harness CLI. */
        spawn: () => instance,
      };

      return InMemoryRuntimeSession.start(
        input,
        adapter,
        factory,
        promptOverride,
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
    ptyInstances = [];
    workerStarts = [];

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

    fs.rmSync(projectPath, {
      recursive: true,
      force: true,
    });
  });

  /** Updates the test agent capabilities before the execution snapshot is created. */
  async function setAgentCapabilities(
    capabilities: Partial<{
      canWrite: boolean;
      canRunCommands: boolean;
      canCommit: boolean;
    }>,
  ): Promise<void> {
    await db
      .update(agents)
      .set(capabilities)
      .where(eq(agents.id, agentId));
  }

  /** Creates one real local Git commit and returns its short and canonical hashes. */
  function createGitCommit(): {
    shortHash: string;
    fullHash: string;
  } {
    execFileSync("git", ["init"], {
      cwd: projectPath,
      stdio: "ignore",
    });
    execFileSync(
      "git",
      ["config", "user.email", "orc-test@example.com"],
      { cwd: projectPath, stdio: "ignore" },
    );
    execFileSync(
      "git",
      ["config", "user.name", "ORC Test"],
      { cwd: projectPath, stdio: "ignore" },
    );

    fs.writeFileSync(
      path.join(projectPath, "commit.txt"),
      "structured result commit\n",
    );

    execFileSync("git", ["add", "commit.txt"], {
      cwd: projectPath,
      stdio: "ignore",
    });
    execFileSync("git", ["commit", "-m", "test commit"], {
      cwd: projectPath,
      stdio: "ignore",
    });

    const fullHash = execFileSync(
      "git",
      ["rev-parse", "HEAD"],
      {
        cwd: projectPath,
        encoding: "utf8",
      },
    ).trim();

    return {
      shortHash: fullHash.slice(0, 7),
      fullHash,
    };
  }

  /** Waits for the controlled repair worker, completes it, and returns persisted final state. */
  async function completeRepair(
    executionId: string,
    payload: Record<string, unknown> = {
      status: "completed",
      summary: "Corrected structured result.",
      commit: null,
    },
  ) {
    await waitFor(async () =>
      ptyInstances.length >= 2
        ? true
        : undefined,
    );

    feedResult(pty(1), payload);
    pty(1).exit(0);

    return waitFor(async () => {
      const current = await getExecution(executionId);

      return current?.resultStatus
        ? current
        : undefined;
    });
  }

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

    pty(0).exit(1);

    await waitFor(async () => {
      const current = await getExecution(execution.id);
      return current?.status === "failed" ? current : undefined;
    });
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

  it("runs the one repair attempt with all side-effect capabilities disabled", async () => {
    await setAgentCapabilities({
      canWrite: true,
      canRunCommands: true,
      canCommit: true,
    });

    const execution = await startAgentExecution(
      runId,
      agentId,
      "Implement the requested change.",
    );

    feedCompletion(pty(0), "No result block here.");
    pty(0).exit(0);

    await waitFor(async () => {
      const current = await getExecution(execution.id);
      return current?.repairAttempted ? current : undefined;
    });

    await waitFor(async () =>
      workerStarts.length >= 2 ? true : undefined,
    );

    expect(workerStarts[1].input.agent).toMatchObject({
      canWrite: false,
      canRunCommands: false,
      canCommit: false,
    });
    expect(workerStarts[1].promptOverride).toContain(
      "Do not execute or repeat the original task.",
    );
    expect(workerStarts[1].promptOverride).toContain(
      "Do not inspect the repository",
    );
    expect(workerStarts[1].promptOverride).toContain(
      "No result block here.",
    );

    const finalized = await completeRepair(
      execution.id,
      {
        status: "changes_requested",
        summary: "Found issues to address.",
        commit: null,
      },
    );

    expect(finalized.repairAttempted).toBe(true);
    expect(finalized.status).toBe("completed");
    expect(finalized.resultStatus).toBe("changes_requested");
    expect(ptyInstances).toHaveLength(2);
  });

  it("fails when both successful process attempts produce invalid structured output", async () => {
    const execution = await startAgentExecution(
      runId,
      agentId,
      "Inspect the repository.",
    );

    feedCompletion(pty(0), "No result block here either.");
    pty(0).exit(0);

    await waitFor(async () =>
      ptyInstances.length >= 2 ? true : undefined,
    );

    feedCompletion(pty(1), "Still no result block.");
    pty(1).exit(0);

    const failed = await waitFor(async () => {
      const current = await getExecution(execution.id);

      return current?.status === "failed"
        ? current
        : undefined;
    });

    expect(failed.repairAttempted).toBe(true);
    expect(failed.resultStatus).toBeNull();
    expect(failed.failureReason).toContain(
      "exactly one <orc-result>...</orc-result> block",
    );
    expect(ptyInstances).toHaveLength(2);
  });

  it("fails a nonzero process exit even when the agent emitted valid completed JSON", async () => {
    const execution = await startAgentExecution(
      runId,
      agentId,
      "Inspect the repository.",
    );

    feedResult(pty(0), {
      status: "completed",
      summary: "Claims success despite process failure.",
      commit: null,
    });
    pty(0).exit(2);

    const failed = await waitFor(async () => {
      const current = await getExecution(execution.id);
      return current?.status === "failed" ? current : undefined;
    });

    expect(failed.resultStatus).toBeNull();
    expect(failed.resultPayload).toBeNull();
    expect(failed.repairAttempted).toBe(false);
    expect(failed.failureReason).toBe("Worker exited with code 2.");
    expect(ptyInstances).toHaveLength(1);
  });

  it("fails an unexpected signal even when the agent emitted valid approved JSON", async () => {
    const execution = await startAgentExecution(
      runId,
      agentId,
      "Inspect the repository.",
    );

    feedResult(pty(0), {
      status: "approved",
      summary: "Claims approval despite signal termination.",
      commit: null,
    });
    pty(0).exit(0, 15);

    const failed = await waitFor(async () => {
      const current = await getExecution(execution.id);
      return current?.status === "failed" ? current : undefined;
    });

    expect(failed.resultStatus).toBeNull();
    expect(failed.repairAttempted).toBe(false);
    expect(failed.failureReason).toBe("Worker terminated by signal 15.");
    expect(ptyInstances).toHaveLength(1);
  });

  it("validates only the latest completed assistant message", async () => {
    const execution = await startAgentExecution(
      runId,
      agentId,
      "Inspect the repository.",
    );

    feedResult(pty(0), {
      status: "completed",
      summary: "Earlier valid result.",
      commit: null,
    });
    feedCompletion(
      pty(0),
      "Final completed message without a result block.",
    );
    pty(0).exit(0);

    await waitFor(async () => {
      const current = await getExecution(execution.id);
      return current?.repairAttempted ? current : undefined;
    });

    const finalized = await completeRepair(execution.id);

    expect(finalized.repairAttempted).toBe(true);
    expect(ptyInstances).toHaveLength(2);
  });

  it("repairs a final completion containing multiple result blocks", async () => {
    const execution = await startAgentExecution(
      runId,
      agentId,
      "Inspect the repository.",
    );

    const first = JSON.stringify({
      status: "completed",
      summary: "First result.",
      commit: null,
    });
    const second = JSON.stringify({
      status: "completed",
      summary: "Second result.",
      commit: null,
    });

    feedCompletion(
      pty(0),
      `<orc-result>${first}</orc-result><orc-result>${second}</orc-result>`,
    );
    pty(0).exit(0);

    await waitFor(async () => {
      const current = await getExecution(execution.id);
      return current?.repairAttempted ? current : undefined;
    });

    await completeRepair(execution.id);
    expect(ptyInstances).toHaveLength(2);
  });

  it("repairs a result block followed by trailing non-whitespace content", async () => {
    const execution = await startAgentExecution(
      runId,
      agentId,
      "Inspect the repository.",
    );

    const payload = JSON.stringify({
      status: "completed",
      summary: "Structured result with trailing text.",
      commit: null,
    });

    feedCompletion(
      pty(0),
      `<orc-result>${payload}</orc-result> trailing commentary`,
    );
    pty(0).exit(0);

    await waitFor(async () => {
      const current = await getExecution(execution.id);
      return current?.repairAttempted ? current : undefined;
    });

    await completeRepair(execution.id);
    expect(ptyInstances).toHaveLength(2);
  });

  it("repairs unknown or misspelled structured-result fields", async () => {
    const execution = await startAgentExecution(
      runId,
      agentId,
      "Inspect the repository.",
    );

    feedResult(pty(0), {
      status: "completed",
      summary: "Used a misspelled field.",
      files_changed: ["src/index.ts"],
      commit: null,
    });
    pty(0).exit(0);

    await waitFor(async () => {
      const current = await getExecution(execution.id);
      return current?.repairAttempted ? current : undefined;
    });

    await completeRepair(execution.id);
    expect(ptyInstances).toHaveLength(2);
  });

  it("treats a reported commit from an agent without commit permission as invalid and repairs it", async () => {
    const execution = await startAgentExecution(
      runId,
      agentId,
      "Inspect the repository.",
    );

    feedResult(pty(0), {
      status: "completed",
      summary: "Implemented the change.",
      commit: "abcdef1",
    });
    pty(0).exit(0);

    await waitFor(async () => {
      const current = await getExecution(execution.id);
      return current?.repairAttempted ? current : undefined;
    });

    const finalized = await completeRepair(execution.id);

    expect(finalized.repairAttempted).toBe(true);
    expect(finalized.status).toBe("completed");
    expect(finalized.commitHash).toBeNull();
    expect(ptyInstances).toHaveLength(2);
  });

  it("repairs an unresolvable reported commit for a commit-enabled agent", async () => {
    await setAgentCapabilities({
      canWrite: true,
      canRunCommands: true,
      canCommit: true,
    });

    const execution = await startAgentExecution(
      runId,
      agentId,
      "Implement the requested change.",
    );

    feedResult(pty(0), {
      status: "completed",
      summary: "Reported a commit that does not exist.",
      commit: "deadbee",
    });
    pty(0).exit(0);

    await waitFor(async () => {
      const current = await getExecution(execution.id);
      return current?.repairAttempted ? current : undefined;
    });

    const finalized = await completeRepair(execution.id);

    expect(finalized.repairAttempted).toBe(true);
    expect(finalized.commitHash).toBeNull();
  });

  it("canonicalizes and persists a verified commit hash from the selected repository", async () => {
    const { shortHash, fullHash } = createGitCommit();

    await setAgentCapabilities({
      canWrite: true,
      canRunCommands: true,
      canCommit: true,
    });

    const execution = await startAgentExecution(
      runId,
      agentId,
      "Implement and commit the requested change.",
    );

    feedResult(pty(0), {
      status: "completed",
      summary: "Implemented and committed the change.",
      commit: shortHash,
    });
    pty(0).exit(0);

    const completed = await waitFor(async () => {
      const current = await getExecution(execution.id);
      return current?.status === "completed" ? current : undefined;
    });

    expect(completed.commitHash).toBe(fullHash);
    expect(completed.resultPayload?.commit).toBe(fullHash);
    expect(completed.repairAttempted).toBe(false);
  });

  it("rejects impossible malformed persisted result data instead of exposing arbitrary JSON", async () => {
    const [execution] = await db
      .insert(agentExecutions)
      .values({
        runId,
        agentId,
        agentName: "Persisted Test Agent",
        agentRole: "Tester",
        layer: agentLayer,
        executionOrder: 1,
        harness: "codex",
        model: "gpt-5",
        reasoning: "high",
        status: "completed",
        resultStatus: "completed",
        resultPayload: {
          status: "completed",
          summary: "Malformed stored payload.",
          files_changed: ["src/index.ts"],
        },
      })
      .returning();

    await expect(
      getExecution(execution.id),
    ).rejects.toMatchObject({
      statusCode: 500,
    });
  });
});
