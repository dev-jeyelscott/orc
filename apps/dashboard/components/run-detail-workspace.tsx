"use client";

import Link from "next/link";
import type {
  ReactNode,
} from "react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  CircleAlertIcon,
  CircleDotIcon,
  CopyIcon,
  LoaderCircleIcon,
  RotateCcwIcon,
  SquareIcon,
} from "lucide-react";

import type {
  AgentExecution,
  RunMonitoringDetail,
} from "@orc/shared";

import { AgentExecutionTerminal } from "@/components/agent-execution-terminal";
import { RunEventTimeline } from "@/components/run-event-timeline";
import { RunExecutionInspector } from "@/components/run-execution-inspector";
import { RunExecutionsTable } from "@/components/run-executions-table";
import { RunInspectorDrawer } from "@/components/run-inspector-drawer";
import { RunWorkflowPipeline } from "@/components/run-workflow-pipeline";
import { Badge } from "@/components/ui/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  currentRunStateLabel,
  executionProgress,
  isRunActive,
  isRunRetryable,
  runStatusVariant,
  selectPreferredExecutionId,
  terminalRunDurationMs,
} from "@/lib/run-detail-state";
import {
  formatDuration,
  formatRelativeTime,
  formatStatusLabel,
  projectNameFromPath,
  shortIdentifier,
} from "@/lib/run-observability";
import {
  cancelRun,
  getRunMonitoringDetail,
  retryRun,
} from "@/lib/workflows";

const POLL_INTERVAL_MS =
  2_000;

type ActionPending =
  | "cancel"
  | "retry"
  | null;

interface DetailErrorState {
  runId: string;
  message: string;
}

interface RunHeaderProps {
  detail:
    RunMonitoringDetail;
  actionPending:
    ActionPending;
  onCancel: () => void;
  onRetry: () => void;
}

interface RunFactsStripProps {
  detail:
    RunMonitoringDetail;
  currentAgentName:
    string;
  currentLayer:
    number | null;
}

interface SummaryFactProps {
  label: string;
  value: string;
  mono?: boolean;
  title?: string;
  action?: ReactNode;
  detail?: ReactNode;
  className?: string;
}

interface WorkspaceStateProps {
  icon:
    ReactNode;
  title: string;
  message: string;
  action?: ReactNode;
}

/**
 * Converts an unknown monitoring failure into a concise operator-readable message.
 */
function errorMessage(
  error: unknown,
): string {
  return error instanceof
    Error
    ? error.message
    : "Unable to load run monitoring data";
}

/**
 * Determines whether one request failure was caused by intentional browser cancellation.
 */
function isAbortError(
  error: unknown,
): boolean {
  return (
    error instanceof
      DOMException &&
    error.name ===
      "AbortError"
  );
}

/**
 * Copies a persisted identifier without allowing optional clipboard access to break monitoring.
 */
async function copyText(
  value: string,
): Promise<void> {
  try {
    await navigator.clipboard.writeText(
      value,
    );
  } catch {
    // Clipboard support is optional and must not interrupt the operator workspace.
  }
}

/**
 * Returns the newest active execution used only for current-agent fallback presentation.
 */
function findActiveExecution(
  executions:
    AgentExecution[],
): AgentExecution | null {
  for (
    let index =
      executions.length -
      1;
    index >= 0;
    index -= 1
  ) {
    if (
      executions[index]
        .status ===
        "starting" ||
      executions[index]
        .status ===
        "running"
    ) {
      return executions[
        index
      ];
    }
  }

  return null;
}

/**
 * Renders the dedicated authoritative Run Detail operator workspace and owns page-level polling.
 */
