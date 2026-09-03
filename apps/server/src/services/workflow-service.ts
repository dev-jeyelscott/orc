import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

import type { AgentExecution, AgentResultStatus, CreateTask, Run, Task, TaskWithRun } from "@orc/shared";

import { db } from "../db/client.js";
import { agentExecutions, agentRoutes, agents, runs, tasks } from "../db/schema.js";
import { env } from "../config/env.js";
import { composeHandoffNote } from "../runtime/index.js";
import { getProject } from "./project-discovery.js";
import { cancelLiveExecution, startSnapshotAgentExecution, type ExecutionFinalization, type SnapshotAgent } from "./agent-execution-service.js";
import { recordEvent, listRunEvents } from "./event-service.js";

const MAX_EXECUTIONS = Number(process.env.MAX_WORKFLOW_EXECUTIONS ?? 10);

type SnapshotRoute = {
  sourceAgentId: string;
  outcome: AgentResultStatus;
  targetAgentId: string | null;
  terminalAction: "complete_run" | "fail_run" | "block_run" | null;
};
type WorkflowSnapshot = { agents: SnapshotAgent[]; routes: SnapshotRoute[] };

export class WorkflowServiceError extends Error {
  constructor(message: string, readonly statusCode: number) { super(message); }
}

function serializeTask(row: typeof tasks.$inferSelect): Task {
  return { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

function serializeRun(row: typeof runs.$inferSelect): Run {
  return {
    id: row.id, projectPath: row.projectPath, taskId: row.taskId ?? null, status: row.status,
    currentAgentId: row.currentAgentId ?? null, executionCount: row.executionCount,
    terminalReason: row.terminalReason ?? null, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  };
}

function snapshotFromRows(agentRows: Array<typeof agents.$inferSelect>, routeRows: Array<typeof agentRoutes.$inferSelect>): WorkflowSnapshot {
  const enabledIds = new Set(agentRows.map((agent) => agent.id));
  return {
    agents: agentRows.map((agent) => ({
      id: agent.id, name: agent.name, role: agent.role, layer: agent.layer, executionOrder: agent.executionOrder,
      harness: agent.harness, model: agent.model, reasoning: agent.reasoning, systemPrompt: agent.systemPrompt,
      canWrite: agent.canWrite, canRunCommands: agent.canRunCommands, canCommit: agent.canCommit,
    })),
    routes: routeRows
      .filter((route) => route.enabled && enabledIds.has(route.sourceAgentId) && (!route.targetAgentId || enabledIds.has(route.targetAgentId)))
      .map((route) => ({ sourceAgentId: route.sourceAgentId, outcome: route.outcome, targetAgentId: route.targetAgentId ?? null, terminalAction: route.terminalAction ?? null })),
  };
}

function snapshotOf(row: typeof runs.$inferSelect): WorkflowSnapshot {
  const snapshot = row.workflowSnapshot as WorkflowSnapshot | null;
  if (!snapshot || !Array.isArray(snapshot.agents) || !Array.isArray(snapshot.routes)) throw new WorkflowServiceError("Run workflow snapshot is invalid", 500);
  return snapshot;
}

async function updateTerminal(run: typeof runs.$inferSelect, status: "completed" | "failed" | "blocked" | "cancelled", reason: string | null) {
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.update(runs).set({ status, currentAgentId: null, terminalReason: reason, updatedAt: now }).where(eq(runs.id, run.id));
    if (run.taskId) await tx.update(tasks).set({ status, updatedAt: now }).where(eq(tasks.id, run.taskId));
  });
  await recordEvent({ type: `run.${status}`, projectPath: run.projectPath, taskId: run.taskId, runId: run.id, data: { reason } });
}

async function launchNext(runId: string, nextAgentId: string, handoffNote?: string): Promise<void> {
  const [run] = await db.select().from(runs).where(eq(runs.id, runId));
  if (!run || run.status !== "running") return;
  const snapshot = snapshotOf(run);
  const agent = snapshot.agents.find((candidate) => candidate.id === nextAgentId);
  if (!agent) return updateTerminal(run, "failed", "The workflow route targeted an agent outside this run's snapshot.");
  if (run.executionCount >= MAX_EXECUTIONS) return updateTerminal(run, "failed", `Workflow execution limit (${MAX_EXECUTIONS}) reached.`);

  const now = new Date();
  const [claimed] = await db.update(runs)
    .set({ currentAgentId: agent.id, executionCount: run.executionCount + 1, updatedAt: now })
    .where(and(eq(runs.id, run.id), eq(runs.status, "running"), sql`${runs.currentAgentId} is null`))
    .returning();
  if (!claimed) return;
  await recordEvent({ type: "agent.started", projectPath: claimed.projectPath, taskId: claimed.taskId, runId: claimed.id, data: { agentId: agent.id, layer: agent.layer, executionOrder: agent.executionOrder } });
  const baseInstruction = await getTaskInstruction(claimed);
  const instruction = handoffNote ? `${baseInstruction}\n\n${handoffNote}` : baseInstruction;
  await startSnapshotAgentExecution(claimed, agent, instruction, (finalization) => handleExecutionFinalization(claimed.id, agent.id, finalization));
}

