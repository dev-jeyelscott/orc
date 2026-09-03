import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  or,
  sql,
} from "drizzle-orm";

import type {
  Agent,
  AgentMonitoringOverview,
  AgentMonitoringRange,
  AgentObservability,
  AgentRecentExecution,
  AgentRoute,
  AgentValidationIssue,
  AgentWithRoutes,
  DomainEvent,
} from "@orc/shared";

import { db } from "../db/client.js";
import {
  agentExecutions,
  agentRoutes,
  agents,
  domainEvents,
} from "../db/schema.js";
import {
  listRecentEvents,
} from "./event-service.js";

const ACTIVE_EXECUTION_STATUSES = [
  "starting",
  "running",
] as const;

const RANGE_MILLISECONDS: Record<
  AgentMonitoringRange,
  number
> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

const CHART_BUCKET_COUNT = 14;

/**
 * Converts one persisted agent row into the shared API contract.
 */
function serializeAgent(
  row: typeof agents.$inferSelect,
): Agent {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Converts one persisted route row into the shared API contract.
 */
function serializeRoute(
  row: typeof agentRoutes.$inferSelect,
): AgentRoute {
  return {
    ...row,
    targetAgentId:
      row.targetAgentId ?? null,
    terminalAction:
      row.terminalAction ?? null,
    createdAt:
      row.createdAt.toISOString(),
    updatedAt:
      row.updatedAt.toISOString(),
  };
}

/**
 * Converts one persisted domain event into the shared API contract.
 */
function serializeEvent(
  row: typeof domainEvents.$inferSelect,
): DomainEvent {
  return {
    ...row,
    taskId:
      row.taskId ?? null,
    runId:
      row.runId ?? null,
    agentExecutionId:
      row.agentExecutionId ?? null,
    data:
      (
        row.data as
          | Record<string, unknown>
          | null
      ) ?? {},
    createdAt:
      row.createdAt.toISOString(),
  };
}

/**
 * Loads every current agent and route using two ordered queries rather than per-agent requests.
 */
async function listAgentConfigurations(): Promise<
  AgentWithRoutes[]
> {
  const [
    agentRows,
    routeRows,
  ] = await Promise.all([
    db
      .select()
      .from(agents)
      .orderBy(
        asc(agents.layer),
        asc(agents.executionOrder),
      ),
    db
      .select()
      .from(agentRoutes)
      .orderBy(
        asc(agentRoutes.sourceAgentId),
        asc(agentRoutes.outcome),
      ),
  ]);

  const routesBySource =
    new Map<string, AgentRoute[]>();

  for (const row of routeRows) {
    const route =
      serializeRoute(row);

    const existing =
      routesBySource.get(
        route.sourceAgentId,
      ) ?? [];

    existing.push(route);

    routesBySource.set(
      route.sourceAgentId,
      existing,
    );
  }

  return agentRows.map(
    (row) => ({
      ...serializeAgent(row),
      routes:
        routesBySource.get(row.id) ??
        [],
    }),
  );
}

/**
 * Returns the reporting-window cutoff for the requested monitoring range.
 */
function rangeCutoff(
  range: AgentMonitoringRange,
  now = Date.now(),
): Date {
  return new Date(
    now -
      RANGE_MILLISECONDS[range],
  );
}

/**
 * Converts unknown JSON telemetry into a plain record when possible.
 */
function asRecord(
  value: unknown,
): Record<string, unknown> | null {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return null;
  }

  return value as Record<
    string,
    unknown
  >;
}

/**
 * Reads the first recognized finite non-negative numeric telemetry field.
 */
function readNumber(
  value: unknown,
  keys: string[],
): number | null {
  const record =
    asRecord(value);

  if (!record) {
    return null;
  }

  for (const key of keys) {
    const candidate =
      record[key];

    if (
      typeof candidate ===
        "number" &&
      Number.isFinite(candidate) &&
      candidate >= 0
    ) {
      return candidate;
    }
  }

  return null;
}

/**
 * Normalizes only recognized total token fields and returns null for unsupported provider shapes.
 */
function totalTokensFromUsage(
  value: unknown,
): number | null {
  const reportedTotal =
    readNumber(value, [
      "total_tokens",
      "totalTokens",
    ]);

  if (reportedTotal !== null) {
    return reportedTotal;
  }

  const input =
    readNumber(value, [
      "input_tokens",
      "inputTokens",
    ]);

  const output =
    readNumber(value, [
      "output_tokens",
      "outputTokens",
    ]);

  if (
    input === null &&
    output === null
  ) {
    return null;
  }

  return (
    (input ?? 0) +
    (output ?? 0)
  );
}

