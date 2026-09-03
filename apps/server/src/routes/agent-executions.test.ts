import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type {
  HarnessAdapter,
  PtyExitEvent,
  PtyFactory,
  PtyProcess,
  StartWorkerInput,
} from "../runtime/contracts.js";
import { InMemoryRuntimeSession } from "../runtime/session.js";

class FakePty implements PtyProcess {
  readonly writes: string[] = [];
  readonly resizes: Array<{
    cols: number;
    rows: number;
  }> = [];

  private readonly dataListeners =
    new Set<
      (data: string) => void
    >();

  private readonly exitListeners =
    new Set<
      (
        event: PtyExitEvent,
      ) => void
    >();

  /** Creates a fake PTY with a deterministic PID for lifecycle assertions. */
  constructor(readonly pid: number) {}

  /** Registers a listener for fake PTY output. */
  onData(
    listener: (
      data: string,
    ) => void,
  ) {
    this.dataListeners.add(
      listener,
    );

    return {
      dispose: () =>
        this.dataListeners.delete(
          listener,
        ),
    };
  }

  /** Registers a listener for fake PTY exit events. */
  onExit(
    listener: (
      event: PtyExitEvent,
    ) => void,
  ) {
    this.exitListeners.add(
      listener,
    );

    return {
      dispose: () =>
        this.exitListeners.delete(
          listener,
        ),
    };
  }

  /** Records input written through the PTY runtime contract. */
  write(data: string) {
    this.writes.push(data);
  }

  /** Records PTY resize requests. */
  resize(
    cols: number,
    rows: number,
  ) {
    this.resizes.push({
      cols,
      rows,
    });
  }

  /** Accepts process termination requests for the fake PTY. */
  kill() {}

  /** Emits fake terminal output to registered PTY listeners. */
  data(value: string) {
    for (
      const listener of
      this.dataListeners
    ) {
      listener(value);
    }
  }

  /** Emits a fake PTY process exit event. */
  exit(
    exitCode: number,
    signal?: number,
  ) {
    for (
      const listener of
      this.exitListeners
    ) {
      listener({
        exitCode,
        signal,
      });
    }
  }
}

let activePty:
  | FakePty
  | undefined;

let ptyInstances: FakePty[] =
  [];

vi.mock(
  "../runtime/index.js",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../runtime/index.js")
      >();

    return {
      ...actual,

      /** Starts a real runtime session around a fake external PTY. */
      startWorker: (
        input: StartWorkerInput,
      ) => {
        activePty =
          new FakePty(
            5555 +
              ptyInstances.length,
          );

        ptyInstances.push(
          activePty,
        );

        const adapter: HarnessAdapter =
          {
            harness:
              input.agent.harness,

            /** Builds the fake harness invocation while preserving runtime environment. */
            createInvocation: (
              value,
              _prompt,
              environment,
            ) => ({
              command: "fake",
              args: [],
              cwd: value.projectPath,
              env: environment,
            }),

            /**
             * Emits one non-terminal provider event for the marker line so RuntimeEvent.sequence
             * diverges from terminal chunk sequence during the sequencing regression test.
             */
            translateOutput: (
              data,
            ) =>
              data ===
              "__provider__"
                ? [
                    {
                      type: "provider",
                      provider:
                        "fake",
                      event: {
                        marker: true,
                      },
                    },
                  ]
                : [],
          };

        const factory: PtyFactory =
          {
            /** Returns the current fake PTY instead of launching an external CLI. */
            spawn: () =>
              activePty!,
          };

        return InMemoryRuntimeSession.start(
          input,
          adapter,
          factory,
        );
      },
    };
  },
);

const { buildApp } =
  await import("../app.js");

const { db } =
  await import(
    "../db/client.js"
  );

const {
  agents,
  agentExecutions,
  runs,
  terminalChunks,
} = await import(
  "../db/schema.js"
);

const {
  subscribeToExecutionTerminal,
} = await import(
  "../services/agent-execution-service.js"
);

/** Polls until the supplied condition succeeds or the timeout is reached. */
async function waitFor<T>(
  check: () =>
    | T
    | undefined
    | false
    | Promise<
        | T
        | undefined
        | false
      >,
  timeoutMs = 2000,
): Promise<T> {
  const start = Date.now();

  for (;;) {
    const result =
      await check();

    if (result) {
      return result;
    }

    if (
      Date.now() - start >
      timeoutMs
    ) {
      throw new Error(
        "Timed out waiting for condition",
      );
    }

    await new Promise(
      (resolve) =>
        setTimeout(
          resolve,
          20,
        ),
    );
  }
}