async function getTaskInstruction(run: typeof runs.$inferSelect): Promise<string> {
  if (!run.taskId) throw new WorkflowServiceError("Workflow run is missing its task", 500);
  const [task] = await db.select({ instruction: tasks.instruction }).from(tasks).where(eq(tasks.id, run.taskId));
  if (!task) throw new WorkflowServiceError("Workflow task no longer exists", 500);
  return task.instruction;
}

async function handleExecutionFinalization(runId: string, agentId: string, finalization: ExecutionFinalization): Promise<void> {
  const [run] = await db.select().from(runs).where(eq(runs.id, runId));
  if (!run || run.status !== "running") return;
  const cleared = await db.update(runs).set({ currentAgentId: null, updatedAt: new Date() })
    .where(and(eq(runs.id, runId), eq(runs.currentAgentId, agentId), eq(runs.status, "running"))).returning({ id: runs.id });
  if (!cleared.length) return;
  if (finalization.status === "cancelled") return updateTerminal(run, "cancelled", finalization.failureReason);
  if (!finalization.resultStatus) return updateTerminal(run, "failed", finalization.failureReason ?? "Worker did not produce a valid structured result.");

  await recordEvent({ type: "result.received", projectPath: run.projectPath, taskId: run.taskId, runId, agentExecutionId: finalization.executionId, data: { status: finalization.resultStatus } });

  const snapshot = snapshotOf(run);
  const sourceAgent = snapshot.agents.find((candidate) => candidate.id === agentId);
  const handoffNote = finalization.result && sourceAgent ? composeHandoffNote(sourceAgent, finalization.result) : undefined;
  const route = snapshot.routes.find((candidate) => candidate.sourceAgentId === agentId && candidate.outcome === finalization.resultStatus);
  if (route?.terminalAction) {
    const status = route.terminalAction === "complete_run" ? "completed" : route.terminalAction === "fail_run" ? "failed" : "blocked";
    return updateTerminal(run, status, `Terminal route: ${route.terminalAction}`);
  }
  if (route?.targetAgentId) { await recordEvent({ type: "route.selected", projectPath: run.projectPath, taskId: run.taskId, runId, agentExecutionId: finalization.executionId, data: { targetAgentId: route.targetAgentId, outcome: finalization.resultStatus } }); return launchNext(run.id, route.targetAgentId, handoffNote); }

  if (finalization.resultStatus === "completed" || finalization.resultStatus === "approved") {
    const currentIndex = snapshot.agents.findIndex((candidate) => candidate.id === agentId);
    const next = snapshot.agents[currentIndex + 1];
    if (!next) return updateTerminal(run, "completed", null);
    return launchNext(run.id, next.id, handoffNote);
  }
  const terminalStatus = finalization.resultStatus === "blocked" || finalization.resultStatus === "changes_requested" ? "blocked" : "failed";
  return updateTerminal(run, terminalStatus, finalization.failureReason ?? `No configured route for ${finalization.resultStatus}.`);
}

export async function createAndStartTask(input: CreateTask): Promise<TaskWithRun> {
  const project = await getProject(env.WORKSPACE_ROOT, input.projectId);
  if (!project) throw new WorkflowServiceError("The selected project is no longer available", 404);
  const result = await db.transaction(async (tx) => {
    const active = await tx.select({ id: runs.id }).from(runs).where(inArray(runs.status, ["pending", "running"])).limit(1);
    if (active.length) throw new WorkflowServiceError("Another task is already active", 409);
    const enabledAgents = await tx.select().from(agents).where(eq(agents.enabled, true)).orderBy(asc(agents.layer), asc(agents.executionOrder));
    if (!enabledAgents.length) throw new WorkflowServiceError("Configure at least one enabled agent before starting a task", 400);
    const routes = await tx.select().from(agentRoutes).where(eq(agentRoutes.enabled, true));
    const now = new Date();
    const [task] = await tx.insert(tasks).values({ projectPath: project.path, title: input.title, instruction: input.instruction, status: "running" }).returning();
    const [run] = await tx.insert(runs).values({ taskId: task.id, projectPath: project.path, status: "running", workflowSnapshot: snapshotFromRows(enabledAgents, routes), executionCount: 0, updatedAt: now }).returning();
    return { task, run };
  });
  const snapshot = snapshotOf(result.run);
  await recordEvent({ type: "run.started", projectPath: result.run.projectPath, taskId: result.task.id, runId: result.run.id, data: { title: result.task.title } });
  void launchNext(result.run.id, snapshot.agents[0].id);
  return { task: serializeTask(result.task), run: serializeRun(result.run) };
}

