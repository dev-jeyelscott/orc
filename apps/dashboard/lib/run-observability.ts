import type {
  AgentExecution,
  DomainEvent,
  RunMonitoringDetail,
  RunMonitoringSummary,
  WorkflowPlanAgent,
} from "@orc/shared";

export const RUN_STATUS_FILTERS = [
  "all",
  "running",
  "pending",
  "completed",
  "failed",
  "blocked",
  "cancelled",
] as const;

export type RunStatusFilter =
  (typeof RUN_STATUS_FILTERS)[number];

export const RUN_TIME_RANGE_OPTIONS = [
  {
    value: "1h",
    label: "Last 1 hour",
    milliseconds:
      60 * 60 * 1000,
  },
  {
    value: "6h",
    label: "Last 6 hours",
    milliseconds:
      6 * 60 * 60 * 1000,
  },
  {
    value: "24h",
    label: "Last 24 hours",
    milliseconds:
      24 * 60 * 60 * 1000,
  },
  {
    value: "7d",
    label: "Last 7 days",
    milliseconds:
      7 * 24 * 60 * 60 * 1000,
  },
] as const;

export type RunTimeRange =
  (typeof RUN_TIME_RANGE_OPTIONS)[number]["value"];

export type RunMetrics = {
  running: number;
  pending: number;
  successRate: number | null;
  failedBlocked: number;
  medianDurationMs:
    | number
    | null;
};

export type NormalizedTokenUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  cachedTokens: number | null;
  totalTokens: number | null;
};

export type NormalizedContextUsage = {
  percent: number;
  usedTokens: number | null;
  limitTokens: number | null;
};

export type AggregatedRunUsage = {
  tokens:
    | NormalizedTokenUsage
    | null;
  context:
    | NormalizedContextUsage
    | null;
  tokenTelemetryPartial: boolean;
  contextTelemetryPartial: boolean;
};

export type WorkflowStepState =
  | "waiting"
  | "running"
  | "completed"
  | "failed"
  | "blocked"
  | "cancelled";

export type WorkflowStep =
  WorkflowPlanAgent & {
    state: WorkflowStepState;
    attemptCount: number;
    latestExecution:
      | AgentExecution
      | null;
    outcome: string;
    durationMs:
      | number
      | null;
  };

export type RunChartBucket = {
  label: string;
  count: number;
};

/**
 * Resolves the configured duration for one monitoring time range.
 */
function rangeMilliseconds(
  range: RunTimeRange,
): number {
  return (
    RUN_TIME_RANGE_OPTIONS.find(
      (option) =>
        option.value === range,
    )?.milliseconds ??
    RUN_TIME_RANGE_OPTIONS[0]
      .milliseconds
  );
}

/**
 * Returns active runs plus historical runs created inside the selected time range.
 *
 * Active runs are intentionally retained even when they started before the range so the
 * operator never loses sight of currently running work.
 */
export function scopeRunsByTime(
  runs: RunMonitoringSummary[],
  range: RunTimeRange,
  now = Date.now(),
): RunMonitoringSummary[] {
  const cutoff =
    now -
    rangeMilliseconds(range);

  return runs.filter((run) => {
    if (
      run.status === "running" ||
      run.status === "pending"
    ) {
      return true;
    }

    const createdAt =
      Date.parse(run.createdAt);

    return (
      Number.isFinite(
        createdAt,
      ) &&
      createdAt >= cutoff
    );
  });
}

/**
 * Filters run summaries by operator search text and explicit run status.
 */
export function filterRunSummaries(
  runs: RunMonitoringSummary[],
  search: string,
  status: RunStatusFilter,
): RunMonitoringSummary[] {
  const query =
    search.trim().toLowerCase();

  return runs.filter((run) => {
    if (
      status !== "all" &&
      run.status !== status
    ) {
      return false;
    }

    if (!query) {
      return true;
    }

    return [
      run.id,
      run.taskId ?? "",
      run.taskTitle ?? "",
      run.projectPath,
      run.currentAgent?.name ??
        "",
      run.currentAgent?.role ??
        "",
    ].some((value) =>
      value
        .toLowerCase()
        .includes(query),
    );
  });
}

/**
 * Calculates operator metrics from persisted run lifecycle state.
 *
 * Success rate is exactly:
 * completed / (completed + failed + blocked)
 *
 * Cancelled runs are excluded because an operator cancellation is neither a workflow
 * success nor a workflow failure.
 */
