import fs from "node:fs";
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
  HarnessAdapter,
  PtyExitEvent,
  PtyFactory,
  PtyProcess,
  StartWorkerInput,
} from "../runtime/contracts.js";

import {
  InMemoryRuntimeSession,
} from "../runtime/session.js";

class FakePty
implements PtyProcess {
  pid =
    4321;

  private readonly dataListeners =
    new Set<
      (
        data:
          string,
      ) => void
    >();

  private readonly exitListeners =
    new Set<
      (
        event:
          PtyExitEvent,
      ) => void
    >();

  /** Registers a fake PTY output listener. */
  onData(
    listener:
      (
        data:
          string,
      ) => void,
  ) {
    this.dataListeners.add(
      listener,
    );

    return {
      dispose:
        () =>
          this.dataListeners.delete(
            listener,
          ),
    };
  }

  /** Registers a fake PTY exit listener. */
  onExit(
    listener:
      (
        event:
          PtyExitEvent,
      ) => void,
  ) {
    this.exitListeners.add(
      listener,
    );

    return {
      dispose:
        () =>
          this.exitListeners.delete(
            listener,
          ),
    };
  }

  /** Accepts input writes required by the PTY contract. */
  write(
    data:
      string,
  ): void {
    void data;
  }

  /** Accepts process termination requests for the fake PTY. */
  kill(): void {}

  /** Emits fake PTY output to registered listeners. */
  data(
    value:
      string,
  ): void {
    for (
      const listener of
      this.dataListeners
    ) {
      listener(
        value,
      );
    }
  }

  /** Emits one fake PTY process exit event. */
  exit(
    exitCode:
      number,
    signal?:
      number,
  ): void {
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

/**
 * Creates a fake provider adapter that exposes JSON text events as completed assistant messages.
 */
function makeFakeAdapter(
  harness:
    StartWorkerInput[
      "agent"
    ][
      "harness"
    ],
): HarnessAdapter {
  return {
    harness,

    /** Builds the fake invocation without launching an external provider process. */
    createInvocation:
      (
        value,
        _prompt,
        environment,
      ) => ({
        command:
          "fake",
        args: [],
        cwd:
          value.projectPath,
        env:
          environment,
      }),

    /** Converts fake JSON PTY lines into normalized provider events. */
    translateOutput:
      (
        data,
      ) => {
        try {
          const event =
            JSON.parse(
              data,
            ) as Record<
              string,
              unknown
            >;

          return [
            {
              type:
                "provider",
              provider:
                "fake",
              event,
            },
          ];
        } catch {
          return [];
        }
      },

    /** Extracts the fake provider's completed assistant message text. */
    extractMessageText:
      (
        event,
      ) =>
        typeof event.text ===
        "string"
          ? event.text
          : undefined,
  };
}

const mockFakeAdapter =
  makeFakeAdapter(
    "codex",
  );

let ptyInstances:
  FakePty[] = [];

/**
 * Returns one previously spawned fake PTY and fails clearly when it is unavailable.
 */
function pty(
  index:
    number,
): FakePty {
  const instance =
    ptyInstances[
      index
    ];

  if (
    !instance
  ) {
    throw new Error(
      `Expected fake PTY ${index}`,
    );
  }

  return instance;
}

/**
 * Emits one structured worker result through the fake provider stream.
 */
function feedResult(
  instance:
    FakePty,
  payload:
    Record<
      string,
      unknown
    >,
): void {
  instance.data(
    `${JSON.stringify({
      text:
        `<orc-result>${JSON.stringify(
          payload,
        )}</orc-result>`,
    })}\n`,
  );
}

/**
 * Creates the immutable Project Document result provenance fixture.
 */
function projectDocumentRef() {
  return {
    source:
      "project_document",
    documentId:
      "00000000-0000-4000-8000-000000000001",
    fileName:
      "requirements.md",
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
      "Acceptance criteria",
  };
}

vi.mock(
  "../runtime/index.js",
  async (
    importOriginal,
  ) => {
    const actual =
      await importOriginal<
        typeof import(
          "../runtime/index.js"
        )
      >();

    return {
      ...actual,

      /** Starts a normal worker through an isolated fake PTY. */
      startWorker:
        (
          input:
            StartWorkerInput,
        ) => {
          const instance =
            new FakePty();

          ptyInstances.push(
            instance,
          );

          const adapter =
            makeFakeAdapter(
              input
                .agent
                .harness,
            );

          const factory:
            PtyFactory = {
            /** Returns the fake process instead of launching a real CLI. */
            spawn:
              () =>
                instance,
          };

          return InMemoryRuntimeSession.start(
            input,
            adapter,
            factory,
          );
        },

      /** Starts the controlled structured-result repair through another isolated fake PTY. */
      startHarnessSession:
        (
          input:
            StartWorkerInput,
          promptOverride:
            string,
        ) => {
          const instance =
            new FakePty();

          ptyInstances.push(
            instance,
          );

          const adapter =
            makeFakeAdapter(
              input
                .agent
                .harness,
            );

          const factory:
            PtyFactory = {
            /** Returns the fake repair process instead of launching a real CLI. */
            spawn:
              () =>
                instance,
          };

          return InMemoryRuntimeSession.start(
            input,
            adapter,
            factory,
            promptOverride,
          );
        },

      /** Keeps result extraction aligned with fake provider events emitted by this test. */
      getHarnessAdapter:
        () =>
          mockFakeAdapter,
    };
  },
);

const {
  db,
} = await import(
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
  createRun,
  getExecution,
  startAgentExecution,
} = await import(
  "./agent-execution-service.js"
);

/**
 * Polls until an asynchronous execution condition becomes available.
 */
async function waitFor<
  T,
>(
  check:
    () =>
      Promise<
        | T
        | undefined
        | false
      >,
  timeoutMs =
    2_000,
): Promise<T> {
  const startedAt =
    Date.now();

  for (;;) {
    const result =
      await check();

    if (
      result
    ) {
      return result;
    }

    if (
      Date.now() -
        startedAt >
      timeoutMs
    ) {
      throw new Error(
        "Timed out waiting for condition",
      );
    }

    await new Promise<void>(
      (
        resolve,
      ) => {
        setTimeout(
          resolve,
          20,
        );
      },
    );
  }
}

describe(
  "agent execution Project Document provenance",
  () => {
    let projectPath:
      string;

    let agentId:
      string;

    let runId:
      string;

    beforeEach(
      async () => {
        ptyInstances =
          [];

        projectPath =
          fs.mkdtempSync(
            path.join(
              os.tmpdir(),
              "orc-project-document-provenance-",
            ),
          );

        const [
          agent,
        ] =
          await db
            .insert(
              agents,
            )
            .values({
              slug:
                `project-document-provenance-${crypto.randomUUID()}`,
              name:
                "Project Document Provenance Worker",
              role:
                "Generic Worker",
              layer:
                900 +
                Math.floor(
                  Math.random() *
                    100_000,
                ),
              executionOrder:
                1,
              harness:
                "codex",
              model:
                "default",
              reasoning:
                "high",
              systemPrompt:
                "Use supplied context carefully.",
              canWrite:
                false,
              canRunCommands:
                true,
              canCommit:
                false,
            })
            .returning();

        agentId =
          agent.id;

        const run =
          await createRun(
            projectPath,
          );

        runId =
          run.id;
      },
    );

    afterEach(
      async () => {
        const executions =
          await db
            .select({
              id:
                agentExecutions.id,
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
          .delete(
            runs,
          )
          .where(
            eq(
              runs.id,
              runId,
            ),
          );

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

        fs.rmSync(
          projectPath,
          {
            recursive:
              true,
            force:
              true,
          },
        );
      },
    );

    it(
      "validates and persists lightweight Project Document provenance through result_payload",
      async () => {
        const provenance =
          projectDocumentRef();

        const execution =
          await startAgentExecution(
            runId,
            agentId,
            "Inspect the supplied requirements.",
          );

        feedResult(
          pty(
            0,
          ),
          {
            status:
              "completed",
            summary:
              "Completed using the supplied requirements.",
            projectDocumentRefs: [
              provenance,
            ],
            commit:
              null,
          },
        );

        pty(
          0,
        ).exit(
          0,
        );

        const completed =
          await waitFor(
            async () => {
              const current =
                await getExecution(
                  execution.id,
                );

              return current
                ?.status ===
                "completed"
                ? current
                : undefined;
            },
          );

        expect(
          completed
            .repairAttempted,
        ).toBe(
          false,
        );

        expect(
          completed
            .resultPayload
            ?.projectDocumentRefs,
        ).toEqual([
          provenance,
        ]);

        const [
          persisted,
        ] =
          await db
            .select({
              resultStatus:
                agentExecutions.resultStatus,
              resultPayload:
                agentExecutions.resultPayload,
            })
            .from(
              agentExecutions,
            )
            .where(
              eq(
                agentExecutions.id,
                execution.id,
              ),
            );

        expect(
          persisted
            ?.resultStatus,
        ).toBe(
          "completed",
        );

        expect(
          persisted
            ?.resultPayload,
        ).toMatchObject({
          projectDocumentRefs: [
            provenance,
          ],
        });
      },
    );

    it(
      "rejects malformed Project Document provenance before persistence and uses the existing repair path",
      async () => {
        const provenance =
          projectDocumentRef();

        const execution =
          await startAgentExecution(
            runId,
            agentId,
            "Inspect the supplied requirements.",
          );

        feedResult(
          pty(
            0,
          ),
          {
            status:
              "completed",
            summary:
              "Attempted to persist copied document content.",
            projectDocumentRefs: [
              {
                ...provenance,
                excerpt:
                  "This field must not pass the structured completion contract.",
              },
            ],
            commit:
              null,
          },
        );

        pty(
          0,
        ).exit(
          0,
        );

        await waitFor(
          async () => {
            const current =
              await getExecution(
                execution.id,
              );

            return current
              ?.repairAttempted
              ? current
              : undefined;
          },
        );

        await waitFor(
          async () =>
            ptyInstances.length >=
            2
              ? true
              : undefined,
        );

        const [
          rejected,
        ] =
          await db
            .select({
              resultStatus:
                agentExecutions.resultStatus,
              resultPayload:
                agentExecutions.resultPayload,
            })
            .from(
              agentExecutions,
            )
            .where(
              eq(
                agentExecutions.id,
                execution.id,
              ),
            );

        expect(
          rejected
            ?.resultStatus,
        ).toBeNull();

        expect(
          rejected
            ?.resultPayload,
        ).toBeNull();

        feedResult(
          pty(
            1,
          ),
          {
            status:
              "completed",
            summary:
              "Corrected the structured result.",
            projectDocumentRefs: [
              provenance,
            ],
            commit:
              null,
          },
        );

        pty(
          1,
        ).exit(
          0,
        );

        const completed =
          await waitFor(
            async () => {
              const current =
                await getExecution(
                  execution.id,
                );

              return current
                ?.status ===
                "completed" &&
                current
                  .resultStatus ===
                  "completed"
                ? current
                : undefined;
            },
          );

        expect(
          completed
            .repairAttempted,
        ).toBe(
          true,
        );

        expect(
          completed
            .resultPayload
            ?.projectDocumentRefs,
        ).toEqual([
          provenance,
        ]);
      },
    );
  },
);