export async function listTasks(): Promise<Task[]> {
  return (await db.select().from(tasks).orderBy(desc(tasks.createdAt))).map(serializeTask);
}

export async function listRuns(): Promise<Run[]> {
  return (await db.select().from(runs).orderBy(desc(runs.createdAt))).map(serializeRun);
}

export async function getRunDetail(id: string): Promise<{ run: Run; task: Task | null; executions: AgentExecution[]; events: Awaited<ReturnType<typeof listRunEvents>> } | null> {
  const [run] = await db.select().from(runs).where(eq(runs.id, id));
  if (!run) return null;
  const rows = await db.select().from(agentExecutions).where(eq(agentExecutions.runId, id)).orderBy(asc(agentExecutions.createdAt));
  const { getExecution } = await import("./agent-execution-service.js");
  const executions = (await Promise.all(rows.map((row) => getExecution(row.id)))).filter((value): value is AgentExecution => value !== null);
  const [task] = run.taskId ? await db.select().from(tasks).where(eq(tasks.id, run.taskId)) : [];
  return { run: serializeRun(run), task: task ? serializeTask(task) : null, executions, events: await listRunEvents(id) };
}

export async function cancelRun(id: string): Promise<Run | null> {
  const [run] = await db.select().from(runs).where(eq(runs.id, id));
  if (!run) return null;
  if (run.status !== "running" && run.status !== "pending") throw new WorkflowServiceError("Only an active run can be cancelled", 409);
  const [execution] = await db.select().from(agentExecutions).where(eq(agentExecutions.runId, id)).orderBy(desc(agentExecutions.createdAt)).limit(1);
  if (execution) await cancelLiveExecution(execution.id);
  if (execution) await db.update(agentExecutions).set({ status: "cancelled", failureReason: "Cancelled by operator", completedAt: new Date(), updatedAt: new Date() }).where(eq(agentExecutions.id, execution.id));
  await updateTerminal(run, "cancelled", "Cancelled by operator");
  const [updated] = await db.select().from(runs).where(eq(runs.id, id));
  return updated ? serializeRun(updated) : null;
}

export async function retryLastExecution(id: string): Promise<Run | null> {
  const [run] = await db.select().from(runs).where(eq(runs.id, id));
  if (!run) return null;
  if (run.status !== "failed" && run.status !== "blocked") throw new WorkflowServiceError("Only failed or blocked runs can be retried", 409);
  const [execution] = await db.select().from(agentExecutions).where(eq(agentExecutions.runId, id)).orderBy(desc(agentExecutions.createdAt)).limit(1);
  if (!execution?.agentId) throw new WorkflowServiceError("The final execution cannot be retried because its agent snapshot is unavailable", 409);
  const snapshot = snapshotOf(run);
  if (!snapshot.agents.some((agent) => agent.id === execution.agentId)) throw new WorkflowServiceError("The final execution is outside this run's workflow snapshot", 409);
  if (run.executionCount >= MAX_EXECUTIONS) throw new WorkflowServiceError(`Workflow execution limit (${MAX_EXECUTIONS}) reached.`, 409);
  await db.update(runs).set({ status: "running", currentAgentId: null, terminalReason: null, updatedAt: new Date() }).where(eq(runs.id, id));
  await recordEvent({ type: "execution.retried", projectPath: run.projectPath, taskId: run.taskId, runId: id, agentExecutionId: execution.id, data: { agentId: execution.agentId } });
  void launchNext(id, execution.agentId);
  const [updated] = await db.select().from(runs).where(eq(runs.id, id));
  return updated ? serializeRun(updated) : null;
}

export async function recoverInterruptedWorkflows(): Promise<void> {
  const active = await db.select().from(runs).where(inArray(runs.status, ["pending", "running"]));
  for (const run of active) {
    await updateTerminal(run, "blocked", "Server restarted while this workflow was active; it was not resumed.");
    await db.update(agentExecutions).set({ status: "blocked", failureReason: "Server restarted while worker state was unavailable.", completedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(agentExecutions.runId, run.id), inArray(agentExecutions.status, ["pending", "starting", "running"])));
  }
}