export function calculateRunMetrics(
  runs: RunMonitoringSummary[],
): RunMetrics {
  const running =
    runs.filter(
      (run) =>
        run.status ===
        "running",
    ).length;

  const pending =
    runs.filter(
      (run) =>
        run.status ===
        "pending",
    ).length;

  const completed =
    runs.filter(
      (run) =>
        run.status ===
        "completed",
    ).length;

  const failed =
    runs.filter(
      (run) =>
        run.status ===
        "failed",
    ).length;

  const blocked =
    runs.filter(
      (run) =>
        run.status ===
        "blocked",
    ).length;

  const denominator =
    completed +
    failed +
    blocked;

  const durations =
    runs
      .filter((run) =>
        [
          "completed",
          "failed",
          "blocked",
          "cancelled",
        ].includes(
          run.status,
        ),
      )
      .map((run) => {
        const start =
          Date.parse(
            run.createdAt,
          );

        const end =
          Date.parse(
            run.updatedAt,
          );

        return end - start;
      })
      .filter(
        (duration) =>
          Number.isFinite(
            duration,
          ) &&
          duration >= 0,
      )
      .sort(
        (left, right) =>
          left - right,
      );

  return {
    running,
    pending,
    successRate:
      denominator > 0
        ? (completed /
            denominator) *
          100
        : null,
    failedBlocked:
      failed + blocked,
    medianDurationMs:
      median(durations),
  };
}

/**
 * Returns the median of an already sorted or unsorted numeric sample.
 */
function median(
  values: number[],
): number | null {
  if (!values.length) {
    return null;
  }

  const ordered =
    [...values].sort(
      (left, right) =>
        left - right,
    );

  const middle =
    Math.floor(
      ordered.length / 2,
    );

  if (
    ordered.length % 2 ===
    1
  ) {
    return ordered[middle];
  }

  return (
    (ordered[middle - 1] +
      ordered[middle]) /
    2
  );
}

/**
 * Reads the first trustworthy finite non-negative numeric value from a telemetry record.
 */
function readNumber(
  record:
    | Record<
        string,
        unknown
      >
    | null,
  keys: string[],
): number | null {
  if (!record) {
    return null;
  }

  for (const key of keys) {
    const value =
      record[key];

    if (
      typeof value ===
        "number" &&
      Number.isFinite(value) &&
      value >= 0
    ) {
      return value;
    }
  }

  return null;
}

/**
 * Normalizes only recognized token usage fields and fails closed for unknown provider shapes.
 */
export function normalizeTokenUsage(
  usage:
    | Record<
        string,
        unknown
      >
    | null,
): NormalizedTokenUsage | null {
  if (!usage) {
    return null;
  }

  const inputTokens =
    readNumber(usage, [
      "input_tokens",
      "inputTokens",
    ]);

  const outputTokens =
    readNumber(usage, [
      "output_tokens",
      "outputTokens",
    ]);

  const cachedTokens =
    readNumber(usage, [
      "cached_input_tokens",
      "cache_read_input_tokens",
      "cachedTokens",
    ]);

  const reportedTotal =
    readNumber(usage, [
      "total_tokens",
      "totalTokens",
    ]);

  const hasInputOrOutput =
    inputTokens !== null ||
    outputTokens !== null;

  const totalTokens =
    reportedTotal ??
    (hasInputOrOutput
      ? (inputTokens ?? 0) +
        (outputTokens ?? 0)
      : null);

  if (
    inputTokens === null &&
    outputTokens === null &&
    cachedTokens === null &&
    totalTokens === null
  ) {
    return null;
  }

  return {
    inputTokens,
    outputTokens,
    cachedTokens,
    totalTokens,
  };
}

/**
 * Normalizes context usage only when persisted telemetry exposes a percentage or a used/limit pair.
 */
export function normalizeContextUsage(
  usage:
    | Record<
        string,
        unknown
      >
    | null,
): NormalizedContextUsage | null {
  if (!usage) {
    return null;
  }

  const usedTokens =
    readNumber(usage, [
      "used_tokens",
      "usedTokens",
      "context_tokens",
      "contextTokens",
    ]);

  const limitTokens =
    readNumber(usage, [
      "limit_tokens",
      "limitTokens",
      "context_window",
      "contextWindow",
    ]);

  const reportedPercent =
    readNumber(usage, [
      "percent",
      "percentage",
      "percent_used",
      "percentUsed",
    ]);

  const calculatedPercent =
    usedTokens !== null &&
    limitTokens !== null &&
    limitTokens > 0
      ? (usedTokens /
          limitTokens) *
        100
      : null;

  const percent =
    reportedPercent ??
    calculatedPercent;

  if (percent === null) {
    return null;
  }

  return {
    percent: Math.min(
      100,
      Math.max(
        0,
        percent,
      ),
    ),
    usedTokens,
    limitTokens,
  };
}

