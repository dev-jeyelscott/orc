import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  sql,
} from "drizzle-orm";
import type {
  DashboardActivity,
  DashboardContextUsage,
  DashboardProjectSummary,
  DashboardStatusCounts,
  DashboardSummary,
  DomainEvent,
  ProjectListResponse,
  RunStatus,
} from "@orc/shared";

import { env } from "../config/env.js";
import { db } from "../db/client.js";
import {
  agentExecutions,
  agents,
  runs,
  tasks,
} from "../db/schema.js";
import { listRecentEvents } from "./event-service.js";
import { getHealthStatus } from "./health-service.js";
import { listProjects } from "./project-discovery.js";

export const DASHBOARD_EVENT_LIMIT = 8;
const PROJECT_ACTIVITY_SCAN_LIMIT = 20;

const RUN_STATUSES: RunStatus[] = [
  "pending",
  "running",
  "completed",
  "failed",
  "blocked",
  "cancelled",
];

type StatusCountRow = {
  status: RunStatus;
  count: number;
};

/**
 * Normalizes grouped database status rows into a complete six-state count object.
 */
export function buildStatusCounts(
  rows: ReadonlyArray<StatusCountRow>,
): DashboardStatusCounts {
  const counts: DashboardStatusCounts = {
    pending: 0,
    running: 0,
    completed: 0,
    failed: 0,
    blocked: 0,
    cancelled: 0,
  };

  for (const row of rows) {
    if (RUN_STATUSES.includes(row.status)) {
      counts[row.status] += Number(row.count);
    }
  }

  return counts;
}

/**
 * Reads the first finite nonnegative numeric field present in a telemetry object.
 */
function readNumericField(
  value: Record<string, unknown>,
  keys: string[],
): number | null {
  for (const key of keys) {
    const candidate = value[key];

    if (
      typeof candidate === "number" &&
      Number.isFinite(candidate) &&
      candidate >= 0
    ) {
      return candidate;
    }
  }

  return null;
}

/**
 * Extracts a truthful total token count only from explicit provider totals or input/output pairs.
 */
export function readTokenTotal(
  value: Record<string, unknown> | null,
): number | null {
  if (!value) {
    return null;
  }

  const explicitTotal = readNumericField(value, [
    "total_tokens",
    "totalTokens",
  ]);

  if (explicitTotal !== null) {
    return explicitTotal;
  }

  const input = readNumericField(value, [
    "input_tokens",
    "inputTokens",
  ]);
  const output = readNumericField(value, [
    "output_tokens",
    "outputTokens",
  ]);

  if (input === null || output === null) {
    return null;
  }

  return input + output;
}

/**
 * Extracts context usage only when both a real numerator and a positive provider limit exist.
 */
export function readContextUsage(
  value: Record<string, unknown> | null,
): DashboardContextUsage | null {
  if (!value) {
    return null;
  }

  const used = readNumericField(value, [
    "used",
    "current",
    "tokensUsed",
    "tokens_used",
    "currentTokens",
    "current_tokens",
  ]);

  const limit = readNumericField(value, [
    "limit",
    "max",
    "contextWindow",
    "context_window",
    "contextWindowTokens",
    "context_window_tokens",
    "maxTokens",
    "max_tokens",
  ]);

  if (used === null || limit === null || limit <= 0) {
    return null;
  }

  return {
    used,
    limit,
    percent: Math.min(100, Math.max(0, (used / limit) * 100)),
  };
}

/**
 * Aggregates the authoritative filesystem project discovery response.
 */
export function buildProjectSummary(
  projectList: ProjectListResponse,
): DashboardProjectSummary {
  return {
    discovered: projectList.projects.length,
    clean: projectList.projects.filter(
      (project) => project.gitState === "clean",
    ).length,
    dirty: projectList.projects.filter(
      (project) => project.gitState === "dirty",
    ).length,
    unknown: projectList.projects.filter(
      (project) => project.gitState === "unknown",
    ).length,
    workspaceRoot: projectList.workspaceRoot,
    error: projectList.error,
  };
}