/** Collects JSON-decoded terminal frames received by a WebSocket. */
function collectFrames(
  socket: WebSocket,
): unknown[] {
  const frames: unknown[] = [];

  socket.addEventListener(
    "message",
    (event) => {
      frames.push(
        JSON.parse(
          event.data as string,
        ),
      );
    },
  );

  return frames;
}

/** Resolves when the WebSocket connection opens. */
function waitForOpen(
  socket: WebSocket,
): Promise<void> {
  return new Promise(
    (resolve, reject) => {
      socket.addEventListener(
        "open",
        () => resolve(),
        { once: true },
      );

      socket.addEventListener(
        "error",
        () =>
          reject(
            new Error(
              "socket error",
            ),
          ),
        { once: true },
      );
    },
  );
}

/** Resolves with the WebSocket close code. */
function waitForClose(
  socket: WebSocket,
): Promise<{
  code: number;
}> {
  return new Promise(
    (resolve) => {
      socket.addEventListener(
        "close",
        (event) =>
          resolve({
            code: event.code,
          }),
        { once: true },
      );
    },
  );
}

describe(
  "agent-execution routes",
  () => {
    let app: Awaited<
      ReturnType<
        typeof buildApp
      >
    >;

    let baseUrl: string;
    let projectPath: string;
    let agentId: string;
    let runId: string;

    /** Starts one fake worker execution through the real HTTP API. */
    async function startExecution(): Promise<{
      id: string;
      agentId: string;
      status: string;
    }> {
      const response =
        await fetch(
          `${baseUrl}/api/runs/${runId}/agent-executions`,
          {
            method: "POST",
            headers: {
              "content-type":
                "application/json",
            },
            body: JSON.stringify({
              agentId,
              instruction:
                "Inspect the repository.",
            }),
          },
        );

      expect(
        response.status,
      ).toBe(201);

      return (await response.json()) as {
        id: string;
        agentId: string;
        status: string;
      };
    }

    beforeEach(async () => {
      app =
        await buildApp();

      await app.listen({
        port: 0,
        host: "127.0.0.1",
      });

      const address =
        app.server.address();

      if (
        !address ||
        typeof address ===
          "string"
      ) {
        throw new Error(
          "Expected a bound TCP address",
        );
      }

      baseUrl = `http://127.0.0.1:${address.port}`;

      projectPath =
        fs.mkdtempSync(
          path.join(
            os.tmpdir(),
            "orc-execution-routes-",
          ),
        );

      const [agent] =
        await db
          .insert(agents)
          .values({
            slug: `test-route-agent-${crypto.randomUUID()}`,
            name:
              "Route Test Agent",
            role: "Tester",
            layer:
              900 +
              Math.floor(
                Math.random() *
                  100_000,
              ),
            executionOrder: 1,
            harness: "codex",
            model: "gpt-5",
            reasoning: "high",
            systemPrompt:
              "Test carefully.",
            canWrite: false,
            canRunCommands: true,
            canCommit: false,
          })
          .returning();

      agentId = agent.id;

      const runResponse =
        await fetch(
          `${baseUrl}/api/runs`,
          {
            method: "POST",
            headers: {
              "content-type":
                "application/json",
            },
            body: JSON.stringify({
              projectPath,
            }),
          },
        );

      const run =
        (await runResponse.json()) as {
          id: string;
        };

      runId = run.id;
    });

    afterEach(async () => {
      await app.close();

      fs.rmSync(projectPath, {
        recursive: true,
        force: true,
      });

      activePty = undefined;
      ptyInstances = [];

      const executions =
        await db
          .select({
            id: agentExecutions.id,
          })
          .from(
            agentExecutions,
          )
          .where(
            eq(
              agentExecutions.runId,
              runId,
            ),
          );

      for (
        const execution of
        executions
      ) {
        await db
          .delete(
            terminalChunks,
          )
          .where(
            eq(
              terminalChunks.agentExecutionId,
              execution.id,
            ),
          );
      }

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
        .delete(runs)
        .where(
          eq(runs.id, runId),
        );

      await db
        .delete(agents)
        .where(
          eq(
            agents.id,
            agentId,
          ),
        );
    });

    it(
      "creates a run via POST /api/runs",
      async () => {
        const response =
          await fetch(
            `${baseUrl}/api/runs`,
            {
              method: "POST",
              headers: {
                "content-type":
                  "application/json",
              },
              body: JSON.stringify(
                {
                  projectPath,
                },
              ),
            },
          );

        expect(
          response.status,
        ).toBe(201);

        const body =
          (await response.json()) as {
            id: string;
            projectPath: string;
            status: string;
          };

        expect(
          body,
        ).toMatchObject({
          projectPath,
          status: "pending",
        });

        await db
          .delete(runs)
          .where(
            eq(
              runs.id,
              body.id,
            ),
          );
      },
    );

    it(
      "rejects an empty projectPath with 400",
      async () => {
        const response =
          await fetch(
            `${baseUrl}/api/runs`,
            {
              method: "POST",
              headers: {
                "content-type":
                  "application/json",
              },
              body: JSON.stringify(
                {
                  projectPath:
                    "",
                },
              ),
            },
          );

        expect(
          response.status,
        ).toBe(400);
      },
    );

    it(
      "starts an agent execution via POST /api/runs/:runId/agent-executions",
      async () => {
        const body =
          await startExecution();

        expect(
          body,
        ).toMatchObject({
          agentId,
          status:
            "starting",
        });
      },
    );

    it(
      "gets an agent execution via GET /api/agent-executions/:id",
      async () => {
        const execution =
          await startExecution();

        const response =
          await fetch(
            `${baseUrl}/api/agent-executions/${execution.id}`,
            {
              cache:
                "no-store",
            },
          );

        expect(
          response.status,
        ).toBe(200);

        const body =
          (await response.json()) as {
            id: string;
            agentName: string;
          };

        expect(
          body,
        ).toMatchObject({
          id: execution.id,
          agentName:
            "Route Test Agent",
        });
      },
    );

    it(
      "404s for an unknown agent execution id",
      async () => {
        const response =
          await fetch(
            `${baseUrl}/api/agent-executions/${crypto.randomUUID()}`,
          );

        expect(
          response.status,
        ).toBe(404);
      },
    );

    it(
      "404s when starting an execution for a disabled or missing agent",
      async () => {
        const response =
          await fetch(
            `${baseUrl}/api/runs/${runId}/agent-executions`,
            {
              method: "POST",
              headers: {
                "content-type":
                  "application/json",
              },
              body: JSON.stringify(
                {
                  agentId:
                    crypto.randomUUID(),
                  instruction:
                    "Inspect the repository.",
                },
              ),
            },
          );

        expect(
          response.status,
        ).toBe(404);
      },
    );

    it(
      "404s when starting an execution for a run that does not exist",
      async () => {
        const response =
          await fetch(
            `${baseUrl}/api/runs/${crypto.randomUUID()}/agent-executions`,
            {
              method: "POST",
              headers: {
                "content-type":
                  "application/json",
              },
              body: JSON.stringify(
                {
                  agentId,
                  instruction:
                    "Inspect the repository.",
                },
              ),
            },
          );

        expect(
          response.status,
        ).toBe(404);
      },
    );

    it(
      "400s when starting an execution with a missing instruction",
      async () => {
        const response =
          await fetch(
            `${baseUrl}/api/runs/${runId}/agent-executions`,
            {
              method: "POST",
              headers: {
                "content-type":
                  "application/json",
              },
              body: JSON.stringify(
                {
                  agentId,
                },
              ),
            },
          );

        expect(
          response.status,
        ).toBe(400);
      },
    );

    it(
      "closes with an error frame for an unknown execution id",
      async () => {
        const socket =
          new WebSocket(
            `${baseUrl.replace("http", "ws")}/api/agent-executions/${crypto.randomUUID()}/terminal`,
          );

        const frames =
          collectFrames(
            socket,
          );

        const closePromise =
          waitForClose(
            socket,
          );

        await waitForOpen(
          socket,
        );

        const closed =
          await closePromise;

        expect(
          closed.code,
        ).toBe(1008);

        expect(
          frames,
        ).toEqual([
          {
            type: "error",
            error:
              "execution_not_found",
          },
        ]);
      },
    );

    it(
      "keeps one execution terminal attached across the repair PTY and completes only after finalization",
      async () => {
        const execution =
          await startExecution();

        activePty!.data(
          "first chunk",
        );

        await waitFor(
          async () => {
            const rows =
              await db
                .select()
                .from(
                  terminalChunks,
                )
                .where(
                  eq(
                    terminalChunks.agentExecutionId,
                    execution.id,
                  ),
                );

            return rows.length >=
              1
              ? rows
              : undefined;
          },
        );

        const initialState =
          await waitFor(
            async () => {
              const [row] =
                await db
                  .select()
                  .from(
                    agentExecutions,
                  )
                  .where(
                    eq(
                      agentExecutions.id,
                      execution.id,
                    ),
                  );

              return row
                ?.startedAt
                ? row
                : undefined;
            },
          );

        const initialStartedAt =
          initialState.startedAt!.toISOString();

        const firstPid =
          initialState.pid;

        const socket =
          new WebSocket(
            `${baseUrl.replace("http", "ws")}/api/agent-executions/${execution.id}/terminal`,
          );

        const frames =
          collectFrames(
            socket,
          );

        await waitForOpen(
          socket,
        );

        await waitFor(() =>
          frames.length >= 1
            ? true
            : undefined,
        );

        expect(
          frames[0],
        ).toEqual({
          type: "chunk",
          sequence: 1,
          data:
            "first chunk",
        });

        activePty!.data(
          "second chunk",
        );

        await waitFor(() =>
          frames.length >= 2
            ? true
            : undefined,
        );

        expect(
          frames[1],
        ).toEqual({
          type: "chunk",
          sequence: 2,
          data:
            "second chunk",
        });

        activePty!.exit(0);

        await waitFor(() =>
          ptyInstances.length >=
          2
            ? true
            : undefined,
        );

        expect(
          frames.some(
            (frame) =>
              (
                frame as {
                  type?: string;
                }
              ).type ===
              "complete",
          ),
        ).toBe(false);

        const repairPty =
          ptyInstances[1];

        expect(
          repairPty.pid,
        ).not.toBe(
          firstPid,
        );

        repairPty.data(
          "repair chunk",
        );

        await waitFor(() =>
          frames.length >= 3
            ? true
            : undefined,
        );

        expect(
          frames[2],
        ).toEqual({
          type: "chunk",
          sequence: 3,
          data:
            "repair chunk",
        });

        const repairState =
          await waitFor(
            async () => {
              const [row] =
                await db
                  .select()
                  .from(
                    agentExecutions,
                  )
                  .where(
                    eq(
                      agentExecutions.id,
                      execution.id,
                    ),
                  );

              return row?.pid ===
                repairPty.pid
                ? row
                : undefined;
            },
          );

        expect(
          repairState.startedAt?.toISOString(),
        ).toBe(
          initialStartedAt,
        );

        const closePromise =
          waitForClose(
            socket,
          );

        repairPty.exit(1);

        const closed =
          await closePromise;

        expect(
          closed.code,
        ).toBe(1000);

        expect(
          frames.at(-1),
        ).toEqual({
          type:
            "complete",
          exitCode: 1,
          status: "failed",
        });

        expect(
          frames.filter(
            (frame) =>
              (
                frame as {
                  type?: string;
                }
              ).type ===
              "chunk",
          ),
        ).toHaveLength(3);

        await waitFor(
          () => {
            const unsubscribe =
              subscribeToExecutionTerminal(
                execution.id,
                () => {},
              );

            if (
              !unsubscribe
            ) {
              return true;
            }

            unsubscribe();

            return undefined;
          },
        );
      },
    );

    it(
      "uses terminal chunk sequence for mixed runtime events and resumes from afterSequence without duplication",
      async () => {
        const execution =
          await startExecution();

        activePty!.data(
          "__provider__\n",
        );

        await waitFor(
          async () => {
            const rows =
              await db
                .select()
                .from(
                  terminalChunks,
                )
                .where(
                  eq(
                    terminalChunks.agentExecutionId,
                    execution.id,
                  ),
                );

            return rows.length ===
              1
              ? rows
              : undefined;
          },
        );

        const firstSocket =
          new WebSocket(
            `${baseUrl.replace("http", "ws")}/api/agent-executions/${execution.id}/terminal?afterSequence=1`,
          );

        const firstFrames =
          collectFrames(
            firstSocket,
          );

        await waitForOpen(
          firstSocket,
        );

        const rawAnsi =
          "\u001b[31mred\u001b[0m";

        activePty!.data(
          rawAnsi,
        );

        await waitFor(() =>
          firstFrames.length >=
          1
            ? true
            : undefined,
        );

        expect(
          firstFrames,
        ).toEqual([
          {
            type: "chunk",
            sequence: 2,
            data: rawAnsi,
          },
        ]);

        const firstClose =
          waitForClose(
            firstSocket,
          );

        firstSocket.close(
          1000,
          "test-reconnect",
        );

        await firstClose;

        activePty!.data(
          "third chunk",
        );

        await waitFor(
          async () => {
            const rows =
              await db
                .select()
                .from(
                  terminalChunks,
                )
                .where(
                  eq(
                    terminalChunks.agentExecutionId,
                    execution.id,
                  ),
                );

            return rows.length ===
              3
              ? rows
              : undefined;
          },
        );

        const secondSocket =
          new WebSocket(
            `${baseUrl.replace("http", "ws")}/api/agent-executions/${execution.id}/terminal?afterSequence=2`,
          );

        const secondFrames =
          collectFrames(
            secondSocket,
          );

        await waitForOpen(
          secondSocket,
        );

        await waitFor(() =>
          secondFrames.length >=
          1
            ? true
            : undefined,
        );

        expect(
          secondFrames,
        ).toEqual([
          {
            type: "chunk",
            sequence: 3,
            data:
              "third chunk",
          },
        ]);

        const secondClose =
          waitForClose(
            secondSocket,
          );

        secondSocket.close(
          1000,
          "test-complete",
        );

        await secondClose;

        activePty!.exit(1);

        await waitFor(() =>
          ptyInstances.length >=
          2
            ? true
            : undefined,
        );

        ptyInstances[1].exit(
          1,
        );

        await waitFor(
          async () => {
            const [row] =
              await db
                .select()
                .from(
                  agentExecutions,
                )
                .where(
                  eq(
                    agentExecutions.id,
                    execution.id,
                  ),
                );

            return row?.status ===
              "failed"
              ? true
              : undefined;
          },
        );
      },
    );

    it(
      "forwards validated resize frames to the active PTY",
      async () => {
        const execution =
          await startExecution();

        const socket =
          new WebSocket(
            `${baseUrl.replace("http", "ws")}/api/agent-executions/${execution.id}/terminal`,
          );

        await waitForOpen(
          socket,
        );

        socket.send(
          JSON.stringify({
            type: "resize",
            cols: 100,
            rows: 40,
          }),
        );

        await waitFor(() =>
          activePty!.resizes
            .length >= 1
            ? true
            : undefined,
        );

        expect(
          activePty!.resizes.at(
            -1,
          ),
        ).toEqual({
          cols: 100,
          rows: 40,
        });

        const closePromise =
          waitForClose(
            socket,
          );

        socket.close(
          1000,
          "test-complete",
        );

        await closePromise;

        activePty!.exit(1);

        await waitFor(() =>
          ptyInstances.length >=
          2
            ? true
            : undefined,
        );

        ptyInstances[1].exit(
          1,
        );
      },
    );

    it(
      "rejects unsupported client terminal frames",
      async () => {
        const execution =
          await startExecution();

        const socket =
          new WebSocket(
            `${baseUrl.replace("http", "ws")}/api/agent-executions/${execution.id}/terminal`,
          );

        const frames =
          collectFrames(
            socket,
          );

        const closePromise =
          waitForClose(
            socket,
          );

        await waitForOpen(
          socket,
        );

        socket.send(
          JSON.stringify({
            type: "input",
            data: "ls\n",
          }),
        );

        const closed =
          await closePromise;

        expect(
          closed.code,
        ).toBe(1008);

        expect(
          frames,
        ).toEqual([
          {
            type: "error",
            error:
              "invalid_terminal_frame",
          },
        ]);

        activePty!.exit(1);

        await waitFor(() =>
          ptyInstances.length >=
          2
            ? true
            : undefined,
        );

        ptyInstances[1].exit(
          1,
        );
      },
    );

    it(
      "replays history and immediately completes for an execution that already finished",
      async () => {
        const execution =
          await startExecution();

        ptyInstances[0].data(
          "output before exit",
        );

        ptyInstances[0].exit(
          1,
        );

        await waitFor(() =>
          ptyInstances.length >=
          2
            ? true
            : undefined,
        );

        ptyInstances[1].data(
          "repair attempt output",
        );

        ptyInstances[1].exit(
          1,
        );

        await waitFor(
          async () => {
            const [row] =
              await db
                .select()
                .from(
                  agentExecutions,
                )
                .where(
                  eq(
                    agentExecutions.id,
                    execution.id,
                  ),
                );

            return row?.status ===
              "failed"
              ? true
              : undefined;
          },
        );

        const socket =
          new WebSocket(
            `${baseUrl.replace("http", "ws")}/api/agent-executions/${execution.id}/terminal`,
          );

        const frames =
          collectFrames(
            socket,
          );

        const closePromise =
          waitForClose(
            socket,
          );

        await waitForOpen(
          socket,
        );

        const closed =
          await closePromise;

        expect(
          closed.code,
        ).toBe(1000);

        expect(
          frames,
        ).toEqual([
          {
            type: "chunk",
            sequence: 1,
            data:
              "output before exit",
          },
          {
            type: "chunk",
            sequence: 2,
            data:
              "repair attempt output",
          },
          {
            type:
              "complete",
            exitCode: 1,
            status: "failed",
          },
        ]);
      },
    );
  },
);
