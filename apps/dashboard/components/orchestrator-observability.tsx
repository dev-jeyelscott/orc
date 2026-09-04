"use client";

import Link from "next/link";
import type {
  AgentExecution,
  DomainEvent,
  OrchestratorSettings,
  RunDetail,
} from "@orc/shared";
import {
  ActivityIcon,
  BotIcon,
  GitCommitHorizontalIcon,
} from "lucide-react";
import {
  useEffect,
  useState,
  type ReactNode,
} from "react";

import { AgentExecutionTerminal } from "@/components/agent-execution-terminal";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { getAgentExecutionMetrics } from "@/lib/agent-executions";
import {
  formatElapsedTime,
} from "@/lib/orchestrator-presentation";
import {
  compactPath,
  describeEventData,
  formatAbsoluteTimestamp,
  formatStatusLabel,
  formatTokenCount,
  getLifecycleBadgeVariant,
  getResultBadgeVariant,
  shortId,
  summarizeContextUsage,
  summarizeTokenUsage,
  type StatusBadgeVariant,
} from "@/lib/task-presentation";
import { cn } from "@/lib/utils";

type AgentMetrics = {
  cpuPercent: number | null;
  memoryBytes: number | null;
};

type AgentMetricsState = {
  executionId: string;
  metrics: AgentMetrics;
};

/** Formats process memory telemetry without inventing a capacity or percentage. */
function formatBytes(
  value: number | null,
): string {
  if (value === null) {
    return "Unavailable";
  }

  if (value >= 1024 ** 3) {
    return `${(
      value /
      1024 ** 3
    ).toFixed(2)} GiB`;
  }

  if (value >= 1024 ** 2) {
    return `${(
      value /
      1024 ** 2
    ).toFixed(1)} MiB`;
  }

  if (value >= 1024) {
    return `${(
      value / 1024
    ).toFixed(1)} KiB`;
  }

  return `${value} B`;
}

/** Chooses semantic styling from a persisted domain event type. */
function eventVariant(
  event: DomainEvent,
): StatusBadgeVariant {
  if (
    event.type.includes(
      "failed",
    )
  ) {
    return "error";
  }

  if (
    event.type.includes(
      "blocked",
    )
  ) {
    return "warning";
  }

  if (
    event.type.includes(
      "completed",
    )
  ) {
    return "success";
  }

  if (
    event.type.includes(
      "cancelled",
    )
  ) {
    return "neutral";
  }

  return "running";
}

/** Shortens long supervisor configuration text for compact operator display. */
function truncateText(
  value: string,
  length: number,
): string {
  if (
    value.length <=
    length
  ) {
    return value;
  }

  return `${value.slice(
    0,
    length - 3,
  )}...`;
}

/** Polls process metrics only while the selected execution can expose live process telemetry. */
function useAgentMetrics(
  execution: AgentExecution | null,
) {
  const liveExecutionId =
    execution &&
    [
      "starting",
      "running",
    ].includes(
      execution.status,
    )
      ? execution.id
      : null;

  const [
    metricsState,
    setMetricsState,
  ] =
    useState<AgentMetricsState | null>(
      null,
    );

  useEffect(() => {
    if (!liveExecutionId) {
      return;
    }

    let disposed = false;

    /** Loads one authoritative process metrics snapshot and fails closed to unavailable telemetry. */
    const refresh =
      async (): Promise<void> => {
        try {
          const next =
            await getAgentExecutionMetrics(
              liveExecutionId,
            );

          if (!disposed) {
            setMetricsState({
              executionId:
                liveExecutionId,
              metrics:
                next,
            });
          }
        } catch {
          if (!disposed) {
            setMetricsState({
              executionId:
                liveExecutionId,
              metrics: {
                cpuPercent:
                  null,
                memoryBytes:
                  null,
              },
            });
          }
        }
      };

    void refresh();

    const timer =
      window.setInterval(
        () => {
          void refresh();
        },
        2_000,
      );

    return () => {
      disposed = true;

      window.clearInterval(
        timer,
      );
    };
  }, [
    liveExecutionId,
  ]);

  return metricsState
    ?.executionId ===
    liveExecutionId
    ? metricsState.metrics
    : null;
}