/**
 * Aggregates reliable persisted usage fields across executions without inventing missing telemetry.
 */
export function aggregateRunUsage(
  executions: AgentExecution[],
): AggregatedRunUsage {
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedTokens = 0;
  let totalTokens = 0;

  let inputSeen = false;
  let outputSeen = false;
  let cachedSeen = false;
  let totalSeen = false;

  let tokenTelemetryCount = 0;
  let contextTelemetryCount = 0;

  let highestContext:
    | NormalizedContextUsage
    | null = null;

  for (
    const execution of
    executions
  ) {
    const tokens =
      normalizeTokenUsage(
        execution.tokenUsage,
      );

    if (tokens) {
      tokenTelemetryCount += 1;

      if (
        tokens.inputTokens !==
        null
      ) {
        inputSeen = true;
        inputTokens +=
          tokens.inputTokens;
      }

      if (
        tokens.outputTokens !==
        null
      ) {
        outputSeen = true;
        outputTokens +=
          tokens.outputTokens;
      }

      if (
        tokens.cachedTokens !==
        null
      ) {
        cachedSeen = true;
        cachedTokens +=
          tokens.cachedTokens;
      }

      if (
        tokens.totalTokens !==
        null
      ) {
        totalSeen = true;
        totalTokens +=
          tokens.totalTokens;
      }
    }

    const context =
      normalizeContextUsage(
        execution.contextUsage,
      );

    if (context) {
      contextTelemetryCount += 1;

      if (
        !highestContext ||
        context.percent >
          highestContext.percent
      ) {
        highestContext =
          context;
      }
    }
  }

  const tokens =
    inputSeen ||
    outputSeen ||
    cachedSeen ||
    totalSeen
      ? {
          inputTokens:
            inputSeen
              ? inputTokens
              : null,
          outputTokens:
            outputSeen
              ? outputTokens
              : null,
          cachedTokens:
            cachedSeen
              ? cachedTokens
              : null,
          totalTokens:
            totalSeen
              ? totalTokens
              : null,
        }
      : null;

  return {
    tokens,
    context:
      highestContext,
    tokenTelemetryPartial:
      executions.length > 0 &&
      tokenTelemetryCount <
        executions.length,
    contextTelemetryPartial:
      executions.length > 0 &&
      contextTelemetryCount <
        executions.length,
  };
}

/**
 * Determines whether one historical execution belongs to one immutable workflow-plan agent.
 */
function executionMatchesAgent(
  execution: AgentExecution,
  agent: WorkflowPlanAgent,
): boolean {
  if (execution.agentId) {
    return (
      execution.agentId ===
      agent.id
    );
  }

  return (
    execution.agentName ===
      agent.name &&
    execution.agentRole ===
      agent.role &&
    execution.layer ===
      agent.layer &&
    execution.executionOrder ===
      agent.executionOrder
  );
}

/**
 * Calculates elapsed execution time using completed time when available and current time for active work.
 */
export function executionDurationMs(
  execution: AgentExecution,
  now = Date.now(),
): number | null {
  if (!execution.startedAt) {
    return null;
  }

  const start =
    Date.parse(
      execution.startedAt,
    );

  const end =
    execution.completedAt
      ? Date.parse(
          execution.completedAt,
        )
      : [
            "starting",
            "running",
          ].includes(
            execution.status,
          )
        ? now
        : Date.parse(
            execution.updatedAt,
          );

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end < start
  ) {
    return null;
  }

  return end - start;
}

/**
 * Maps one real execution lifecycle status onto the compact workflow-pipeline state.
 */
function workflowStepState(
  execution:
    | AgentExecution
    | null,
  isCurrentAgent: boolean,
  runStatus:
    RunMonitoringDetail["run"]["status"],
): WorkflowStepState {
  if (
    isCurrentAgent &&
    runStatus === "running" &&
    !execution
  ) {
    return "running";
  }

  if (!execution) {
    return "waiting";
  }

  switch (execution.status) {
    case "starting":
    case "running":
      return "running";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "blocked":
      return "blocked";
    case "cancelled":
      return "cancelled";
    case "pending":
    default:
      return "waiting";
  }
}

/**
 * Derives pipeline state from immutable planned agents and real persisted execution attempts.
 */