/**
 * Gives the active task-backed workflow priority over historical activity.
 */
export function selectActivityCandidate<T>(
  active: T | null | undefined,
  recent: T | null | undefined,
): { kind: "active" | "recent"; run: T } | null {
  if (active) {
    return { kind: "active", run: active };
  }

  if (recent) {
    return { kind: "recent", run: recent };
  }

  return null;
}

/**
 * Defensively orders events newest first and enforces the dashboard event limit.
 */
export function limitDashboardEvents(
  events: ReadonlyArray<DomainEvent>,
): DomainEvent[] {
  return [...events]
    .sort(
      (left, right) =>
        Date.parse(right.createdAt) - Date.parse(left.createdAt),
    )
    .slice(0, DASHBOARD_EVENT_LIMIT);
}

/**
 * Builds the compact current or recent run summary without loading terminal or result histories.
 */
async function loadActivity(
  run: typeof runs.$inferSelect,
  kind: "active" | "recent",
): Promise<DashboardActivity> {
  const taskRows = run.taskId
    ? await db
        .select({ title: tasks.title })
        .from(tasks)
        .where(eq(tasks.id, run.taskId))
        .limit(1)
    : [];

  let executionRows: Array<typeof agentExecutions.$inferSelect> = [];

  if (kind === "active" && run.currentAgentId) {
    executionRows = await db
      .select()
      .from(agentExecutions)
      .where(
        and(
          eq(agentExecutions.runId, run.id),
          eq(agentExecutions.agentId, run.currentAgentId),
        ),
      )
      .orderBy(desc(agentExecutions.createdAt))
      .limit(1);
  } else if (kind === "recent") {
    executionRows = await db
      .select()
      .from(agentExecutions)
      .where(eq(agentExecutions.runId, run.id))
      .orderBy(desc(agentExecutions.createdAt))
      .limit(1);
  }

  const commitRows = await db
    .select({ commitHash: agentExecutions.commitHash })
    .from(agentExecutions)
    .where(
      and(
        eq(agentExecutions.runId, run.id),
        isNotNull(agentExecutions.commitHash),
      ),
    )
    .orderBy(desc(agentExecutions.createdAt))
    .limit(1);

  const execution = executionRows[0];

  return {
    kind,
    runId: run.id,
    taskId: run.taskId ?? null,
    taskTitle: taskRows[0]?.title ?? null,
    projectPath: run.projectPath,
    runStatus: run.status,
    executionCount: run.executionCount,
    terminalReason: run.terminalReason ?? null,
    runCreatedAt: run.createdAt.toISOString(),
    runUpdatedAt: run.updatedAt.toISOString(),
    execution: execution
      ? {
          id: execution.id,
          agentName: execution.agentName,
          agentRole: execution.agentRole,
          layer: execution.layer,
          executionOrder: execution.executionOrder,
          harness: execution.harness,
          model: execution.model,
          reasoning: execution.reasoning,
          status: execution.status,
          pid: execution.pid ?? null,
          startedAt: execution.startedAt
            ? execution.startedAt.toISOString()
            : null,
          completedAt: execution.completedAt
            ? execution.completedAt.toISOString()
            : null,
          tokenTotal: readTokenTotal(
            (execution.tokenUsage as Record<string, unknown> | null) ??
              null,
          ),
          contextUsage: readContextUsage(
            (execution.contextUsage as Record<string, unknown> | null) ??
              null,
          ),
        }
      : null,
    latestCommitHash: commitRows[0]?.commitHash ?? null,
  };
}

/**
 * Derives a bounded most-active-project list from persisted run counts and current projects.
 */