/** Renders one compact definition-list field. */
function Detail({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "min-w-0",
        className,
      )}
    >
      <dt className="text-[9px] font-medium uppercase tracking-wide text-text-muted">
        {label}
      </dt>

      <dd className="mt-1 min-w-0 break-words text-[11px] text-text-primary">
        {children}
      </dd>
    </div>
  );
}

/** Renders authoritative run-level facts without projecting unexecuted workflow state. */
export function RunOverviewPanel({
  detail,
  error,
  activeExecution,
}: {
  detail: RunDetail | null;
  error: string | null;
  activeExecution: AgentExecution | null;
}) {
  if (error) {
    return (
      <p
        role="alert"
        className="text-xs text-status-error"
      >
        {error}
      </p>
    );
  }

  if (!detail) {
    return (
      <p className="text-xs text-text-muted">
        No run is linked to this conversation yet.
      </p>
    );
  }

  return (
    <dl className="grid gap-px overflow-hidden rounded-lg border border-border-default bg-divider sm:grid-cols-2">
      <Detail
        label="Status"
        className="bg-surface-interactive p-3"
      >
        <Badge
          variant={getLifecycleBadgeVariant(
            detail.run.status,
          )}
        >
          {formatStatusLabel(
            detail.run.status,
          )}
        </Badge>
      </Detail>

      <Detail
        label="Executions"
        className="bg-surface-interactive p-3"
      >
        {
          detail.run
            .executionCount
        }
      </Detail>

      <Detail
        label="Created"
        className="bg-surface-interactive p-3"
      >
        {formatAbsoluteTimestamp(
          detail.run
            .createdAt,
        )}
      </Detail>

      <Detail
        label="Updated"
        className="bg-surface-interactive p-3"
      >
        {formatAbsoluteTimestamp(
          detail.run
            .updatedAt,
        )}
      </Detail>

      <Detail
        label="Active Worker"
        className="bg-surface-interactive p-3"
      >
        {activeExecution
          ? `${activeExecution.agentName} · Layer ${activeExecution.layer}`
          : "No active execution"}
      </Detail>

      <Detail
        label="Project Path"
        className="bg-surface-interactive p-3"
      >
        <span
          title={
            detail.run
              .projectPath
          }
        >
          {compactPath(
            detail.run
              .projectPath,
          )}
        </span>
      </Detail>

      <Detail
        label="Task"
        className="bg-surface-interactive p-3"
      >
        {detail.task
          ?.title ??
          "No linked task"}
      </Detail>

      <Detail
        label="Terminal Reason"
        className="bg-surface-interactive p-3"
      >
        {detail.run
          .terminalReason ??
          "Not set"}
      </Detail>
    </dl>
  );
}

/** Renders only persisted execution attempts that actually exist for the selected run. */
export function ExecutionTimelinePanel({
  detail,
  now,
}: {
  detail: RunDetail | null;
  now: number;
}) {
  const executions =
    detail?.executions ??
    [];

  if (!executions.length) {
    return (
      <p className="text-xs text-text-muted">
        No execution records have been created.
      </p>
    );
  }

  return (
    <ol className="divide-y divide-divider overflow-hidden rounded-lg border border-border-default">
      {executions.map(
        (
          execution,
          index,
        ) => (
          <li
            key={
              execution.id
            }
            className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 bg-surface-interactive px-3 py-2.5"
          >
            <span className="font-mono text-[10px] text-text-muted">
              {index + 1}
            </span>

            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <span className="truncate text-[11px] font-medium text-text-primary">
                  {
                    execution.agentName
                  }
                </span>

                <Badge
                  variant={getLifecycleBadgeVariant(
                    execution.status,
                  )}
                >
                  {formatStatusLabel(
                    execution.status,
                  )}
                </Badge>
              </div>

              <p className="mt-1 truncate text-[10px] text-text-muted">
                Layer{" "}
                {
                  execution.layer
                }
                {" · "}
                order{" "}
                {
                  execution.executionOrder
                }
                {" · "}
                {
                  execution.agentRole
                }
              </p>
            </div>

            <span className="whitespace-nowrap font-mono text-[9px] text-text-muted">
              {formatElapsedTime(
                execution.startedAt,
                execution.completedAt,
                now,
              )}
            </span>
          </li>
        ),
      )}
    </ol>
  );
}

