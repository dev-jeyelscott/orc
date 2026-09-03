import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HarnessAdapter, PtyExitEvent, PtyFactory, PtyProcess, StartWorkerInput } from "../runtime/contracts.js";
import { InMemoryRuntimeSession } from "../runtime/session.js";

// Exercises the real HTTP + WebSocket server against Postgres. See vitest.config.ts, which loads
// DATABASE_URL from .env the same way `db:migrate` does; requires a running/migrated Postgres.
class FakePty implements PtyProcess {
  pid = 5555;
  private readonly dataListeners = new Set<(data: string) => void>();
  private readonly exitListeners = new Set<(event: PtyExitEvent) => void>();

  onData(listener: (data: string) => void) {
    this.dataListeners.add(listener);
    return { dispose: () => this.dataListeners.delete(listener) };
  }
  onExit(listener: (event: PtyExitEvent) => void) {
    this.exitListeners.add(listener);
    return { dispose: () => this.exitListeners.delete(listener) };
  }
  kill() {}
  data(value: string) {
    for (const listener of this.dataListeners) listener(value);
  }
  exit(exitCode: number, signal?: number) {
    for (const listener of this.exitListeners) listener({ exitCode, signal });
  }
}

let activePty: FakePty | undefined;
// Tracks every PTY spawned via startWorker() in order. The one-repair-attempt flow (see
// agent-execution-service.ts) triggers a second startWorker() call reusing the same execution
// row when the fake harness below never emits a structured <orc-result> block, so tests that
// need to drive a repair attempt to completion use this instead of the single `activePty` ref.
let ptyInstances: FakePty[] = [];

vi.mock("../runtime/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../runtime/index.js")>();
  return {
    ...actual,
    startWorker: (input: StartWorkerInput) => {
      activePty = new FakePty();
      ptyInstances.push(activePty);
      const adapter: HarnessAdapter = {
        harness: input.agent.harness,
        createInvocation: (value) => ({ command: "fake", args: [], cwd: value.projectPath }),
        translateOutput: () => [],
      };
      const factory: PtyFactory = { spawn: () => activePty! };
      return InMemoryRuntimeSession.start(input, adapter, factory);
    },
  };
});

const { buildApp } = await import("../app.js");
const { db } = await import("../db/client.js");
const { agents, agentExecutions, runs, terminalChunks } = await import("../db/schema.js");

async function waitFor<T>(check: () => T | undefined | false | Promise<T | undefined | false>, timeoutMs = 2000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const result = await check();
    if (result) return result;
    if (Date.now() - start > timeoutMs) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function collectFrames(socket: WebSocket): unknown[] {
  const frames: unknown[] = [];
  socket.addEventListener("message", (event) => {
    frames.push(JSON.parse(event.data as string));
  });
  return frames;
}

function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error("socket error")), { once: true });
  });
}

function waitForClose(socket: WebSocket): Promise<{ code: number }> {
  return new Promise((resolve) => {
    socket.addEventListener("close", (event) => resolve({ code: event.code }), { once: true });
  });
}