/**
 * Normalizes context usage only from recognized percentage or used/limit fields.
 */
function contextPercentFromUsage(
  value: unknown,
): number | null {
  const reported =
    readNumber(value, [
      "percent",
      "percentage",
      "percent_used",
      "percentUsed",
    ]);

  if (reported !== null) {
    return Math.min(
      100,
      Math.max(0, reported),
    );
  }

  const used =
    readNumber(value, [
      "used_tokens",
      "usedTokens",
      "context_tokens",
      "contextTokens",
    ]);

  const limit =
    readNumber(value, [
      "limit_tokens",
      "limitTokens",
      "context_window",
      "contextWindow",
    ]);

  if (
    used === null ||
    limit === null ||
    limit <= 0
  ) {
    return null;
  }

  return Math.min(
    100,
    Math.max(
      0,
      (used / limit) * 100,
    ),
  );
}

/**
 * Calculates one terminal execution duration from authoritative timestamps.
 */
function executionDurationMs(
  row:
    typeof agentExecutions.$inferSelect,
): number | null {
  if (
    !row.startedAt ||
    !row.completedAt
  ) {
    return null;
  }

  const duration =
    row.completedAt.getTime() -
    row.startedAt.getTime();

  return duration >= 0
    ? duration
    : null;
}

/**
 * Returns the arithmetic mean for a non-empty numeric sample.
 */
function average(
  values: number[],
): number | null {
  if (values.length === 0) {
    return null;
  }

  return (
    values.reduce(
      (sum, value) =>
        sum + value,
      0,
    ) / values.length
  );
}

/**
 * Converts an execution row into the bounded summary needed by the Agents page.
 */
function serializeRecentExecution(
  row:
    typeof agentExecutions.$inferSelect,
): AgentRecentExecution {
  return {
    id: row.id,
    runId: row.runId,
    status: row.status,
    resultStatus:
      row.resultStatus ?? null,
    startedAt:
      row.startedAt
        ? row.startedAt.toISOString()
        : null,
    completedAt:
      row.completedAt
        ? row.completedAt.toISOString()
        : null,
    exitCode:
      row.exitCode ?? null,
    commitHash:
      row.commitHash ?? null,
    createdAt:
      row.createdAt.toISOString(),
    updatedAt:
      row.updatedAt.toISOString(),
  };
}

/**
 * Calculates a stable time-bucket index for one timestamp.
 */
function bucketIndex(
  timestamp: number,
  cutoff: number,
  now: number,
  bucketCount: number,
): number | null {
  if (
    timestamp < cutoff ||
    timestamp > now
  ) {
    return null;
  }

  const duration =
    Math.max(1, now - cutoff);

  const width =
    duration / bucketCount;

  return Math.min(
    bucketCount - 1,
    Math.floor(
      (timestamp - cutoff) /
        width,
    ),
  );
}

/**
 * Builds execution-count buckets for the selected monitoring range.
 */
function buildActivityBuckets(
  rows: Array<
    typeof agentExecutions.$inferSelect
  >,
  cutoff: Date,
  now = Date.now(),
  bucketCount =
    CHART_BUCKET_COUNT,
) {
  const counts =
    Array.from(
      { length: bucketCount },
      () => 0,
    );

  for (const row of rows) {
    const index =
      bucketIndex(
        row.createdAt.getTime(),
        cutoff.getTime(),
        now,
        bucketCount,
      );

    if (index !== null) {
      counts[index] += 1;
    }
  }

  return counts.map(
    (count, index) => ({
      index,
      count,
    }),
  );
}

/**
 * Builds average-token buckets using only executions with recognized token telemetry.
 */
function buildTokenBuckets(
  rows: Array<
    typeof agentExecutions.$inferSelect
  >,
  cutoff: Date,
  now = Date.now(),
  bucketCount =
    CHART_BUCKET_COUNT,
) {
  const samples =
    Array.from(
      { length: bucketCount },
      () => [] as number[],
    );

  for (const row of rows) {
    const index =
      bucketIndex(
        row.createdAt.getTime(),
        cutoff.getTime(),
        now,
        bucketCount,
      );

    if (index === null) {
      continue;
    }

    const total =
      totalTokensFromUsage(
        row.tokenUsage,
      );

    if (total !== null) {
      samples[index].push(total);
    }
  }

  return samples.map(
    (values, index) => ({
      index,
      averageTokens:
        average(values),
    }),
  );
}

