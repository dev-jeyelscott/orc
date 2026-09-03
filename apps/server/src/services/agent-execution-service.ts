import { and, asc, eq, gt } from "drizzle-orm";
import fs from "node:fs/promises";

import {
  agentResultSchema,
  type AgentExecution,
  type AgentResult,
  type AgentResultStatus,
  type Run,
  type TerminalChunkFrame,
  type TerminalCompleteFrame,
} from "@orc/shared";

import { db } from "../db/client.js";
import {
  agentExecutions,
  agents,
  runs,
  terminalChunks,
} from "../db/schema.js";
import {
  composeRepairInstruction,
  getHarnessAdapter,
  RESULT_BLOCK_END,
  RESULT_BLOCK_START,
  startWorker,
  type RuntimeSession,
  type WorkerConfiguration,
} from "../runtime/index.js";

export class AgentExecutionServiceError extends Error {
  /** Creates a service error carrying the HTTP status expected by route handlers. */
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}

export type SnapshotAgent = WorkerConfiguration & {
  id: string;
  name: string;
  role: string;
  layer: number;
  executionOrder: number;
};

export type ExecutionFinalization = {
  executionId: string;
  status: "completed" | "failed" | "blocked" | "cancelled";
  resultStatus: AgentResultStatus | null;
  failureReason: string | null;
  result: AgentResult | null;
};

type ExecutionTerminalFrame =
  | TerminalChunkFrame
  | TerminalCompleteFrame;

type LiveExecutionState = {
  session: RuntimeSession;
  finalFrame: TerminalCompleteFrame | null;
  subscribers: Set<
    (frame: ExecutionTerminalFrame) => void
  >;
};

const liveExecutions = new Map<string, LiveExecutionState>();
const cancellationRequests = new Set<string>();
const processSamples = new Map<
  number,
  { ticks: number; at: number }
>();

