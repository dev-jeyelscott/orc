import type {
  AgentExecution,
  RunMonitoringDetail,
  RunMonitoringSummary,
} from "@orc/shared";

import {
  isRunActive,
  selectPreferredExecutionId,
} from "./run-detail-state";

export const IDLE_RUN_THRESHOLD_MS =
  60_000;

interface IdleEligibilityInput {
  now: number;
  lastActivityAt: number;
  visibilityState:
    DocumentVisibilityState;
  thresholdMs?: number;
}

interface IdleDialogTransitionInput {
  monitoringSucceeded:
    boolean;
  openRunId:
    | string
    | null;
  activeRunId:
    | string
    | null;
  idleEligible:
    boolean;
}

/**
 * Determines whether dashboard inactivity currently permits an automatic dialog open.
 */
export function isIdleRunEligible({
  now,
  lastActivityAt,
  visibilityState,
  thresholdMs =
    IDLE_RUN_THRESHOLD_MS,
}: IdleEligibilityInput): boolean {
  if (
    visibilityState !==
    "visible"
  ) {
    return false;
  }

  return (
    now -
      lastActivityAt >=
    thresholdMs
  );
}

/**
 * Selects the persisted active run while preserving the monitoring API's newest-first order.
 */
export function selectActiveRun(
  runs:
    RunMonitoringSummary[],
): RunMonitoringSummary | null {
  return (
    runs.find(
      (run) =>
        isRunActive(
          run.status,
        ),
    ) ?? null
  );
}

/**
 * Selects the execution that the idle terminal and inspector must display together.
 */
export function selectIdleRunExecution(
  detail:
    RunMonitoringDetail,
): AgentExecution | null {
  const executionId =
    selectPreferredExecutionId(
      detail.executions,
    );

  if (!executionId) {
    return null;
  }

  return (
    detail.executions.find(
      (execution) =>
        execution.id ===
        executionId,
    ) ?? null
  );
}

/**
 * Resolves the next dialog run without treating monitoring failures as lifecycle transitions.
 */
export function nextIdleDialogRunId({
  monitoringSucceeded,
  openRunId,
  activeRunId,
  idleEligible,
}: IdleDialogTransitionInput):
  | string
  | null {
  if (
    !monitoringSucceeded
  ) {
    return openRunId;
  }

  if (!activeRunId) {
    return null;
  }

  if (
    openRunId ===
    activeRunId
  ) {
    return openRunId;
  }

  return idleEligible
    ? activeRunId
    : null;
}
