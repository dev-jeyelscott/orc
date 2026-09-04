"use client";

import type {
  ReactNode,
} from "react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import type {
  AgentExecution,
  AgentExecutionMetrics,
} from "@orc/shared";

import { Progress } from "@/components/ui/progress";
import {
  getAgentExecutionMetrics,
} from "@/lib/agent-executions";
import {
  executionDurationMs,
  formatCompactNumber,
  formatDateTime,
  formatDuration,
  formatRelativeTime,
  formatStatusLabel,
  normalizeContextUsage,
  normalizeTokenUsage,
  shortIdentifier,
} from "@/lib/run-observability";
import { cn } from "@/lib/utils";

const METRICS_POLL_INTERVAL_MS =
  2_000;

interface RunExecutionInspectorProps {
  execution:
    | AgentExecution
    | null;
  className?: string;
}

interface MetricsState {
  executionId:
    string;
  metrics:
    | AgentExecutionMetrics
    | null;
}

interface InspectorGroupProps {
  title: string;
  children:
    ReactNode;
  fill?: boolean;
}

interface CompactFactProps {
  label: string;
  value: string;
  mono?: boolean;
  title?: string;
}

/**
 * Returns whether the metrics endpoint can currently expose live process samples.
 */
function supportsLiveMetrics(
  status:
    AgentExecution["status"],
): boolean {
  return (
    status ===
      "starting" ||
    status ===
      "running"
  );
}

/**
 * Formats one persisted byte count without inventing unavailable capacity percentages.
 */
function formatBytes(
  value:
    | number
    | null,
): string {
  if (
    value === null ||
    !Number.isFinite(
      value,
    ) ||
    value < 0
  ) {
    return "Unavailable";
  }

  const units = [
    "B",
    "KB",
    "MB",
    "GB",
    "TB",
  ];

  if (value === 0) {
    return "0 B";
  }

  const index =
    Math.min(
      units.length - 1,
      Math.floor(
        Math.log(
          value,
        ) /
          Math.log(
            1024,
          ),
      ),
    );

  const scaled =
    value /
    1024 ** index;

  return `${scaled.toFixed(
    scaled >= 10
      ? 0
      : 1,
  )} ${units[index]}`;
}

/**
 * Renders one fixed compact fact so long values cannot widen the inspector.
 */
function CompactFact({
  label,
  value,
  mono = false,
  title,
}: CompactFactProps) {
  return (
    <div className="min-w-0">
      <p className="text-[9px] leading-3 text-text-muted">
        {label}
      </p>

      <p
        title={
          title ??
          value
        }
        className={cn(
          "mt-0.5 truncate text-[10px] leading-4 font-medium text-text-secondary",
          mono &&
            "font-mono tabular-nums",
        )}
      >
        {value}
      </p>
    </div>
  );
}

/**
 * Renders one consistently sized inspector group using the shared panel geometry.
 */
function InspectorGroup({
  title,
  children,
  fill = false,
}: InspectorGroupProps) {
  return (
    <section
      className={cn(
        "shrink-0 border-b border-divider",
        fill &&
          "min-h-20 flex-1 border-b-0",
      )}
    >
      <div className="flex h-7 items-center border-b border-divider/70 px-3">
        <h3 className="font-heading text-[11px] font-medium text-text-primary">
          {title}
        </h3>
      </div>

      <div className="px-3 py-2">
        {children}
      </div>
    </section>
  );
}

/**
 * Renders live CPU telemetry with one shared-height progress treatment.
 */
function CpuMetric({
  value,
}: {
  value:
    | number
    | null;
}) {
  const valid =
    value !== null &&
    Number.isFinite(
      value,
    ) &&
    value >= 0;

  const bounded =
    valid
      ? Math.min(
          100,
          Math.max(
            0,
            value,
          ),
        )
      : null;

  return (
    <div className="grid min-w-0 grid-cols-[3.5rem_minmax(0,1fr)_4rem] items-center gap-2">
      <span className="text-[9px] text-text-muted">
        CPU
      </span>

      {bounded !==
      null ? (
        <Progress
          value={
            bounded
          }
          aria-label="Execution CPU usage"
          className="w-full gap-0 [&_[data-slot=progress-indicator]]:bg-status-running"
        />
      ) : (
        <div className="h-1 w-full rounded-full bg-surface-interactive" />
      )}

      <span className="text-right font-mono text-[9px] tabular-nums text-text-secondary">
        {valid
          ? `${value.toFixed(
              1,
            )}%`
          : "Unavailable"}
      </span>
    </div>
  );
}