/** Renders the currently persisted active worker together with supported runtime telemetry. */
export function ActiveAgentPanel({
  execution,
}: {
  execution: AgentExecution | null;
}) {
  const metrics =
    useAgentMetrics(
      execution,
    );

  const tokenUsage =
    execution
      ? summarizeTokenUsage([
          execution,
        ])
      : null;

  const contextUsage =
    execution
      ? summarizeContextUsage(
          execution.contextUsage,
        )
      : null;

  if (!execution) {
    return (
      <p className="text-xs text-text-muted">
        No active agent execution.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex min-w-0 items-center gap-2 rounded-lg border border-border-default bg-surface-interactive p-3">
        <BotIcon className="size-4 shrink-0 text-status-running" />

        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-text-primary">
            {
              execution.agentName
            }
          </p>

          <p className="mt-0.5 truncate text-[10px] text-text-muted">
            {
              execution.agentRole
            }
            {" · Layer "}
            {
              execution.layer
            }
          </p>
        </div>

        <Badge
          className="ms-auto"
          variant={getLifecycleBadgeVariant(
            execution.status,
          )}
        >
          {formatStatusLabel(
            execution.status,
          )}
        </Badge>
      </div>

      <dl className="grid gap-4 sm:grid-cols-2">
        <Detail label="Role">
          {
            execution.agentRole
          }
        </Detail>

        <Detail label="Layer / Order">
          Layer{" "}
          {
            execution.layer
          }
          {" · "}
          {
            execution.executionOrder
          }
        </Detail>

        <Detail label="Harness">
          {
            execution.harness
          }
        </Detail>

        <Detail label="Model">
          {
            execution.model
          }
        </Detail>

        <Detail label="Reasoning">
          {
            execution.reasoning
          }
        </Detail>

        <Detail label="PID">
          {execution.pid ??
            "Unavailable"}
        </Detail>

        <Detail label="Exit Code">
          {execution.exitCode ??
            "Not available"}
        </Detail>

        <Detail label="Repair Attempted">
          {execution.repairAttempted
            ? "Yes"
            : "No"}
        </Detail>

        <Detail label="Tokens Used">
          {formatTokenCount(
            tokenUsage
              ?.totalTokens ??
              null,
          )}
        </Detail>

        <Detail label="CPU Usage">
          {metrics?.cpuPercent !==
            null &&
          metrics?.cpuPercent !==
            undefined
            ? `${metrics.cpuPercent.toFixed(
                1,
              )}%`
            : "Unavailable"}
        </Detail>

        <Detail label="Memory Usage">
          {formatBytes(
            metrics?.memoryBytes ??
              null,
          )}
        </Detail>

        <Detail label="Commit">
          {execution
            .commitHash ? (
            <span className="inline-flex items-center gap-1 font-mono text-link">
              <GitCommitHorizontalIcon className="size-3" />

              {shortId(
                execution.commitHash,
              )}
            </span>
          ) : (
            "Not available"
          )}
        </Detail>

        <Detail label="Started At">
          {formatAbsoluteTimestamp(
            execution.startedAt,
          )}
        </Detail>

        <Detail label="Completed At">
          {formatAbsoluteTimestamp(
            execution.completedAt,
          )}
        </Detail>

        <Detail label="Updated At">
          {formatAbsoluteTimestamp(
            execution.updatedAt,
          )}
        </Detail>
      </dl>

      <div>
        <div className="flex items-center justify-between text-[10px] text-text-muted">
          <span>
            Context usage
          </span>

          <span>
            {contextUsage
              ?.percent !==
              null &&
            contextUsage
              ?.percent !==
              undefined
              ? `${contextUsage.percent.toFixed(
                  1,
                )}%`
              : "Unavailable"}
          </span>
        </div>

        {contextUsage
          ?.percent !==
          null &&
        contextUsage
          ?.percent !==
          undefined ? (
          <Progress
            className="mt-1.5 h-1.5"
            value={
              contextUsage.percent
            }
          />
        ) : null}
      </div>

      {execution.failureReason ? (
        <p className="rounded-md border border-status-error/30 bg-status-error/5 p-2 text-[11px] text-status-error">
          {
            execution.failureReason
          }
        </p>
      ) : null}
    </div>
  );
}

/** Resolves the persisted execution affected by an event without inferring missing relationships. */
function affectedExecutionLabel(
  event: DomainEvent,
  detail: RunDetail | null,
): string {
  if (
    !event.agentExecutionId
  ) {
    return "Run event";
  }

  const execution =
    detail?.executions.find(
      (candidate) =>
        candidate.id ===
        event.agentExecutionId,
    );

  if (!execution) {
    return `Execution ${shortId(
      event.agentExecutionId,
    )}`;
  }

  return `${execution.agentName} · ${shortId(
    execution.id,
  )}`;
}

/** Renders persisted domain events independently from raw terminal output. */
export function EventStreamPanel({
  detail,
  limit = 8,
}: {
  detail: RunDetail | null;
  limit?: number | null;
}) {
  const sortedEvents = [
    ...(detail?.events ??
      []),
  ].sort(
    (left, right) =>
      Date.parse(
        right.createdAt,
      ) -
      Date.parse(
        left.createdAt,
      ),
  );

  const events =
    limit === null
      ? sortedEvents
      : sortedEvents.slice(
          0,
          limit,
        );

  if (!events.length) {
    return (
      <p className="text-xs text-text-muted">
        No workflow events recorded.
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border-default">
      <div className="flex items-center gap-2 border-b border-divider bg-surface-interactive px-3 py-2">
        <ActivityIcon className="size-3.5 text-text-muted" />

        <span className="text-[11px] font-medium text-text-primary">
          Persisted events
        </span>
      </div>

      <div className="divide-y divide-divider">
        {events.map(
          (event) => (
            <div
              key={event.id}
              className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-2 bg-surface-interactive px-3 py-2"
            >
              <Badge
                variant={eventVariant(
                  event,
                )}
              >
                {event.type}
              </Badge>

              <div className="min-w-0">
                <p className="truncate text-[11px] text-text-secondary">
                  {describeEventData(
                    event.data,
                  )}
                </p>

                <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[9px] text-text-muted">
                  <span className="truncate">
                    {affectedExecutionLabel(
                      event,
                      detail,
                    )}
                  </span>

                  <time
                    dateTime={
                      event.createdAt
                    }
                  >
                    {formatAbsoluteTimestamp(
                      event.createdAt,
                    )}
                  </time>
                </div>
              </div>
            </div>
          ),
        )}
      </div>

      {detail ? (
        <div className="border-t border-divider bg-surface-interactive px-3 py-2 text-right">
          <Link
            href={`/runs/${detail.run.id}`}
            className="text-[11px] font-medium text-link hover:underline"
          >
            View full run
          </Link>
        </div>
      ) : null}
    </div>
  );
}

/** Renders separately configured supervisor settings without representing the Orchestrator as a worker layer. */
export function OrchestratorSettingsPanel({
  settings,
  error,
}: {
  settings: OrchestratorSettings | null;
  error: string | null;
}) {
  if (error) {
    return (
      <p className="text-xs text-status-error">
        {error}
      </p>
    );
  }

  if (!settings) {
    return (
      <p className="text-xs text-text-muted">
        Loading settings...
      </p>
    );
  }

  return (
    <dl className="space-y-4 rounded-lg border border-border-default bg-surface-interactive p-3">
      <Detail label="Harness">
        {settings.harness}
      </Detail>

      <Detail label="Model">
        {settings.model}
      </Detail>

      <Detail label="Reasoning">
        {settings.reasoning}
      </Detail>

      <Detail label="System Prompt">
        <span
          title={
            settings.systemPrompt
          }
        >
          {truncateText(
            settings.systemPrompt,
            600,
          )}
        </span>
      </Detail>
    </dl>
  );
}

/** Renders the replayable xterm session for the active or most recent execution. */
export function OrchestratorTerminalPanel({
  execution,
}: {
  execution: AgentExecution | null;
}) {
  if (!execution) {
    return (
      <div className="flex h-full min-h-40 items-center justify-center text-xs text-text-muted">
        No execution terminal is available yet.
      </div>
    );
  }

  return (
    <AgentExecutionTerminal
      executionId={
        execution.id
      }
      title={`Live Terminal Output · ${execution.agentName}`}
      className="h-full min-h-0"
      heightClassName="h-[calc(100%-37px)] min-h-0"
    />
  );
}

/** Renders one structured-result section with consistent workbench presentation. */
function ResultSection({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "min-w-0 rounded-lg border border-border-default bg-surface-interactive p-3",
        className,
      )}
    >
      <h3 className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
        {title}
      </h3>

      <div className="mt-2">
        {children}
      </div>
    </section>
  );
}