export function deriveWorkflowSteps(
  detail: RunMonitoringDetail,
  now = Date.now(),
): WorkflowStep[] {
  return detail.executionPlan.map(
    (agent) => {
      const attempts =
        detail.executions
          .filter(
            (execution) =>
              executionMatchesAgent(
                execution,
                agent,
              ),
          )
          .sort(
            (left, right) =>
              Date.parse(
                left.createdAt,
              ) -
              Date.parse(
                right.createdAt,
              ),
          );

      const latestExecution =
        attempts[
          attempts.length - 1
        ] ?? null;

      const isCurrentAgent =
        detail.run
          .currentAgentId ===
        agent.id;

      return {
        ...agent,
        state:
          workflowStepState(
            latestExecution,
            isCurrentAgent,
            detail.run.status,
          ),
        attemptCount:
          attempts.length,
        latestExecution,
        outcome:
          latestExecution
            ?.resultStatus ??
          latestExecution
            ?.status ??
          "waiting",
        durationMs:
          latestExecution
            ? executionDurationMs(
                latestExecution,
                now,
              )
            : null,
      };
    },
  );
}

/**
 * Resolves a snapshot agent ID into an operator-readable name.
 */
function agentNameForId(
  executionPlan:
    WorkflowPlanAgent[],
  id: unknown,
): string | null {
  if (
    typeof id !== "string"
  ) {
    return null;
  }

  return (
    executionPlan.find(
      (agent) =>
        agent.id === id,
    )?.name ?? null
  );
}

/**
 * Returns a concise description for a persisted business event without assuming fixed worker roles.
 */
export function describeDomainEvent(
  event: DomainEvent,
  executionPlan:
    WorkflowPlanAgent[],
  executions: AgentExecution[],
): string {
  if (
    event.type ===
    "run.started"
  ) {
    const title =
      event.data.title;

    return typeof title ===
      "string"
      ? title
      : "Run started";
  }

  if (
    event.type ===
    "agent.started"
  ) {
    const name =
      agentNameForId(
        executionPlan,
        event.data.agentId,
      );

    return name
      ? `${name} started`
      : "Agent started";
  }

  if (
    event.type ===
    "result.received"
  ) {
    const execution =
      executions.find(
        (candidate) =>
          candidate.id ===
          event.agentExecutionId,
      );

    const status =
      typeof event.data.status ===
      "string"
        ? formatStatusLabel(
            event.data.status,
          )
        : "Result received";

    return execution
      ? `${execution.agentName}: ${status}`
      : status;
  }

  if (
    event.type ===
    "workflow.transition"
  ) {
    const source =
      agentNameForId(
        executionPlan,
        event.data
          .sourceAgentId,
      ) ??
      "Previous agent";

    const target =
      agentNameForId(
        executionPlan,
        event.data
          .targetAgentId,
      );

    if (target) {
      return `${source} -> ${target}`;
    }

    const terminalAction =
      event.data
        .terminalAction;

    return typeof terminalAction ===
      "string"
      ? `${source} -> ${formatStatusLabel(
          terminalAction,
        )}`
      : "Workflow transition";
  }

  if (
    event.type.startsWith(
      "run.",
    )
  ) {
    const reason =
      event.data.reason;

    return typeof reason ===
      "string" &&
      reason.length > 0
      ? reason
      : formatStatusLabel(
          event.type.slice(4),
        );
  }

  return formatStatusLabel(
    event.type,
  );
}

/**
 * Returns the latest persisted failure or terminal reason for an operator summary.
 */
export function findLatestFailure(
  detail: RunMonitoringDetail,
): string | null {
  if (
    detail.run.terminalReason
  ) {
    return detail.run
      .terminalReason;
  }

  const execution =
    [...detail.executions]
      .reverse()
      .find(
        (candidate) =>
          Boolean(
            candidate.failureReason,
          ),
      );

  return (
    execution?.failureReason ??
    null
  );
}

/**
 * Builds fixed time buckets for the Runs over time chart using persisted run creation timestamps.
 */
export function buildRunsOverTime(
  runs: RunMonitoringSummary[],
  range: RunTimeRange,
  now = Date.now(),
  bucketCount = 20,
): RunChartBucket[] {
  const duration =
    rangeMilliseconds(range);

  const start =
    now - duration;

  const bucketDuration =
    duration / bucketCount;

  const counts =
    Array.from(
      {
        length:
          bucketCount,
      },
      () => 0,
    );

  for (const run of runs) {
    const createdAt =
      Date.parse(
        run.createdAt,
      );

    if (
      !Number.isFinite(
        createdAt,
      ) ||
      createdAt < start ||
      createdAt > now
    ) {
      continue;
    }

    const index =
      Math.min(
        bucketCount - 1,
        Math.floor(
          (createdAt -
            start) /
            bucketDuration,
        ),
      );

    counts[index] += 1;
  }

  return counts.map(
    (count, index) => ({
      count,
      label:
        bucketLabel(
          index,
          bucketCount,
          bucketDuration,
        ),
    }),
  );
}

