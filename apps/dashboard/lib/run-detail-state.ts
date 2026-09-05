import type {
  AgentExecution,
  RunMonitoringDetail,
} from "@orc/shared";

import {
  formatStatusLabel,
} from "./run-observability";

export type RunBadgeVariant =
  | "running"
  | "success"
  | "warning"
  | "error"
  | "neutral";

const ACTIVE_EXECUTION_STATUSES =
  new Set<AgentExecution["status"]>([
    "starting",
    "running",
  ]);

/**
 * Converts one persisted execution creation timestamp into a stable sortable number.
 */
function executionTimestamp(
  execution: AgentExecution,
): number {
  const value =
    Date.parse(
      execution.createdAt,
    );

  return Number.isFinite(
    value,
  )
    ? value
    : 0;
}

/**
 * Returns executions in deterministic persisted creation order without mutating input.
 */
function orderedExecutions(
  executions: AgentExecution[],
): AgentExecution[] {
  return [
    ...executions,
  ].sort(
    (
      left,
      right,
    ) =>
      executionTimestamp(
        left,
      ) -
      executionTimestamp(
        right,
      ),
  );
}

/**
 * Returns the newest starting or running execution when one exists.
 */
function latestActiveExecution(
  executions: AgentExecution[],
): AgentExecution | null {
  const ordered =
    orderedExecutions(
      executions,
    );

  for (
    let index =
      ordered.length - 1;
    index >= 0;
    index -= 1
  ) {
    if (
      ACTIVE_EXECUTION_STATUSES.has(
        ordered[index].status,
      )
    ) {
      return ordered[index];
    }
  }

  return null;
}

/**
 * Maps persisted run state onto shared semantic badge variants.
 */
export function runStatusVariant(
  status:
    RunMonitoringDetail["run"]["status"],
): RunBadgeVariant {
  switch (status) {
    case "running":
      return "running";
    case "completed":
      return "success";
    case "pending":
    case "blocked":
      return "warning";
    case "failed":
      return "error";
    case "cancelled":
    default:
      return "neutral";
  }
}

/**
 * Returns whether the persisted run currently supports cancellation.
 */
export function isRunActive(
  status:
    RunMonitoringDetail["run"]["status"],
): boolean {
  return (
    status === "pending" ||
    status === "running"
  );
}

/**
 * Returns whether the persisted run currently supports the existing retry flow.
 */
export function isRunRetryable(
  status:
    RunMonitoringDetail["run"]["status"],
): boolean {
  return (
    status === "failed" ||
    status === "blocked"
  );
}

/**
 * Resolves the operator-facing current state from persisted run and execution state.
 */
export function currentRunStateLabel(
  detail: RunMonitoringDetail,
): string {
  const active =
    latestActiveExecution(
      detail.executions,
    );

  if (
    active?.status ===
    "starting"
  ) {
    return "Starting";
  }

  if (
    active?.status ===
    "running"
  ) {
    return "Executing";
  }

  return formatStatusLabel(
    detail.run.status,
  );
}

/**
 * Converts execution-attempt count into bounded configured-plan progress.
 */
export function executionProgress(
  executionCount: number,
  plannedExecutionCount: number,
): number {
  if (
    plannedExecutionCount <=
    0
  ) {
    return 0;
  }

  return Math.min(
    100,
    Math.max(
      0,
      (
        executionCount /
        plannedExecutionCount
      ) * 100,
    ),
  );
}

/**
 * Selects the active execution first, otherwise the latest persisted attempt.
 */
export function selectPreferredExecutionId(
  executions: AgentExecution[],
): string | null {
  const active =
    latestActiveExecution(
      executions,
    );

  if (active) {
    return active.id;
  }

  const ordered =
    orderedExecutions(
      executions,
    );

  return (
    ordered[
      ordered.length - 1
    ]?.id ?? null
  );
}

/**
 * Calculates persisted run duration only after the run reaches a terminal state.
 */
export function terminalRunDurationMs(
  run:
    RunMonitoringDetail["run"],
): number | null {
  if (
    isRunActive(
      run.status,
    )
  ) {
    return null;
  }

  const start =
    Date.parse(
      run.createdAt,
    );

  const end =
    Date.parse(
      run.updatedAt,
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