export function RunDetailWorkspace({
  runId,
}: {
  runId: string;
}) {
  const [
    detailState,
    setDetailState,
  ] =
    useState<RunMonitoringDetail | null>(
      null,
    );

  const [
    detailErrorState,
    setDetailErrorState,
  ] =
    useState<DetailErrorState | null>(
      null,
    );

  const [
    actionErrorState,
    setActionErrorState,
  ] =
    useState<DetailErrorState | null>(
      null,
    );

  const [
    actionPending,
    setActionPending,
  ] =
    useState<ActionPending>(
      null,
    );

  const [
    selectedExecutionId,
    setSelectedExecutionId,
  ] =
    useState<string | null>(
      null,
    );

  const detailAbortRef =
    useRef<AbortController | null>(
      null,
    );

  /**
   * Loads the complete monitoring aggregate while cancelling any older page request.
   */
  const loadDetail =
    useCallback(
      async () => {
        detailAbortRef.current?.abort();

        const controller =
          new AbortController();

        detailAbortRef.current =
          controller;

        try {
          const value =
            await getRunMonitoringDetail(
              runId,
              controller.signal,
            );

          if (
            controller.signal
              .aborted
          ) {
            return;
          }

          setDetailState(
            value,
          );

          setDetailErrorState(
            null,
          );
        } catch (error) {
          if (
            !isAbortError(
              error,
            )
          ) {
            setDetailErrorState({
              runId,
              message:
                errorMessage(
                  error,
                ),
            });
          }
        }
      },
      [
        runId,
      ],
    );

  useEffect(() => {
    let disposed =
      false;

    queueMicrotask(
      () => {
        if (
          !disposed
        ) {
          void loadDetail();
        }
      },
    );

    return () => {
      disposed =
        true;

      detailAbortRef.current?.abort();
    };
  }, [
    loadDetail,
  ]);

  useEffect(() => {
    /**
     * Refreshes the monitoring aggregate only while this tab is visible.
     */
    function tick(): void {
      if (
        document.visibilityState ===
        "visible"
      ) {
        void loadDetail();
      }
    }

    /**
     * Immediately catches the page up when the operator returns to the tab.
     */
    function handleVisibility(): void {
      if (
        document.visibilityState ===
        "visible"
      ) {
        tick();
      }
    }

    const timer =
      window.setInterval(
        tick,
        POLL_INTERVAL_MS,
      );

    document.addEventListener(
      "visibilitychange",
      handleVisibility,
    );

    return () => {
      window.clearInterval(
        timer,
      );

      document.removeEventListener(
        "visibilitychange",
        handleVisibility,
      );
    };
  }, [
    loadDetail,
  ]);

  const detail =
    detailState?.run.id ===
    runId
      ? detailState
      : null;

  const detailError =
    detailErrorState?.runId ===
    runId
      ? detailErrorState.message
      : null;

  const actionError =
    actionErrorState?.runId ===
    runId
      ? actionErrorState.message
      : null;

  useEffect(() => {
    let disposed =
      false;

    queueMicrotask(
      () => {
        if (
          disposed
        ) {
          return;
        }

        setSelectedExecutionId(
          (
            current,
          ) => {
            if (
              detail &&
              current &&
              detail.executions.some(
                (
                  execution,
                ) =>
                  execution.id ===
                  current,
              )
            ) {
              return current;
            }

            return detail
              ? selectPreferredExecutionId(
                  detail.executions,
                )
              : null;
          },
        );
      },
    );

    return () => {
      disposed =
        true;
    };
  }, [
    detail,
  ]);

  const selectedExecution =
    useMemo(
      () =>
        detail?.executions.find(
          (
            execution,
          ) =>
            execution.id ===
            selectedExecutionId,
        ) ?? null,
      [
        detail,
        selectedExecutionId,
      ],
    );

  /**
   * Cancels an active run through the existing backend policy after explicit confirmation.
   */
  const handleCancel =
    useCallback(
      async () => {
        if (
          !window.confirm(
            "Cancel this active workflow?",
          )
        ) {
          return;
        }

        setActionPending(
          "cancel",
        );

        setActionErrorState(
          null,
        );

        try {
          await cancelRun(
            runId,
          );

          await loadDetail();
        } catch (error) {
          setActionErrorState({
            runId,
            message:
              errorMessage(
                error,
              ),
          });
        } finally {
          setActionPending(
            null,
          );
        }
      },
      [
        loadDetail,
        runId,
      ],
    );

  /**
   * Retries the final failed or blocked execution through the existing backend retry behavior.
   */
  const handleRetry =
    useCallback(
      async () => {
        setActionPending(
          "retry",
        );

        setActionErrorState(
          null,
        );

        try {
          await retryRun(
            runId,
          );

          await loadDetail();
        } catch (error) {
          setActionErrorState({
            runId,
            message:
              errorMessage(
                error,
              ),
          });
        } finally {
          setActionPending(
            null,
          );
        }
      },
      [
        loadDetail,
        runId,
      ],
    );

  if (
    !detail &&
    !detailError
  ) {
    return (
      <WorkspaceState
        icon={
          <LoaderCircleIcon className="size-5 animate-spin text-status-running motion-reduce:animate-none" />
        }
        title="Loading run"
        message="Reading persisted run, execution, workflow, and event state."
      />
    );
  }

  if (
    !detail &&
    detailError
  ) {
    return (
      <WorkspaceState
        icon={
          <CircleAlertIcon className="size-5 text-status-error" />
        }
        title="Unable to load run"
        message={
          detailError
        }
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              void loadDetail()
            }
          >
            Retry
          </Button>
        }
      />
    );
  }

  if (!detail) {
    return null;
  }

  const currentPlanAgent =
    detail.executionPlan.find(
      (
        agent,
      ) =>
        agent.id ===
        detail.run
          .currentAgentId,
    ) ?? null;

  const activeExecution =
    findActiveExecution(
      detail.executions,
    );

  const currentAgentName =
    currentPlanAgent?.name ??
    activeExecution
      ?.agentName ??
    "Unavailable";

  const currentLayer =
    currentPlanAgent?.layer ??
    activeExecution
      ?.layer ??
    null;

  return (
    <div
      aria-busy={
        actionPending !==
        null
      }
      className="flex min-w-0 flex-col gap-3 [--run-bottom-row:17rem] [--run-primary-row:30rem] min-[1536px]:[--run-primary-row:31rem]"
    >
      <RunHeader
        detail={
          detail
        }
        actionPending={
          actionPending
        }
        onCancel={() =>
          void handleCancel()
        }
        onRetry={() =>
          void handleRetry()
        }
      />

      {detailError ? (
        <div
          role="alert"
          className="flex min-h-8 items-center gap-2 rounded-md border border-status-warning/40 bg-status-warning/5 px-3 text-[10px] text-status-warning"
        >
          <CircleAlertIcon className="size-3.5 shrink-0" />
          Background
          refresh
          failed. Current
          persisted view
          remains visible.{" "}
          {detailError}
        </div>
      ) : null}

      {actionError ? (
        <div
          role="alert"
          className="flex min-h-8 items-center gap-2 rounded-md border border-status-error/40 bg-status-error/5 px-3 text-[10px] text-status-error"
        >
          <CircleAlertIcon className="size-3.5 shrink-0" />
          {
            actionError
          }
        </div>
      ) : null}

      <RunFactsStrip
        detail={
          detail
        }
        currentAgentName={
          currentAgentName
        }
        currentLayer={
          currentLayer
        }
      />

      <RunWorkflowPipeline
        detail={
          detail
        }
        dense
      />

      <div className="grid min-h-0 min-w-0 items-stretch gap-3 min-[1360px]:h-[var(--run-primary-row)] min-[1360px]:grid-cols-[minmax(0,3fr)_minmax(300px,1fr)]">
        <div className="min-h-0 min-w-0">
          {selectedExecution ? (
            <AgentExecutionTerminal
              executionId={
                selectedExecution.id
              }
              title={`${selectedExecution.agentName} Terminal`}
              subheader={
                <TerminalMetadata
                  execution={
                    selectedExecution
                  }
                />
              }
              className="h-full min-h-0"
              heightClassName="min-h-[26rem] flex-1 min-[1360px]:min-h-0"
            />
          ) : (
            <EmptyExecutionPanel />
          )}
        </div>

        <RunExecutionInspector
          execution={
            selectedExecution
          }
        />
      </div>

      <div className="grid min-h-0 min-w-0 items-stretch gap-3 min-[1360px]:h-[var(--run-bottom-row)] min-[1360px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <RunExecutionsTable
          executions={
            detail.executions
          }
          variant="operator"
          selectedExecutionId={
            selectedExecutionId
          }
          onSelectExecution={
            setSelectedExecutionId
          }
        />

        <RunEventTimeline
          detail={
            detail
          }
        />
      </div>
    </div>
  );
}