describe("agent-execution routes", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let baseUrl: string;
  let projectPath: string;
  let agentId: string;
  let runId: string;

  beforeEach(async () => {
    app = await buildApp();
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("Expected a bound TCP address");
    baseUrl = `http://127.0.0.1:${address.port}`;

    projectPath = fs.mkdtempSync(path.join(os.tmpdir(), "orc-execution-routes-"));
    const [agent] = await db
      .insert(agents)
      .values({
        slug: `test-route-agent-${crypto.randomUUID()}`,
        name: "Route Test Agent",
        role: "Tester",
        layer: 900 + Math.floor(Math.random() * 100_000),
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

    const runResponse = await fetch(`${baseUrl}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectPath }),
    });
    const run = (await runResponse.json()) as { id: string };
    runId = run.id;
  });

  afterEach(async () => {
    await app.close();
    fs.rmSync(projectPath, { recursive: true, force: true });
    activePty = undefined;
    ptyInstances = [];
    const executions = await db.select({ id: agentExecutions.id }).from(agentExecutions).where(eq(agentExecutions.runId, runId));
    for (const execution of executions) {
      await db.delete(terminalChunks).where(eq(terminalChunks.agentExecutionId, execution.id));
    }
    await db.delete(agentExecutions).where(eq(agentExecutions.runId, runId));
    await db.delete(runs).where(eq(runs.id, runId));
    await db.delete(agents).where(eq(agents.id, agentId));
  });

  it("creates a run via POST /api/runs", async () => {
    const response = await fetch(`${baseUrl}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectPath }),
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { id: string; projectPath: string; status: string };
    expect(body).toMatchObject({ projectPath, status: "pending" });
    await db.delete(runs).where(eq(runs.id, body.id));
  });

  it("rejects an empty projectPath with 400", async () => {
    const response = await fetch(`${baseUrl}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectPath: "" }),
    });
    expect(response.status).toBe(400);
  });

  it("starts an agent execution via POST /api/runs/:runId/agent-executions", async () => {
    const response = await fetch(`${baseUrl}/api/runs/${runId}/agent-executions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentId, instruction: "Inspect the repository." }),
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { id: string; agentId: string; status: string };
    expect(body).toMatchObject({ agentId, status: "starting" });
  });

  it("gets an agent execution via GET /api/agent-executions/:id", async () => {
    const startResponse = await fetch(`${baseUrl}/api/runs/${runId}/agent-executions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentId, instruction: "Inspect the repository." }),
    });
    const execution = (await startResponse.json()) as { id: string };

    const response = await fetch(`${baseUrl}/api/agent-executions/${execution.id}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { id: string; agentName: string };
    expect(body).toMatchObject({ id: execution.id, agentName: "Route Test Agent" });
  });

  it("404s for an unknown agent execution id", async () => {
    const response = await fetch(`${baseUrl}/api/agent-executions/${crypto.randomUUID()}`);
    expect(response.status).toBe(404);
  });

  it("404s when starting an execution for a disabled/missing agent", async () => {
    const response = await fetch(`${baseUrl}/api/runs/${runId}/agent-executions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentId: crypto.randomUUID(), instruction: "Inspect the repository." }),
    });
    expect(response.status).toBe(404);
  });

  it("404s when starting an execution for a run that does not exist", async () => {
    const response = await fetch(`${baseUrl}/api/runs/${crypto.randomUUID()}/agent-executions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentId, instruction: "Inspect the repository." }),
    });
    expect(response.status).toBe(404);
  });

  it("400s when starting an execution with a missing instruction", async () => {
    const response = await fetch(`${baseUrl}/api/runs/${runId}/agent-executions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentId }),
    });
    expect(response.status).toBe(400);
  });

  it("closes with an error frame for an unknown execution id", async () => {
    const socket = new WebSocket(`${baseUrl.replace("http", "ws")}/api/agent-executions/${crypto.randomUUID()}/terminal`);
    const frames = collectFrames(socket);
    await waitForOpen(socket);
    const closed = await waitForClose(socket);
    expect(closed.code).toBe(1008);
    expect(frames).toEqual([{ type: "error", error: "execution_not_found" }]);
  });

  it("replays persisted chunks, streams live output without duplication, then completes", async () => {
    const startResponse = await fetch(`${baseUrl}/api/runs/${runId}/agent-executions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentId, instruction: "Inspect the repository." }),
    });
    const execution = (await startResponse.json()) as { id: string };

    activePty!.data("first chunk");
    await waitFor(async () => {
      const rows = await db.select().from(terminalChunks).where(eq(terminalChunks.agentExecutionId, execution.id));
      return rows.length >= 1 || undefined;
    });

    const socket = new WebSocket(`${baseUrl.replace("http", "ws")}/api/agent-executions/${execution.id}/terminal`);
    const frames = collectFrames(socket);
    await waitForOpen(socket);

    await waitFor(() => (frames.length >= 1 ? true : undefined));
    expect(frames).toEqual([{ type: "chunk", sequence: 1, data: "first chunk" }]);

    activePty!.data("second chunk (live)");
    await waitFor(() => (frames.length >= 2 ? true : undefined));
    expect(frames[1]).toEqual({ type: "chunk", sequence: 2, data: "second chunk (live)" });

    activePty!.exit(0);
    const closed = await waitForClose(socket);
    expect(closed.code).toBe(1000);
    expect(frames.at(-1)).toEqual({ type: "complete", exitCode: 0, status: "completed" });

    // No duplicate delivery: exactly one chunk frame per emitted output event.
    expect(frames.filter((frame) => (frame as { type: string }).type === "chunk")).toHaveLength(2);
  });

  it("replays history and immediately completes for an execution that already finished", async () => {
    const startResponse = await fetch(`${baseUrl}/api/runs/${runId}/agent-executions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentId, instruction: "Inspect the repository." }),
    });
    const execution = (await startResponse.json()) as { id: string };

    // The fake harness never emits a structured <orc-result> block, so a non-zero exit here
    // triggers the one-repair-attempt flow (see agent-execution-service.ts): a second
    // startWorker() call reusing this same execution row. Drive both attempts to completion so
    // the execution is fully finalized as "failed" before connecting, matching this test's
    // "already finished" intent.
    ptyInstances[0].data("output before exit");
    ptyInstances[0].exit(1);
    await waitFor(async () => (ptyInstances.length >= 2 ? true : undefined));

    ptyInstances[1].data("repair attempt output");
    ptyInstances[1].exit(1);
    await waitFor(async () => {
      const [row] = await db.select().from(agentExecutions).where(eq(agentExecutions.id, execution.id));
      return row?.status === "failed" || undefined;
    });

    const socket = new WebSocket(`${baseUrl.replace("http", "ws")}/api/agent-executions/${execution.id}/terminal`);
    const frames = collectFrames(socket);
    await waitForOpen(socket);
    const closed = await waitForClose(socket);

    expect(closed.code).toBe(1000);
    expect(frames).toEqual([
      { type: "chunk", sequence: 1, data: "output before exit" },
      { type: "chunk", sequence: 2, data: "repair attempt output" },
      { type: "complete", exitCode: 1, status: "failed" },
    ]);
  });
});