async function loadProjectActivity(
  projectList: ProjectListResponse,
): Promise<DashboardSummary["projectActivity"]> {
  if (projectList.projects.length === 0) {
    return [];
  }

  const runCountExpression = sql<number>`count(*)::int`;

  const rows = await db
    .select({
      projectPath: runs.projectPath,
      runCount: runCountExpression,
    })
    .from(runs)
    .groupBy(runs.projectPath)
    .orderBy(
      desc(runCountExpression),
      asc(runs.projectPath),
    )
    .limit(PROJECT_ACTIVITY_SCAN_LIMIT);

  const projectsByPath = new Map(
    projectList.projects.map((project) => [
      project.path,
      project,
    ]),
  );

  return rows
    .flatMap((row) => {
      const project = projectsByPath.get(row.projectPath);

      return project
        ? [
            {
              projectPath: row.projectPath,
              projectName: project.name,
              runCount: Number(row.runCount),
            },
          ]
        : [];
    })
    .slice(0, 5);
}

/**
 * Creates a truthful partial response when database-backed dashboard data is unavailable.
 */
function buildDatabaseUnavailableSummary(
  health: DashboardSummary["health"],
  projectList: ProjectListResponse,
  databaseError: string,
): DashboardSummary {
  return {
    health,
    databaseError,
    agents: null,
    tasks: null,
    runs: null,
    projects: buildProjectSummary(projectList),
    activity: null,
    recentEvents: [],
    projectActivity: [],
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Aggregates the complete bounded dashboard read model from authoritative system sources.
 */
export async function getDashboardSummary(): Promise<DashboardSummary> {
  const [health, projectList] = await Promise.all([
    getHealthStatus(),
    listProjects(env.WORKSPACE_ROOT),
  ]);

  if (health.db === "down") {
    return buildDatabaseUnavailableSummary(
      health,
      projectList,
      "Database-backed dashboard data is unavailable.",
    );
  }

  try {
    const statusCountExpression =
      sql<number>`count(*)::int`;

    const [
      taskStatusRows,
      runStatusRows,
      agentSummaryRows,
      activeRunRows,
      recentEvents,
      projectActivity,
    ] = await Promise.all([
      db
        .select({
          status: tasks.status,
          count: statusCountExpression,
        })
        .from(tasks)
        .groupBy(tasks.status),

      db
        .select({
          status: runs.status,
          count: statusCountExpression,
        })
        .from(runs)
        .groupBy(runs.status),

      db
        .select({
          configured: sql<number>`count(*)::int`,
          enabled:
            sql<number>`count(*) filter (where ${agents.enabled} = true)::int`,
        })
        .from(agents),

      db
        .select()
        .from(runs)
        .where(
          and(
            isNotNull(runs.taskId),
            inArray(runs.status, ["pending", "running"]),
          ),
        )
        .orderBy(desc(runs.createdAt))
        .limit(1),

      listRecentEvents(DASHBOARD_EVENT_LIMIT),

      loadProjectActivity(projectList),
    ]);

    const activeRun = activeRunRows[0] ?? null;

    const recentRunRows = activeRun
      ? []
      : await db
          .select()
          .from(runs)
          .where(isNotNull(runs.taskId))
          .orderBy(desc(runs.createdAt))
          .limit(1);

    const activityCandidate = selectActivityCandidate(
      activeRun,
      recentRunRows[0] ?? null,
    );

    const activity = activityCandidate
      ? await loadActivity(
          activityCandidate.run,
          activityCandidate.kind,
        )
      : null;

    const agentSummary = agentSummaryRows[0] ?? {
      configured: 0,
      enabled: 0,
    };

    return {
      health,
      databaseError: null,
      agents: {
        configured: Number(agentSummary.configured),
        enabled: Number(agentSummary.enabled),
      },
      tasks: buildStatusCounts(
        taskStatusRows.map((row) => ({
          status: row.status,
          count: Number(row.count),
        })),
      ),
      runs: buildStatusCounts(
        runStatusRows.map((row) => ({
          status: row.status,
          count: Number(row.count),
        })),
      ),
      projects: buildProjectSummary(projectList),
      activity,
      recentEvents: limitDashboardEvents(recentEvents),
      projectActivity,
      generatedAt: new Date().toISOString(),
    };
  } catch {
    return buildDatabaseUnavailableSummary(
      health,
      projectList,
      "Dashboard database summary is unavailable.",
    );
  }
}