/**
 * Renders the compact breadcrumb, task title, persisted state, and valid run actions.
 */
function RunHeader({
  detail,
  actionPending,
  onCancel,
  onRetry,
}: RunHeaderProps) {
  const active =
    isRunActive(
      detail.run.status,
    );

  const retryable =
    isRunRetryable(
      detail.run.status,
    );

  return (
    <header className="flex min-w-0 flex-col gap-1.5">
      <Breadcrumb>
        <BreadcrumbList className="text-[11px]">
          <BreadcrumbItem>
            <BreadcrumbLink
              render={
                <Link href="/runs" />
              }
            >
              Runs
            </BreadcrumbLink>
          </BreadcrumbItem>

          <BreadcrumbSeparator />

          <BreadcrumbItem>
            <BreadcrumbPage className="font-mono text-[11px] font-medium text-text-primary">
              {shortIdentifier(
                detail.run.id,
              )}
            </BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="flex min-w-0 flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h1
            title={
              detail.task
                ?.title ??
              "Workflow run"
            }
            className="min-w-0 truncate font-heading text-lg font-semibold leading-7 text-text-primary"
          >
            {detail.task
              ?.title ??
              "Workflow run"}
          </h1>

          <Badge
            variant={runStatusVariant(
              detail.run
                .status,
            )}
            className="h-5 px-2 text-[10px]"
          >
            {formatStatusLabel(
              detail.run
                .status,
            )}
          </Badge>

          <span className="text-[11px] text-text-secondary">
            {currentRunStateLabel(
              detail,
            )}
          </span>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {active ? (
            <Button
              variant="destructive"
              size="sm"
              disabled={
                actionPending !==
                null
              }
              onClick={
                onCancel
              }
            >
              <SquareIcon className="size-3.5" />
              {actionPending ===
              "cancel"
                ? "Cancelling..."
                : "Cancel Run"}
            </Button>
          ) : null}

          {retryable ? (
            <Button
              variant="outline"
              size="sm"
              disabled={
                actionPending !==
                null
              }
              onClick={
                onRetry
              }
            >
              <RotateCcwIcon className="size-3.5" />
              {actionPending ===
              "retry"
                ? "Retrying..."
                : "Retry"}
            </Button>
          ) : null}

          <RunInspectorDrawer
            detail={
              detail
            }
          />
        </div>
      </div>
    </header>
  );
}