/**
 * Finds deterministic current-configuration warnings without inventing validation rules.
 */
function findValidationIssues(
  configuredAgents:
    AgentWithRoutes[],
): AgentValidationIssue[] {
  const agentsById =
    new Map(
      configuredAgents.map(
        (agent) => [
          agent.id,
          agent,
        ],
      ),
    );

  const issues:
    AgentValidationIssue[] = [];

  for (
    const source of
    configuredAgents
  ) {
    for (
      const route of
      source.routes
    ) {
      if (
        !route.enabled ||
        !route.targetAgentId
      ) {
        continue;
      }

      const target =
        agentsById.get(
          route.targetAgentId,
        );

      if (
        target &&
        !target.enabled
      ) {
        issues.push({
          code:
            "enabled_route_targets_disabled_agent",
          severity:
            "warning",
          sourceAgentId:
            source.id,
          routeId:
            route.id,
          targetAgentId:
            target.id,
          message:
            `${source.name} has an enabled ${route.outcome} route targeting disabled agent ${target.name}. Future workflow snapshots will omit this route until the target is enabled or the route is changed.`,
        });
      }
    }
  }

  return issues;
}

/**
 * Determines whether a recent persisted domain event belongs in the Agents operator feed.
 */
function isAgentMonitoringEvent(
  event: DomainEvent,
): boolean {
  return [
    "agent.started",
    "result.received",
    "workflow.transition",
    "route.selected",
  ].includes(event.type);
}

/**
 * Returns the whole Agents page read model without changing workflow or CRUD semantics.
 */
export async function listAgentMonitoringOverview(
  range:
    AgentMonitoringRange,
): Promise<AgentMonitoringOverview> {
  const cutoff =
    rangeCutoff(range);

  const [
    configuredAgents,
    activeRows,
    resultRows,
    recentEventWindow,
  ] = await Promise.all([
    listAgentConfigurations(),
    db
      .select({
        id:
          agentExecutions.id,
        runId:
          agentExecutions.runId,
      })
      .from(agentExecutions)
      .where(
        inArray(
          agentExecutions.status,
          [
            ...ACTIVE_EXECUTION_STATUSES,
          ],
        ),
      ),
    db
      .select({
        resultStatus:
          agentExecutions.resultStatus,
      })
      .from(agentExecutions)
      .where(
        gte(
          agentExecutions.createdAt,
          cutoff,
        ),
      ),
    listRecentEvents(30),
  ]);

  const routeRules =
    configuredAgents.flatMap(
      (agent) =>
        agent.routes,
    );

  const approvedResults =
    resultRows.filter(
      (row) =>
        row.resultStatus ===
        "approved",
    ).length;

  const changesRequestedResults =
    resultRows.filter(
      (row) =>
        row.resultStatus ===
        "changes_requested",
    ).length;

  return {
    range,
    agents:
      configuredAgents,
    metrics: {
      totalAgents:
        configuredAgents.length,
      enabledAgents:
        configuredAgents.filter(
          (agent) =>
            agent.enabled,
        ).length,
      layers:
        new Set(
          configuredAgents.map(
            (agent) =>
              agent.layer,
          ),
        ).size,
      activeExecutions:
        activeRows.length,
      activeRuns:
        new Set(
          activeRows.map(
            (row) =>
              row.runId,
          ),
        ).size,
      enabledRouteRules:
        routeRules.filter(
          (route) =>
            route.enabled,
        ).length,
      approvedResults,
      changesRequestedResults,
    },
    validationIssues:
      findValidationIssues(
        configuredAgents,
      ),
    recentEvents:
      recentEventWindow
        .filter(
          isAgentMonitoringEvent,
        )
        .slice(0, 8),
  };
}

/**
 * Returns persisted and currently observable telemetry for one current agent configuration.
 */
export async function getAgentObservability(
  agentId: string,
  range:
    AgentMonitoringRange,
): Promise<
  AgentObservability | null