/**
 * Formats one chart bucket as a relative operator timestamp.
 */
function bucketLabel(
  index: number,
  bucketCount: number,
  bucketDuration: number,
): string {
  const bucketsFromNow =
    bucketCount -
    1 -
    index;

  if (
    bucketsFromNow === 0
  ) {
    return "Now";
  }

  const distance =
    bucketsFromNow *
    bucketDuration;

  const day =
    24 * 60 * 60 * 1000;

  const hour =
    60 * 60 * 1000;

  const minute =
    60 * 1000;

  if (distance >= day) {
    return `${Math.round(
      distance / day,
    )}d`;
  }

  if (distance >= hour) {
    return `${Math.round(
      distance / hour,
    )}h`;
  }

  return `${Math.max(
    1,
    Math.round(
      distance / minute,
    ),
  )}m`;
}

/**
 * Formats a duration for compact dashboard display.
 */
export function formatDuration(
  milliseconds:
    | number
    | null,
): string {
  if (
    milliseconds === null ||
    !Number.isFinite(
      milliseconds,
    )
  ) {
    return "Unavailable";
  }

  const seconds =
    Math.max(
      0,
      Math.floor(
        milliseconds /
          1000,
      ),
    );

  const days =
    Math.floor(
      seconds / 86_400,
    );

  const hours =
    Math.floor(
      (seconds %
        86_400) /
        3_600,
    );

  const minutes =
    Math.floor(
      (seconds %
        3_600) /
        60,
    );

  const remainder =
    seconds % 60;

  if (days > 0) {
    return `${days}d ${hours}h`;
  }

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${remainder}s`;
  }

  return `${remainder}s`;
}

/**
 * Formats an ISO timestamp relative to the supplied current time.
 */
export function formatRelativeTime(
  value: string,
  now = Date.now(),
): string {
  const timestamp =
    Date.parse(value);

  if (
    !Number.isFinite(
      timestamp,
    )
  ) {
    return "Unavailable";
  }

  const elapsed =
    Math.max(
      0,
      now - timestamp,
    );

  const seconds =
    Math.floor(
      elapsed / 1000,
    );

  if (seconds < 60) {
    return `${seconds}s ago`;
  }

  const minutes =
    Math.floor(
      seconds / 60,
    );

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours =
    Math.floor(
      minutes / 60,
    );

  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days =
    Math.floor(
      hours / 24,
    );

  return `${days}d ago`;
}

/**
 * Formats one persisted timestamp using the browser's local timezone.
 */
export function formatDateTime(
  value:
    | string
    | null,
): string {
  if (!value) {
    return "Unavailable";
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return "Unavailable";
  }

  return new Intl.DateTimeFormat(
    undefined,
    {
      dateStyle: "medium",
      timeStyle: "medium",
    },
  ).format(date);
}

/**
 * Formats large counters without claiming more precision than the UI needs.
 */
export function formatCompactNumber(
  value:
    | number
    | null,
): string {
  if (value === null) {
    return "Unavailable";
  }

  return new Intl.NumberFormat(
    undefined,
    {
      notation: "compact",
      maximumFractionDigits: 1,
    },
  ).format(value);
}

/**
 * Converts persisted status or event identifiers into readable labels.
 */
export function formatStatusLabel(
  value: string,
): string {
  return value
    .replaceAll(
      /[._-]+/g,
      " ",
    )
    .replace(
      /\b\w/g,
      (character) =>
        character.toUpperCase(),
    );
}

/**
 * Returns the project directory name from a persisted absolute project path.
 */
export function projectNameFromPath(
  projectPath: string,
): string {
  const segments =
    projectPath
      .split("/")
      .filter(Boolean);

  return (
    segments[
      segments.length - 1
    ] ?? projectPath
  );
}

/**
 * Shortens a UUID or commit identifier without changing its persisted value.
 */
export function shortIdentifier(
  value:
    | string
    | null,
  length = 8,
): string {
  if (!value) {
    return "Unavailable";
  }

  return value.slice(
    0,
    length,
  );
}