/**
 * Renders the single bounded equal-height run facts strip from authoritative persisted state.
 */
function RunFactsStrip({
  detail,
  currentAgentName,
  currentLayer,
}: RunFactsStripProps) {
  const planned =
    detail.executionPlan.length;

  const progress =
    executionProgress(
      detail.run
        .executionCount,
      planned,
    );

  const duration =
    terminalRunDurationMs(
      detail.run,
    );

  const finalLabel =
    duration !==
    null
      ? "Duration"
      : "Last Update";

  const finalValue =
    duration !==
    null
      ? formatDuration(
          duration,
        )
      : formatRelativeTime(
          detail.run
            .updatedAt,
        );

  const separator =
    "min-[1360px]:border-l min-[1360px]:border-divider";

  return (
    <section
      aria-label="Run summary"
      className="min-w-0 overflow-hidden rounded-lg border border-border-default bg-surface-card shadow-xs"
    >
      <dl className="grid min-w-0 sm:grid-cols-2 lg:grid-cols-4 min-[1360px]:grid-cols-7">
        <SummaryFact
          label="Project"
          value={projectNameFromPath(
            detail.run
              .projectPath,
          )}
        />

        <SummaryFact
          label="Path"
          value={
            detail.run
              .projectPath
          }
          title={
            detail.run
              .projectPath
          }
          mono
          className={
            separator
          }
        />

        <SummaryFact
          label="Run ID"
          value={shortIdentifier(
            detail.run.id,
          )}
          title={
            detail.run.id
          }
          mono
          action={
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label="Copy full run ID"
              title="Copy full run ID"
              onClick={() =>
                void copyText(
                  detail.run.id,
                )
              }
            >
              <CopyIcon className="size-3" />
            </Button>
          }
          className={
            separator
          }
        />

        <SummaryFact
          label="Current Agent"
          value={
            currentAgentName
          }
          title={
            currentAgentName
          }
          className={
            separator
          }
        />

        <SummaryFact
          label="Current Layer"
          value={
            currentLayer !==
            null
              ? `Layer ${currentLayer}`
              : "Unavailable"
          }
          className={
            separator
          }
        />

        <SummaryFact
          label="Progress"
          value={
            planned > 0
              ? `${detail.run.executionCount} / ${planned}`
              : `${detail.run.executionCount} attempts`
          }
          detail={
            planned >
            0 ? (
              <Progress
                value={
                  progress
                }
                aria-label="Run execution progress"
                className="mt-1 w-full max-w-28 gap-0 [&_[data-slot=progress-indicator]]:bg-status-running"
              />
            ) : null
          }
          className={
            separator
          }
        />

        <SummaryFact
          label={
            finalLabel
          }
          value={
            finalValue
          }
          mono={
            duration !==
            null
          }
          className={
            separator
          }
        />
      </dl>
    </section>
  );
}