> {
  const [existingAgent] =
    await db
      .select({
        id: agents.id,
      })
      .from(agents)
      .where(
        eq(
          agents.id,
          agentId,
        ),
      )
      .limit(1);

  if (!existingAgent) {
    return null;
  }

  const cutoff =
    rangeCutoff(range);

  const executionRows =
    await db
      .select()
      .from(agentExecutions)
      .where(
        and(
          eq(
            agentExecutions.agentId,
            agentId,
          ),
          or(
            gte(
              agentExecutions.createdAt,
              cutoff,
            ),
            inArray(
              agentExecutions.status,
              [
                ...ACTIVE_EXECUTION_STATUSES,
              ],
            ),
          ),
        ),
      )
      .orderBy(
        desc(
          agentExecutions.createdAt,
        ),
      );

  const activeRows =
    executionRows.filter(
      (row) =>
        ACTIVE_EXECUTION_STATUSES.includes(
          row.status as
            (typeof ACTIVE_EXECUTION_STATUSES)[number],
        ),
    );

  const resultRows =
    executionRows.filter(
      (row) =>
        row.resultStatus !==
        null,
    );

  const durations =
    executionRows
      .map(
        executionDurationMs,
      )
      .filter(
        (
          value,
        ): value is number =>
          value !== null,
      );

  const tokenTotals =
    executionRows
      .map((row) =>
        totalTokensFromUsage(
          row.tokenUsage,
        ),
      )
      .filter(
        (
          value,
        ): value is number =>
          value !== null,
      );

  let contextUsagePercent:
    number | null = null;

  let contextTelemetryExecutions =
    0;

  for (
    const row of
    executionRows
  ) {
    const percent =
      contextPercentFromUsage(
        row.contextUsage,
      );

    if (percent === null) {
      continue;
    }

    contextTelemetryExecutions +=
      1;

    if (
      contextUsagePercent ===
      null
    ) {
      contextUsagePercent =
        percent;
    }
  }

  const executionIds =
    executionRows.map(
      (row) => row.id,
    );

  const dataMatch =
    or(
      sql`${domainEvents.data} ->> 'agentId' = ${agentId}`,
      sql`${domainEvents.data} ->> 'sourceAgentId' = ${agentId}`,
      sql`${domainEvents.data} ->> 'targetAgentId' = ${agentId}`,
    );

  const eventCondition =
    executionIds.length > 0
      ? or(
          dataMatch,
          inArray(
            domainEvents.agentExecutionId,
            executionIds,
          ),
        )
      : dataMatch;

  const eventRows =
    await db
      .select()
      .from(domainEvents)
      .where(eventCondition)
      .orderBy(
        desc(
          domainEvents.createdAt,
        ),
      )
      .limit(8);

  const latestExitCode =
    executionRows.find(
      (row) =>
        row.exitCode !== null,
    )?.exitCode ?? null;

  const lastCommitHash =
    executionRows.find(
      (row) =>
        row.commitHash !== null,
    )?.commitHash ?? null;

  const activeExecution =
    activeRows[0] ?? null;

  return {
    agentId,
    range,
    totalExecutions:
      executionRows.length,
    activeExecutionCount:
      activeRows.length,
    successfulResults:
      resultRows.filter(
        (row) =>
          row.resultStatus ===
            "completed" ||
          row.resultStatus ===
            "approved",
      ).length,
    resultCount:
      resultRows.length,
    approvedResults:
      resultRows.filter(
        (row) =>
          row.resultStatus ===
          "approved",
      ).length,
    changesRequestedResults:
      resultRows.filter(
        (row) =>
          row.resultStatus ===
          "changes_requested",
      ).length,
    averageDurationMs:
      average(durations),
    averageTokens:
      average(tokenTotals),
    tokenTelemetryExecutions:
      tokenTotals.length,
    contextUsagePercent,
    contextTelemetryExecutions,
    latestExitCode,
    lastActiveRunId:
      executionRows[0]
        ?.runId ?? null,
    lastCommitHash,
    activeExecution:
      activeExecution
        ? serializeRecentExecution(
            activeExecution,
          )
        : null,
    recentExecutions:
      executionRows
        .slice(0, 6)
        .map(
          serializeRecentExecution,
        ),
    activityBuckets:
      buildActivityBuckets(
        executionRows,
        cutoff,
      ),
    tokenBuckets:
      buildTokenBuckets(
        executionRows,
        cutoff,
      ),
    recentEvents:
      eventRows.map(
        serializeEvent,
      ),
  };
}
