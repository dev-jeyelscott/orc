import { asc, eq } from "drizzle-orm";

import { agentResultSchema, type AgentExecution, type AgentResult, type AgentResultStatus, type Run } from "@orc/shared";

import { db } from "../db/client.js";
import { agentExecutions, agents, runs, terminalChunks } from "../db/schema.js";
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
  constructor(message: string, readonly statusCode: number) {
    super(message);
  }
}

function serializeRun(row: typeof runs.$inferSelect): Run {
  return { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

function serializeExecution(row: typeof agentExecutions.$inferSelect): AgentExecution {
  return {
    ...row,
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    tokenUsage: (row.tokenUsage as Record<string, unknown> | null) ?? null,
    contextUsage: (row.contextUsage as Record<string, unknown> | null) ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function translateDatabaseError(error: unknown): never {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: string }).code;
    if (code === "23503") throw new AgentExecutionServiceError("The referenced run or agent does not exist", 400);
    if (code === "23514") throw new AgentExecutionServiceError("The run or execution data is invalid", 400);
  }
  throw error;
}

export async function createRun(projectPath: string): Promise<Run> {
  try {
    const [run] = await db.insert(runs).values({ projectPath }).returning();
    return serializeRun(run);
  } catch (error) {
    return translateDatabaseError(error);
  }
}

// Live sessions started by this process, keyed by agent execution id. The WS route attaches to
// these instead of re-invoking startWorker(). Sessions are not removed after exit so a client
// that connects shortly after completion can still read final in-memory metadata; the row in
// Postgres remains authoritative once the process restarts.
const liveSessions = new Map<string, RuntimeSession>();

export async function startAgentExecution(runId: string, agentId: string, instruction: string): Promise<AgentExecution> {
  const [run] = await db.select().from(runs).where(eq(runs.id, runId));
  if (!run) throw new AgentExecutionServiceError("The run does not exist", 404);

  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
  if (!agent || !agent.enabled) throw new AgentExecutionServiceError("The agent does not exist or is disabled", 404);

  let execution: typeof agentExecutions.$inferSelect;
  try {
    [execution] = await db
      .insert(agentExecutions)
      .values({
        runId,
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

  const workerConfig: WorkerConfiguration = {
    harness: agent.harness,
    model: agent.model,
    reasoning: agent.reasoning,
    systemPrompt: agent.systemPrompt,
    canWrite: agent.canWrite,
    canRunCommands: agent.canRunCommands,
    canCommit: agent.canCommit,
  };

  const session = startWorker({ projectPath: run.projectPath, agent: workerConfig, instruction });

  liveSessions.set(execution.id, session);
  bridgeSessionToDatabase({ executionId: execution.id, projectPath: run.projectPath, agent: workerConfig, originalInstruction: instruction, session });

  return serializeExecution(execution);
}

// Structured completion result extraction/validation. Worker agents are one-shot CLI processes
// (see AGENTS.md "Runtime and Harness Rules"), so the final assistant message text is
// accumulated across `provider` RuntimeEvents for the current attempt and scanned for the
// <orc-result>...</orc-result> contract once the process exits.
type ResultOutcome =
  | { ok: true; result: AgentResult }
  | { ok: false; reasons: string[]; excerpt: string };

function extractAndValidateResult(messageText: string, canCommit: boolean): ResultOutcome {
  const startIndex = messageText.lastIndexOf(RESULT_BLOCK_START);
  const endIndex = messageText.indexOf(RESULT_BLOCK_END, startIndex + RESULT_BLOCK_START.length);
  if (startIndex === -1 || endIndex === -1) {
    return {
      ok: false,
      reasons: [`The final message did not contain a ${RESULT_BLOCK_START}...${RESULT_BLOCK_END} block.`],
      excerpt: messageText.slice(-2000),
    };
  }

  const raw = messageText.slice(startIndex + RESULT_BLOCK_START.length, endIndex).trim();

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (error) {
    return {
      ok: false,
      reasons: [`The ${RESULT_BLOCK_START} block was not valid JSON: ${error instanceof Error ? error.message : String(error)}`],
      excerpt: raw,
    };
  }

  const parsed = agentResultSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return {
      ok: false,
      reasons: parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`),
      excerpt: raw,
    };
  }

  if (parsed.data.commit !== null && !canCommit) {
    return {
      ok: false,
      reasons: ["The result reported a `commit` hash, but this agent is not permitted to commit (canCommit is false)."],
      excerpt: raw,
    };
  }

  return { ok: true, result: parsed.data };
}

// Execution-level status reflects whether the process finished with a valid structured result,
// not the nuanced outcome of that result -- `changes_requested` and similar outcomes are workflow
// routing concerns (Phase 7) carried by `resultStatus`, not `agent_executions.status`.
function executionStatusForResult(resultStatus: AgentResultStatus): "completed" | "blocked" | "failed" {
  if (resultStatus === "failed") return "failed";
  if (resultStatus === "blocked") return "blocked";
  return "completed";
}

type BridgeParams = {
  executionId: string;
  projectPath: string;
  agent: WorkerConfiguration;
  originalInstruction: string;
  session: RuntimeSession;
};

// Persistence bridge between a live RuntimeSession and Postgres. Terminal output is written in
// emission order via a simple promise chain (queued per execution) so `terminal_chunks` rows
// stay ordered even though writes happen asynchronously. The same write queue and a
// service-owned terminal sequence counter (independent from each session's own per-process
// sequence numbering) are shared across the initial attempt and the single controlled repair
// attempt so both write into the same `terminal_chunks` history for this execution.
function bridgeSessionToDatabase(params: BridgeParams): void {
  const { executionId, projectPath, agent, originalInstruction } = params;
  const adapter = getHarnessAdapter(agent.harness);

  let writeQueue: Promise<unknown> = Promise.resolve();
  let terminalSequence = 0;

  // Returns the queued task's own settled promise (rather than leaving it fire-and-forget) so
  // callers that need a write to be durable before proceeding -- e.g. persisting
  // repair_attempted before starting the repair worker -- can `await enqueue(...)`.
  const enqueue = (task: () => Promise<unknown>): Promise<void> => {
    const next: Promise<void> = writeQueue.then(task).then(
      () => undefined,
      (error: unknown) => {
        // A persistence failure must not crash the worker process or stop the session from
        // continuing to run; surface it for operators via stderr instead.
        console.error(`Failed to persist agent execution ${executionId}:`, error);
      },
    );
    writeQueue = next;
    return next;
  };

  const finalize = (fields: Partial<typeof agentExecutions.$inferInsert>) =>
    enqueue(() => db.update(agentExecutions).set({ ...fields, updatedAt: new Date() }).where(eq(agentExecutions.id, executionId)));

  // finalizeAttempt itself only ever runs as an already-queued task (dispatched from the "exit"
  // case below via `enqueue(() => finalizeAttempt(...))`), so its own writes must NOT be routed
  // back through `enqueue`/`writeQueue` -- doing so would reassign `writeQueue` to
  // `writeQueue.then(...)` while `writeQueue` is still the very promise wrapping this task's own
  // execution, deadlocking the chain (the task can't resolve until its own nested write resolves,
  // and that write can't run until the task resolves). Writing directly here is safe: nothing
  // else enqueues further work for this attempt once "exit" fires (the accompanying
  // "unexpected_exit"/"usage_unavailable" diagnostics are explicitly ignored below), and any
  // events from a subsequently started repair session go through their own attach()/enqueue calls
  // registered after this function returns.
  async function persistExecutionFields(fields: Partial<typeof agentExecutions.$inferInsert>): Promise<void> {
    try {
      await db.update(agentExecutions).set({ ...fields, updatedAt: new Date() }).where(eq(agentExecutions.id, executionId));
    } catch (error) {
      console.error(`Failed to persist agent execution ${executionId}:`, error);
    }
  }

  async function finalizeAttempt(exitCode: number, messageText: string, attempt: 1 | 2): Promise<void> {
    const outcome = extractAndValidateResult(messageText, agent.canCommit);

    if (outcome.ok) {
      const { result } = outcome;
      await persistExecutionFields({
        status: executionStatusForResult(result.status),
        resultStatus: result.status,
        resultPayload: result,
        commitHash: agent.canCommit ? result.commit : null,
        failureReason: null,
        exitCode,
        completedAt: new Date(),
      });
      return;
    }

    if (attempt === 1) {
      // Persisted (and awaited) before starting the repair worker so a crash mid-repair does not
      // leave repair_attempted=false, which would otherwise allow an unbounded retry loop.
      await persistExecutionFields({ repairAttempted: true });
      const repairInstruction = composeRepairInstruction(originalInstruction, outcome.excerpt, outcome.reasons);
      const repairSession = startWorker({ projectPath, agent, instruction: repairInstruction });
      liveSessions.set(executionId, repairSession);
      attach(repairSession, 2);
      return;
    }

    await persistExecutionFields({
      status: "failed",
      resultStatus: null,
      failureReason: outcome.reasons[0] ?? "The repair attempt did not produce a valid structured result.",
      exitCode,
      completedAt: new Date(),
    });
  }

  function attach(session: RuntimeSession, attempt: 1 | 2): void {
    let runningRecorded = false;
    let messageText = "";

    session.subscribe((event) => {
      if (!runningRecorded && session.metadata.state !== "failed") {
        runningRecorded = true;
        enqueue(() =>
          db
            .update(agentExecutions)
            .set({ status: "running", pid: session.metadata.pid, startedAt: new Date(), updatedAt: new Date() })
            .where(eq(agentExecutions.id, executionId)),
        );
      }

      switch (event.type) {
        case "output": {
          const sequence = ++terminalSequence;
          const { data } = event;
          enqueue(() =>
            db.insert(terminalChunks).values({ agentExecutionId: executionId, sequence, data }).onConflictDoNothing(),
          );
          break;
        }
        case "usage": {
          const { usage } = event;
          // The runtime does not yet distinguish token usage from context usage; mirror the
          // reported telemetry into both rather than fabricating a split.
          enqueue(() =>
            db
              .update(agentExecutions)
              .set({ tokenUsage: usage, contextUsage: usage, updatedAt: new Date() })
              .where(eq(agentExecutions.id, executionId)),
          );
          break;
        }
        case "provider": {
          const text = adapter.extractMessageText?.(event.event);
          if (text) messageText += text;
          break;
        }
        case "exit": {
          const { exitCode } = event;
          enqueue(() => finalizeAttempt(exitCode, messageText, attempt));
          break;
        }
        case "diagnostic": {
          // Missing usage telemetry is not a failure -- it is reported as unavailable, not
          // fabricated, and must not overwrite a successful completion. "unexpected_exit" is
          // superseded by the exit-driven result finalization above (it fires alongside "exit"
          // for any non-zero exit code, but status is decided by finalizeAttempt so a nonzero
          // exit doesn't blindly overwrite a valid structured result or race the repair flow).
          // All other diagnostics represent launch-time failures where the process never
          // produced an "exit" event, so they remain the sole source of failure status here.
          if (event.diagnostic.code === "usage_unavailable" || event.diagnostic.code === "unexpected_exit") break;
          const { message } = event.diagnostic;
          finalize({ status: "failed", resultStatus: null, failureReason: message });
          break;
        }
      }
    });
  }

  attach(params.session, 1);
}

export async function getExecution(id: string): Promise<AgentExecution | null> {
  const [row] = await db.select().from(agentExecutions).where(eq(agentExecutions.id, id));
  return row ? serializeExecution(row) : null;
}

export type TerminalChunkRow = { sequence: number; data: string };

export async function listTerminalChunks(id: string): Promise<TerminalChunkRow[]> {
  return db
    .select({ sequence: terminalChunks.sequence, data: terminalChunks.data })
    .from(terminalChunks)
    .where(eq(terminalChunks.agentExecutionId, id))
    .orderBy(asc(terminalChunks.sequence));
}

export function attachLiveSession(id: string): RuntimeSession | undefined {
  return liveSessions.get(id);
}