/**
 * Renders normalized context telemetry without deriving unsupported values.
 */
function ContextMetric({
  percent,
}: {
  percent:
    | number
    | null;
}) {
  return (
    <div className="grid min-w-0 grid-cols-[3.5rem_minmax(0,1fr)_4rem] items-center gap-2">
      <span className="text-[9px] text-text-muted">
        Context
      </span>

      {percent !==
      null ? (
        <Progress
          value={
            percent
          }
          aria-label="Execution context usage"
          className="w-full gap-0 [&_[data-slot=progress-indicator]]:bg-status-running"
        />
      ) : (
        <div className="h-1 w-full rounded-full bg-surface-interactive" />
      )}

      <span className="text-right font-mono text-[9px] tabular-nums text-text-secondary">
        {percent !==
        null
          ? `${percent.toFixed(
              0,
            )}%`
          : "Unavailable"}
      </span>
    </div>
  );
}

/**
 * Polls and renders compact authoritative metadata for the execution selected in the table.
 */
export function RunExecutionInspector({
  execution,
  className,
}: RunExecutionInspectorProps) {
  const executionId =
    execution?.id ??
    null;

  const metricsActive =
    execution
      ? supportsLiveMetrics(
          execution.status,
        )
      : false;

  const [
    metricsState,
    setMetricsState,
  ] =
    useState<MetricsState | null>(
      null,
    );

  const metricsAbortRef =
    useRef<AbortController | null>(
      null,
    );

  /**
   * Loads one live process metric sample while cancelling any older request.
   */
  const loadMetrics =
    useCallback(
      async () => {
        if (
          !executionId ||
          !metricsActive
        ) {
          return;
        }

        metricsAbortRef.current?.abort();

        const controller =
          new AbortController();

        metricsAbortRef.current =
          controller;

        try {
          const metrics =
            await getAgentExecutionMetrics(
              executionId,
              controller.signal,
            );

          if (
            controller.signal
              .aborted
          ) {
            return;
          }

          setMetricsState({
            executionId,
            metrics,
          });
        } catch {
          if (
            controller.signal
              .aborted
          ) {
            return;
          }

          setMetricsState({
            executionId,
            metrics: null,
          });
        }
      },
      [
        executionId,
        metricsActive,
      ],
    );

  useEffect(() => {
    if (
      !metricsActive
    ) {
      metricsAbortRef.current?.abort();
      return;
    }

    let disposed =
      false;

    queueMicrotask(
      () => {
        if (
          !disposed
        ) {
          void loadMetrics();
        }
      },
    );

    /**
     * Refreshes live metrics only while the page is visible.
     */
    function tick(): void {
      if (
        document.visibilityState ===
        "visible"
      ) {
        void loadMetrics();
      }
    }

    const timer =
      window.setInterval(
        tick,
        METRICS_POLL_INTERVAL_MS,
      );

    return () => {
      disposed =
        true;

      window.clearInterval(
        timer,
      );

      metricsAbortRef.current?.abort();
    };
  }, [
    loadMetrics,
    metricsActive,
  ]);

  if (!execution) {
    return (
      <aside
        aria-label="Selected execution inspector"
        className={cn(
          "flex h-full min-h-40 min-w-0 items-center justify-center rounded-lg border border-border-default bg-surface-card p-4 text-center text-xs text-text-muted shadow-xs",
          className,
        )}
      >
        Select a
        persisted
        execution to
        inspect its
        runtime state.
      </aside>
    );
  }

  const metrics =
    metricsActive &&
    metricsState
      ?.executionId ===
      execution.id
      ? metricsState.metrics
      : null;

  const tokens =
    normalizeTokenUsage(
      execution.tokenUsage,
    );

  const context =
    normalizeContextUsage(
      execution.contextUsage,
    );

  const duration =
    executionDurationMs(
      execution,
    );

  const result =
    execution.resultStatus
      ? formatStatusLabel(
          execution.resultStatus,
        )
      : "Unavailable";

  return (
    <aside
      aria-label={`Execution inspector for ${execution.agentName}`}
      className={cn(
        "flex h-full min-h-0 min-w-0 flex-col overflow-y-auto rounded-lg border border-border-default bg-surface-card shadow-xs",
        className,
      )}
    >
      <InspectorGroup title="Agent">
        <div className="grid grid-cols-2 gap-x-3 gap-y-2">
          <CompactFact
            label="Name"
            value={
              execution.agentName
            }
          />

          <CompactFact
            label="Role"
            value={
              execution.agentRole
            }
          />

          <CompactFact
            label="Layer"
            value={String(
              execution.layer,
            )}
            mono
          />

          <CompactFact
            label="Order"
            value={String(
              execution.executionOrder,
            )}
            mono
          />

          <CompactFact
            label="Harness"
            value={
              execution.harness
            }
          />

          <CompactFact
            label="Model"
            value={
              execution.model
            }
            mono
          />

          <CompactFact
            label="Reasoning"
            value={
              execution.reasoning
            }
          />
        </div>
      </InspectorGroup>

      <InspectorGroup title="Runtime">
        <div className="grid grid-cols-2 gap-x-3 gap-y-2">
          <CompactFact
            label="PID"
            value={
              execution.pid !==
              null
                ? String(
                    execution.pid,
                  )
                : "Unavailable"
            }
            mono
          />

          <CompactFact
            label="Exit Code"
            value={
              execution.exitCode !==
              null
                ? String(
                    execution.exitCode,
                  )
                : "Unavailable"
            }
            mono
          />

          <CompactFact
            label="Started"
            value={formatDateTime(
              execution.startedAt,
            )}
          />

          <CompactFact
            label="Completed"
            value={formatDateTime(
              execution.completedAt,
            )}
          />
        </div>

        <div className="mt-2 space-y-2">
          <CpuMetric
            value={
              metrics?.cpuPercent ??
              null
            }
          />

          <div className="grid grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-2">
            <span className="text-[9px] text-text-muted">
              Memory
            </span>

            <span className="truncate font-mono text-[9px] tabular-nums text-text-secondary">
              {formatBytes(
                metrics?.memoryBytes ??
                  null,
              )}
            </span>
          </div>
        </div>
      </InspectorGroup>

      <InspectorGroup title="Usage">
        <div className="grid grid-cols-2 gap-x-3 gap-y-2">
          <CompactFact
            label="Input Tokens"
            value={formatCompactNumber(
              tokens?.inputTokens ??
                null,
            )}
            mono
          />

          <CompactFact
            label="Output Tokens"
            value={formatCompactNumber(
              tokens?.outputTokens ??
                null,
            )}
            mono
          />

          <CompactFact
            label="Cached Tokens"
            value={formatCompactNumber(
              tokens?.cachedTokens ??
                null,
            )}
            mono
          />

          <CompactFact
            label="Total Tokens"
            value={formatCompactNumber(
              tokens?.totalTokens ??
                null,
            )}
            mono
          />
        </div>

        <div className="mt-2">
          <ContextMetric
            percent={
              context?.percent ??
              null
            }
          />
        </div>
      </InspectorGroup>

      <InspectorGroup title="Result">
        <div className="grid grid-cols-2 gap-x-3 gap-y-2">
          <CompactFact
            label="Result"
            value={
              result
            }
          />

          <CompactFact
            label="Repair Attempted"
            value={
              execution.repairAttempted
                ? "Yes"
                : "No"
            }
          />

          <CompactFact
            label="Commit"
            value={
              execution.commitHash
                ? shortIdentifier(
                    execution.commitHash,
                  )
                : "Unavailable"
            }
            title={
              execution.commitHash ??
              undefined
            }
            mono
          />

          <CompactFact
            label="Failure Reason"
            value={
              execution.failureReason ??
              "Unavailable"
            }
            title={
              execution.failureReason ??
              undefined
            }
          />
        </div>
      </InspectorGroup>

      <InspectorGroup
        title="Process"
        fill
      >
        <div className="grid grid-cols-2 gap-x-3 gap-y-2">
          <CompactFact
            label="Current State"
            value={formatStatusLabel(
              execution.status,
            )}
          />

          <CompactFact
            label="Duration"
            value={formatDuration(
              duration,
            )}
            mono
          />

          <CompactFact
            label="Last Update"
            value={formatRelativeTime(
              execution.updatedAt,
            )}
            title={formatDateTime(
              execution.updatedAt,
            )}
          />
        </div>
      </InspectorGroup>
    </aside>
  );
}