/** Serializes a run database row into the shared API contract. */
function serializeRun(row: typeof runs.$inferSelect): Run {
  return {
    ...row,
    taskId: row.taskId ?? null,
    currentAgentId: row.currentAgentId ?? null,
    executionCount: row.executionCount ?? 0,
    terminalReason: row.terminalReason ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Serializes an execution database row into the shared API contract. */
function serializeExecution(
  row: typeof agentExecutions.$inferSelect,
): AgentExecution {
  return {
    ...row,
    startedAt: row.startedAt
      ? row.startedAt.toISOString()
      : null,
    completedAt: row.completedAt
      ? row.completedAt.toISOString()
      : null,
    tokenUsage:
      (row.tokenUsage as Record<string, unknown> | null) ??
      null,
    contextUsage:
      (row.contextUsage as Record<string, unknown> | null) ??
      null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Converts known Postgres constraint errors into service-level failures. */
function translateDatabaseError(error: unknown): never {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error
  ) {
    const code = (error as { code?: string }).code;

    if (code === "23503") {
      throw new AgentExecutionServiceError(
        "The referenced run or agent does not exist",
        400,
      );
    }

    if (code === "23514") {
      throw new AgentExecutionServiceError(
        "The run or execution data is invalid",
        400,
      );
    }
  }

  throw error;
}

/** Publishes an execution-scoped terminal frame without exposing runtime-event sequencing. */
function publishTerminalFrame(
  state: LiveExecutionState,
  frame: ExecutionTerminalFrame,
): void {
  if (frame.type === "complete") {
    state.finalFrame = frame;
  }

  for (const listener of [...state.subscribers]) {
    try {
      listener(frame);
    } catch (error) {
      console.error(
        "Failed to deliver live terminal frame:",
        error,
      );
    }
  }
}

/** Creates a minimal run row used by the runtime integration endpoints. */
export async function createRun(projectPath: string): Promise<Run> {
  try {
    const [run] = await db
      .insert(runs)
      .values({ projectPath })
      .returning();

    return serializeRun(run);
  } catch (error) {
    return translateDatabaseError(error);
  }
}

/** Reads live Linux process metrics when the execution still owns a running PID. */
export async function getLiveProcessMetrics(
  id: string,
): Promise<{
  cpuPercent: number | null;
  memoryBytes: number | null;
}> {
  const execution = await getExecution(id);

  if (
    !execution?.pid ||
    !["starting", "running"].includes(execution.status) ||
    process.platform !== "linux"
  ) {
    return {
      cpuPercent: null,
      memoryBytes: null,
    };
  }

  try {
    const [stat, status] = await Promise.all([
      fs.readFile(`/proc/${execution.pid}/stat`, "utf8"),
      fs.readFile(`/proc/${execution.pid}/status`, "utf8"),
    ]);

    const fields = stat.trim().split(" ");
    const ticks =
      Number(fields[13]) + Number(fields[14]);
    const now = Date.now();
    const previous = processSamples.get(execution.pid);

    processSamples.set(execution.pid, {
      ticks,
      at: now,
    });

    const rss = /VmRSS:\s+(\d+)\s+kB/.exec(status)?.[1];

    const cpuPercent =
      previous && now > previous.at
        ? Math.max(
            0,
            ((ticks - previous.ticks) / 100 /
              ((now - previous.at) / 1000)) *
              100,
          )
        : null;

    return {
      cpuPercent,
      memoryBytes: rss ? Number(rss) * 1024 : null,
    };
  } catch {
    return {
      cpuPercent: null,
      memoryBytes: null,
    };
  }
}

/** Starts an execution from the current persisted agent configuration. */
export async function startAgentExecution(
  runId: string,
  agentId: string,
  instruction: string,
): Promise<AgentExecution> {
  const [run] = await db
    .select()
    .from(runs)
    .where(eq(runs.id, runId));

  if (!run) {
    throw new AgentExecutionServiceError(
      "The run does not exist",
      404,
    );
  }

  const [agent] = await db
    .select()
    .from(agents)
    .where(eq(agents.id, agentId));

  if (!agent || !agent.enabled) {
    throw new AgentExecutionServiceError(
      "The agent does not exist or is disabled",
      404,
    );
  }

  return startSnapshotAgentExecution(
    run,
    {
      id: agent.id,
      name: agent.name,
      role: agent.role,
      layer: agent.layer,
      executionOrder: agent.executionOrder,
      harness: agent.harness,
      model: agent.model,
      reasoning: agent.reasoning,
      systemPrompt: agent.systemPrompt,
      canWrite: agent.canWrite,
      canRunCommands: agent.canRunCommands,
      canCommit: agent.canCommit,
    },
    instruction,
  );
}

/** Starts one execution from a run-owned agent configuration snapshot. */
export async function startSnapshotAgentExecution(
  run: typeof runs.$inferSelect,
  agent: SnapshotAgent,
  instruction: string,
  onFinalized?: (
    finalization: ExecutionFinalization,
  ) => Promise<void> | void,
): Promise<AgentExecution> {
  let execution: typeof agentExecutions.$inferSelect;

  try {
    [execution] = await db
      .insert(agentExecutions)
      .values({
        runId: run.id,
        agentId: agent.id,
        agentName: agent.name,
        agentRole: agent.role,
        layer: agent.layer,
        executionOrder: agent.executionOrder,
        harness: agent.harness,
        model: agent.model,
        reasoning: agent.reasoning,
        status: "starting",
      })
      .returning();
  } catch (error) {
    return translateDatabaseError(error);
  }

  const workerConfig: WorkerConfiguration = agent;

  const session = startWorker({
    projectPath: run.projectPath,
    agent: workerConfig,
    instruction,
  });

  const liveState: LiveExecutionState = {
    session,
    finalFrame: null,
    subscribers: new Set(),
  };

  liveExecutions.set(execution.id, liveState);

  bridgeSessionToDatabase({
    executionId: execution.id,
    projectPath: run.projectPath,
    agent: workerConfig,
    originalInstruction: instruction,
    session,
    liveState,
    onFinalized,
  });

  return serializeExecution(execution);
}

type ResultOutcome =
  | { ok: true; result: AgentResult }
  | {
      ok: false;
      reasons: string[];
      excerpt: string;
    };

/** Extracts and validates the structured completion payload from provider-authored text. */
function extractAndValidateResult(
  messageText: string,
  canCommit: boolean,
): ResultOutcome {
  const startIndex =
    messageText.lastIndexOf(RESULT_BLOCK_START);

  const endIndex = messageText.indexOf(
    RESULT_BLOCK_END,
    startIndex + RESULT_BLOCK_START.length,
  );

  if (startIndex === -1 || endIndex === -1) {
    return {
      ok: false,
      reasons: [
        `The final message did not contain a ${RESULT_BLOCK_START}...${RESULT_BLOCK_END} block.`,
      ],
      excerpt: messageText.slice(-2000),
    };
  }

  const raw = messageText
    .slice(
      startIndex + RESULT_BLOCK_START.length,
      endIndex,
    )
    .trim();

  let parsedJson: unknown;

  try {
    parsedJson = JSON.parse(raw);
  } catch (error) {
    return {
      ok: false,
      reasons: [
        `The ${RESULT_BLOCK_START} block was not valid JSON: ${
          error instanceof Error
            ? error.message
            : String(error)
        }`,
      ],
      excerpt: raw,
    };
  }

  const parsed = agentResultSchema.safeParse(parsedJson);

  if (!parsed.success) {
    return {
      ok: false,
      reasons: parsed.error.issues.map(
        (issue) =>
          `${issue.path.join(".") || "(root)"}: ${issue.message}`,
      ),
      excerpt: raw,
    };
  }

  if (parsed.data.commit !== null && !canCommit) {
    return {
      ok: false,
      reasons: [
        "The result reported a `commit` hash, but this agent is not permitted to commit (canCommit is false).",
      ],
      excerpt: raw,
    };
  }

  return {
    ok: true,
    result: parsed.data,
  };
}

/** Maps the structured worker result onto the execution lifecycle status. */
function executionStatusForResult(
  resultStatus: AgentResultStatus,
): "completed" | "blocked" | "failed" {
  if (resultStatus === "failed") {
    return "failed";
  }

  if (resultStatus === "blocked") {
    return "blocked";
  }

  return "completed";
}

type BridgeParams = {
  executionId: string;
  projectPath: string;
  agent: WorkerConfiguration;
  originalInstruction: string;
  session: RuntimeSession;
  liveState: LiveExecutionState;
  onFinalized?: (
    finalization: ExecutionFinalization,
  ) => Promise<void> | void;
};

/**
 * Bridges one logical agent execution to Postgres and the execution-scoped terminal stream.
 * Terminal sequence numbers are allocated here and remain independent from RuntimeEvent.sequence.
 */
function bridgeSessionToDatabase(
  params: BridgeParams,
): void {
  const {
    executionId,
    projectPath,
    agent,
    originalInstruction,
    liveState,
    onFinalized,
  } = params;

  const adapter = getHarnessAdapter(agent.harness);

  let writeQueue: Promise<void> = Promise.resolve();
  let terminalSequence = 0;
  let finalizationSent = false;

  /**
   * Queues persistence work in strict execution order while allowing callers to observe
   * whether their specific database write succeeded.
   */
  const enqueue = (
    task: () => Promise<unknown>,
  ): Promise<boolean> => {
    const next = writeQueue.then(async () => {
      try {
        await task();
        return true;
      } catch (error) {
        console.error(
          `Failed to persist agent execution ${executionId}:`,
          error,
        );
        return false;
      }
    });

    writeQueue = next.then(() => undefined);

    return next;
  };

  /**
   * Removes finalized live execution state only after the current persistence queue settles.
   */
  const scheduleCleanup = (): void => {
    const queueAtFinalization = writeQueue;

    void queueAtFinalization.finally(() => {
      if (liveExecutions.get(executionId) === liveState) {
        liveExecutions.delete(executionId);
      }

      cancellationRequests.delete(executionId);

      const pid = liveState.session.metadata.pid;

      if (pid) {
        processSamples.delete(pid);
      }
    });
  };

  /**
   * Emits the execution-level completion frame only after final execution state is persisted.
   */
  const notifyFinalized = async (
    finalization: ExecutionFinalization,
    exitCode: number | null,
  ): Promise<void> => {
    if (finalizationSent) {
      return;
    }

    finalizationSent = true;

    publishTerminalFrame(liveState, {
      type: "complete",
      exitCode,
      status: finalization.status,
    });

    try {
      await onFinalized?.(finalization);
    } catch (error) {
      console.error(
        `Failed to process execution finalization ${executionId}:`,
        error,
      );
    } finally {
      scheduleCleanup();
    }
  };

  /** Queues a normal execution metadata update. */
  const finalize = (
    fields: Partial<typeof agentExecutions.$inferInsert>,
  ): Promise<boolean> =>
    enqueue(() =>
      db
        .update(agentExecutions)
        .set({
          ...fields,
          updatedAt: new Date(),
        })
        .where(eq(agentExecutions.id, executionId)),
    );

  /**
   * Persists fields directly while already executing inside the ordered write queue.
   * Throwing here prevents false terminal completion when authoritative persistence fails.
   */
  async function persistExecutionFields(
    fields: Partial<typeof agentExecutions.$inferInsert>,
  ): Promise<void> {
    await db
      .update(agentExecutions)
      .set({
        ...fields,
        updatedAt: new Date(),
      })
      .where(eq(agentExecutions.id, executionId));
  }

  /** Finalizes one PTY attempt or starts the single structured-result repair attempt. */
  async function finalizeAttempt(
    exitCode: number,
    messageText: string,
    attempt: 1 | 2,
  ): Promise<void> {
    if (cancellationRequests.has(executionId)) {
      const finalization: ExecutionFinalization = {
        executionId,
        status: "cancelled",
        resultStatus: null,
        failureReason: "Cancelled by operator",
        result: null,
      };

      await persistExecutionFields({
        status: "cancelled",
        resultStatus: null,
        failureReason: finalization.failureReason,
        exitCode,
        completedAt: new Date(),
      });

      await notifyFinalized(finalization, exitCode);
      return;
    }

    const outcome = extractAndValidateResult(
      messageText,
      agent.canCommit,
    );

    if (outcome.ok) {
      const { result } = outcome;
      const status = executionStatusForResult(
        result.status,
      );

      const finalization: ExecutionFinalization = {
        executionId,
        status,
        resultStatus: result.status,
        failureReason: null,
        result,
      };

      await persistExecutionFields({
        status,
        resultStatus: result.status,
        resultPayload: result,
        commitHash: agent.canCommit
          ? result.commit
          : null,
        failureReason: null,
        exitCode,
        completedAt: new Date(),
      });

      await notifyFinalized(finalization, exitCode);
      return;
    }

    if (attempt === 1) {
      await persistExecutionFields({
        repairAttempted: true,
      });

      const repairInstruction = composeRepairInstruction(
        originalInstruction,
        outcome.excerpt,
        outcome.reasons,
      );

      const previousPid = liveState.session.metadata.pid;

      if (previousPid) {
        processSamples.delete(previousPid);
      }

      const repairSession = startWorker({
        projectPath,
        agent,
        instruction: repairInstruction,
      });

      liveState.session = repairSession;

      attach(repairSession, 2);
      return;
    }

    const failureReason =
      outcome.reasons[0] ??
      "The repair attempt did not produce a valid structured result.";

    const finalization: ExecutionFinalization = {
      executionId,
      status: "failed",
      resultStatus: null,
      failureReason,
      result: null,
    };

    await persistExecutionFields({
      status: "failed",
      resultStatus: null,
      failureReason,
      exitCode,
      completedAt: new Date(),
    });

    await notifyFinalized(finalization, exitCode);
  }

  /** Attaches one PTY attempt to the shared execution persistence and terminal stream. */
  function attach(
    session: RuntimeSession,
    attempt: 1 | 2,
  ): void {
    let messageText = "";

    if (session.metadata.pid !== null) {
      const now = new Date();

      void enqueue(() =>
        db
          .update(agentExecutions)
          .set({
            status: "running",
            pid: session.metadata.pid,
            ...(attempt === 1
              ? { startedAt: now }
              : {}),
            updatedAt: now,
          })
          .where(eq(agentExecutions.id, executionId)),
      );
    }

    session.subscribe((event) => {
      switch (event.type) {
        case "output": {
          const sequence = ++terminalSequence;
          const frame: TerminalChunkFrame = {
            type: "chunk",
            sequence,
            data: event.data,
          };

          void enqueue(async () => {
            await db.insert(terminalChunks).values({
              agentExecutionId: executionId,
              sequence,
              data: event.data,
            });

            publishTerminalFrame(
              liveState,
              frame,
            );
          });

          break;
        }

        case "usage": {
          const { usage } = event;

          void enqueue(() =>
            db
              .update(agentExecutions)
              .set({
                tokenUsage: usage,
                updatedAt: new Date(),
              })
              .where(
                eq(
                  agentExecutions.id,
                  executionId,
                ),
              ),
          );

          break;
        }

        case "provider": {
          const text =
            adapter.extractMessageText?.(
              event.event,
            );

          if (text) {
            messageText += text;
          }

          break;
        }

        case "exit": {
          void enqueue(() =>
            finalizeAttempt(
              event.exitCode,
              messageText,
              attempt,
            ),
          );

          break;
        }

        case "diagnostic": {
          if (
            event.diagnostic.code ===
              "usage_unavailable" ||
            event.diagnostic.code ===
              "unexpected_exit"
          ) {
            break;
          }

          const failureReason =
            event.diagnostic.message;

          void finalize({
            status: "failed",
            resultStatus: null,
            failureReason,
            completedAt: new Date(),
          }).then(async (persisted) => {
            if (!persisted) {
              return;
            }

            await notifyFinalized(
              {
                executionId,
                status: "failed",
                resultStatus: null,
                failureReason,
                result: null,
              },
              null,
            );
          });

          break;
        }
      }
    });
  }

  attach(params.session, 1);
}

/** Requests cancellation of the currently active PTY for an execution. */
export async function cancelLiveExecution(
  id: string,
): Promise<boolean> {
  const state = liveExecutions.get(id);

  if (
    !state ||
    state.finalFrame ||
    !["starting", "running", "stopping"].includes(
      state.session.metadata.state,
    )
  ) {
    return false;
  }

  cancellationRequests.add(id);
  state.session.stop();

  return true;
}

/** Resizes the PTY currently attached to a live execution. */
export function resizeLiveExecution(
  id: string,
  cols: number,
  rows: number,
): boolean {
  const state = liveExecutions.get(id);

  if (!state || state.finalFrame) {
    return false;
  }

  return state.session.resize(cols, rows);
}

/**
 * Subscribes to durable live terminal frames for one execution.
 * Historical terminal chunks remain PostgreSQL-backed and are not replayed here.
 */
export function subscribeToExecutionTerminal(
  id: string,
  listener: (
    frame: ExecutionTerminalFrame,
  ) => void,
): (() => void) | undefined {
  const state = liveExecutions.get(id);

  if (!state) {
    return undefined;
  }

  state.subscribers.add(listener);

  if (state.finalFrame) {
    try {
      listener(state.finalFrame);
    } catch (error) {
      console.error(
        "Failed to deliver final terminal frame:",
        error,
      );
    }
  }

  return () => {
    state.subscribers.delete(listener);
  };
}

/** Returns the authoritative persisted execution record. */
export async function getExecution(
  id: string,
): Promise<AgentExecution | null> {
  const [row] = await db
    .select()
    .from(agentExecutions)
    .where(eq(agentExecutions.id, id));

  return row ? serializeExecution(row) : null;
}

export type TerminalChunkRow = {
  sequence: number;
  data: string;
};

/** Returns persisted terminal chunks strictly newer than the supplied terminal cursor. */
export async function listTerminalChunks(
  id: string,
  afterSequence = 0,
): Promise<TerminalChunkRow[]> {
  const cursor =
    Number.isInteger(afterSequence) &&
    afterSequence >= 0
      ? afterSequence
      : 0;

  return db
    .select({
      sequence: terminalChunks.sequence,
      data: terminalChunks.data,
    })
    .from(terminalChunks)
    .where(
      and(
        eq(
          terminalChunks.agentExecutionId,
          id,
        ),
        gt(terminalChunks.sequence, cursor),
      ),
    )
    .orderBy(asc(terminalChunks.sequence));
}