/** Renders the newest validated structured worker result without parsing raw terminal text. */
export function OrchestratorResultPreview({
  execution,
}: {
  execution: AgentExecution | null;
}) {
  const result =
    execution?.resultPayload ??
    null;

  if (!result) {
    return (
      <div className="flex min-h-48 items-center justify-center text-xs text-text-muted">
        No validated structured result is available yet.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Badge
          variant={getResultBadgeVariant(
            result.status,
          )}
        >
          {formatStatusLabel(
            result.status,
          )}
        </Badge>

        {result.commit ? (
          <span className="inline-flex items-center gap-1 font-mono text-[10px] text-link">
            <GitCommitHorizontalIcon className="size-3" />
            {result.commit}
          </span>
        ) : null}
      </div>

      <div className="grid min-w-0 gap-3 md:grid-cols-2">
        <ResultSection
          title="Summary"
          className="md:col-span-2"
        >
          <p className="text-xs leading-5 text-text-secondary">
            {result.summary}
          </p>

          {Object.keys(
            result.details,
          ).length ? (
            <pre className="mt-3 max-h-52 overflow-auto whitespace-pre-wrap rounded-md bg-bg-app p-2 font-mono text-[10px] text-text-muted">
              {JSON.stringify(
                result.details,
                null,
                2,
              )}
            </pre>
          ) : null}
        </ResultSection>

        <ResultSection title="Findings">
          {result.findings
            .length ? (
            <ul className="space-y-1.5">
              {result.findings.map(
                (
                  finding,
                  index,
                ) => (
                  <li
                    key={`${index}:${finding}`}
                    className="text-xs leading-5 text-text-secondary"
                  >
                    {finding}
                  </li>
                ),
              )}
            </ul>
          ) : (
            <p className="text-xs text-text-muted">
              None reported
            </p>
          )}
        </ResultSection>

        <ResultSection title="Files Changed">
          {result.filesChanged
            .length ? (
            <ul className="space-y-1.5">
              {result.filesChanged.map(
                (file) => (
                  <li
                    key={file}
                    className="break-all font-mono text-[10px] text-text-secondary"
                  >
                    {file}
                  </li>
                ),
              )}
            </ul>
          ) : (
            <p className="text-xs text-text-muted">
              None reported
            </p>
          )}
        </ResultSection>

        <ResultSection title="Commands Run">
          {result.commandsRun
            .length ? (
            <ul className="space-y-1.5">
              {result.commandsRun.map(
                (
                  command,
                  index,
                ) => (
                  <li
                    key={`${index}:${command}`}
                    className="break-all rounded-md bg-bg-app px-2 py-1 font-mono text-[10px] text-text-secondary"
                  >
                    {command}
                  </li>
                ),
              )}
            </ul>
          ) : (
            <p className="text-xs text-text-muted">
              None reported
            </p>
          )}
        </ResultSection>

        <ResultSection title="Validation">
          {Object.keys(
            result.validation,
          ).length ? (
            <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded-md bg-bg-app p-2 font-mono text-[10px] text-text-secondary">
              {JSON.stringify(
                result.validation,
                null,
                2,
              )}
            </pre>
          ) : (
            <p className="text-xs text-text-muted">
              No validation data
            </p>
          )}
        </ResultSection>
      </div>
    </div>
  );
}