/**
 * Renders one consistently padded summary value with optional action or supplemental detail.
 */
function SummaryFact({
  label,
  value,
  mono = false,
  title,
  action,
  detail,
  className,
}: SummaryFactProps) {
  return (
    <div
      className={`min-w-0 px-3 py-2.5 ${className ?? ""}`}
    >
      <dt className="text-[9px] font-medium uppercase tracking-wide text-text-muted">
        {label}
      </dt>

      <div className="mt-0.5 flex min-w-0 items-center gap-1">
        <dd
          title={
            title ??
            value
          }
          className={`min-w-0 flex-1 truncate text-[11px] font-medium text-text-primary ${
            mono
              ? "font-mono tabular-nums"
              : ""
          }`}
        >
          {value}
        </dd>

        {action}
      </div>

      {detail}
    </div>
  );
}

/**
 * Renders persisted execution metadata below the connection-status terminal header.
 */
function TerminalMetadata({
  execution,
}: {
  execution:
    AgentExecution;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 whitespace-nowrap text-[10px]">
      <span className="shrink-0 text-text-muted">
        Harness{" "}
        <strong className="font-medium capitalize text-text-secondary">
          {
            execution.harness
          }
        </strong>
      </span>

      <span className="hidden min-w-0 sm:inline">
        <span className="text-text-muted">
          Model{" "}
        </span>
        <strong
          title={
            execution.model
          }
          className="inline-block max-w-40 truncate align-bottom font-mono font-medium text-text-secondary"
        >
          {
            execution.model
          }
        </strong>
      </span>

      <span className="shrink-0 text-text-muted">
        Status{" "}
        <Badge
          variant={
            execution.status ===
            "running"
              ? "running"
              : execution.status ===
                  "completed"
                ? "success"
                : execution.status ===
                      "failed"
                  ? "error"
                  : execution.status ===
                      "blocked"
                    ? "warning"
                    : "neutral"
          }
          className="ms-0.5 h-4 px-1.5 text-[9px]"
        >
          {formatStatusLabel(
            execution.status,
          )}
        </Badge>
      </span>

      <span className="hidden shrink-0 text-text-muted md:inline">
        PID{" "}
        <strong className="font-mono font-medium tabular-nums text-text-secondary">
          {execution.pid ??
            "Unavailable"}
        </strong>
      </span>
    </div>
  );
}

/**
 * Preserves terminal-panel geometry when the run has no persisted execution to select.
 */
function EmptyExecutionPanel() {
  return (
    <section
      aria-label="Execution terminal"
      className="flex min-h-[26rem] h-full min-w-0 items-center justify-center rounded-lg border border-border-default bg-surface-card p-4 text-center min-[1360px]:min-h-0"
    >
      <div className="max-w-sm">
        <CircleDotIcon className="mx-auto size-5 text-text-muted" />

        <p className="mt-2 text-xs font-medium text-text-secondary">
          No
          execution
          selected
        </p>

        <p className="mt-1 text-[10px] leading-4 text-text-muted">
          The terminal
          will appear
          when a
          persisted
          execution is
          available.
        </p>
      </div>
    </section>
  );
}

/**
 * Renders stable initial loading and fatal-error page states without collapsing the workspace footprint.
 */
function WorkspaceState({
  icon,
  title,
  message,
  action,
}: WorkspaceStateProps) {
  return (
    <div className="[--run-primary-row:30rem]">
      <section className="flex min-h-[var(--run-primary-row)] items-center justify-center rounded-lg border border-border-default bg-surface-card p-6 text-center shadow-xs">
        <div className="max-w-lg">
          <div className="flex justify-center">
            {icon}
          </div>

          <h1 className="mt-3 font-heading text-sm font-semibold text-text-primary">
            {title}
          </h1>

          <p className="mt-1 text-xs leading-5 text-text-muted">
            {message}
          </p>

          {action ? (
            <div className="mt-3 flex justify-center">
              {action}
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
