import type {
  AgentExecution,
  Run,
  RunDetail,
} from "@orc/shared"

const ACTIVE_EXECUTION_STATUSES =
  new Set<AgentExecution["status"]>([
    "pending",
    "starting",
    "running",
  ])

const conversationTimeFormatter =
  new Intl.DateTimeFormat(
    undefined,
    {
      hour: "numeric",
      minute: "2-digit",
    },
  )

/** Returns whether the backend considers a run actively cancellable. */
export function isRunActive(
  status: Run["status"],
): boolean {
  return (
    status === "pending" ||
    status === "running"
  )
}

/** Returns whether the backend currently exposes retry for this terminal run state. */
export function isRunRetryable(
  status: Run["status"],
): boolean {
  return (
    status === "failed" ||
    status === "blocked"
  )
}

/** Selects the active execution, preferring the run's persisted current agent reference. */
export function selectActiveExecution(
  detail: RunDetail | null,
): AgentExecution | null {
  if (!detail) {
    return null
  }

  const activeExecutions =
    detail.executions.filter(
      (execution) =>
        ACTIVE_EXECUTION_STATUSES.has(
          execution.status,
        ),
    )

  if (
    detail.run.currentAgentId
  ) {
    const matchingExecution =
      [...activeExecutions]
        .reverse()
        .find(
          (execution) =>
            execution.agentId ===
            detail.run.currentAgentId,
        )

    if (matchingExecution) {
      return matchingExecution
    }
  }

  return (
    activeExecutions.at(-1) ??
    null
  )
}

/** Selects the execution whose terminal should be displayed, preferring the active worker. */
export function selectTerminalExecution(
  detail: RunDetail | null,
): AgentExecution | null {
  if (!detail) {
    return null
  }

  return (
    selectActiveExecution(detail) ??
    detail.executions.at(-1) ??
    null
  )
}

/** Selects the most recent execution containing a validated structured result. */
export function selectLatestResultExecution(
  detail: RunDetail | null,
): AgentExecution | null {
  if (!detail) {
    return null
  }

  return (
    [...detail.executions]
      .reverse()
      .find(
        (execution) =>
          execution.resultPayload !==
          null,
      ) ?? null
  )
}

/** Formats one persisted conversation timestamp into a compact chat timestamp. */
export function formatConversationTime(
  value: string,
): string {
  const parsed = new Date(value)

  if (
    Number.isNaN(
      parsed.getTime(),
    )
  ) {
    return "-"
  }

  return conversationTimeFormatter.format(
    parsed,
  )
}

/** Formats elapsed time from authoritative timestamps without estimating missing start time. */
export function formatElapsedTime(
  startedAt: string | null,
  completedAt: string | null,
  now: number,
): string {
  if (!startedAt) {
    return "-"
  }

  const start =
    Date.parse(startedAt)

  const end = completedAt
    ? Date.parse(completedAt)
    : now

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end < start
  ) {
    return "-"
  }

  const totalSeconds =
    Math.floor(
      (end - start) / 1000,
    )

  const hours = Math.floor(
    totalSeconds / 3600,
  )

  const minutes = Math.floor(
    (totalSeconds % 3600) /
      60,
  )

  const seconds =
    totalSeconds % 60

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`
  }

  return `${seconds}s`
}
