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
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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

interface OrchestratorObservabilityProps {
  runDetail: RunDetail | null;
  runError: string | null;
  activeExecution: AgentExecution | null;
  settings: OrchestratorSettings | null;
  settingsError: string | null;
  now: number;
}

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

/** Shortens long supervisor configuration text for dense operator display. */
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
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[9px] font-medium uppercase tracking-wide text-text-muted">
        {label}
      </dt>

      <dd className="mt-1 min-w-0 break-words text-[11px] text-text-primary">
        {children}
      </dd>
    </div>
  );
}

/** Renders authoritative run-level state without projecting unexecuted workflow steps. */
function RunSummary({
  detail,
  error,
}: {
  detail: RunDetail | null;
  error: string | null;
}) {
  return (
    <Card>
      <CardHeader className="border-b border-divider px-3 py-2">
        <CardTitle className="text-xs">
          Run Summary
        </CardTitle>
      </CardHeader>

      <CardContent className="p-3">
        {error ? (
          <p
            role="alert"
            className="text-xs text-status-error"
          >
            {error}
          </p>
        ) : !detail ? (
          <p className="text-xs text-text-muted">
            No run is linked to this conversation yet.
          </p>
        ) : (
          <dl className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-5">
            <Detail label="Status">
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

            <Detail label="Execution Count">
              {
                detail.run
                  .executionCount
              }
            </Detail>

            <Detail label="Terminal Reason">
              {detail.run
                .terminalReason ??
                "Not set"}
            </Detail>

            <Detail label="Created At">
              {formatAbsoluteTimestamp(
                detail.run
                  .createdAt,
              )}
            </Detail>

            <Detail label="Updated At">
              {formatAbsoluteTimestamp(
                detail.run
                  .updatedAt,
              )}
            </Detail>

            <Detail label="Task">
              {detail.task
                ?.title ??
                "No linked task"}
            </Detail>

            <Detail label="Project Path">
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
          </dl>
        )}
      </CardContent>
    </Card>
  );
}

/** Renders only execution attempts that actually exist for the selected run. */
function ExecutionTimeline({
  detail,
  now,
}: {
  detail: RunDetail | null;
  now: number;
}) {
  const executions =
    detail?.executions ??
    [];

  return (
    <Card className="min-w-0">
      <CardHeader className="border-b border-divider px-3 py-2">
        <CardTitle className="text-xs">
          Executions Timeline
        </CardTitle>
      </CardHeader>

      <CardContent className="max-h-72 overflow-y-auto p-3">
        {executions.length ? (
          <ol className="space-y-2.5">
            {executions.map(
              (
                execution,
                index,
              ) => (
                <li
                  key={
                    execution.id
                  }
                  className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2"
                >
                  <span
                    className="mt-1.5 size-2 rounded-full bg-status-neutral"
                    aria-hidden
                  />

                  <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                      <span className="font-mono text-[9px] text-text-muted">
                        #
                        {index +
                          1}
                      </span>

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
        ) : (
          <p className="text-xs text-text-muted">
            No execution records have been created.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/** Renders the currently persisted active worker together with supported runtime telemetry. */
function ActiveAgentDetails({
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

  return (
    <Card className="min-w-0">
      <CardHeader className="border-b border-divider px-3 py-2">
        <CardTitle className="text-xs">
          Active Agent Details
        </CardTitle>
      </CardHeader>

      <CardContent className="p-3">
        {!execution ? (
          <p className="text-xs text-text-muted">
            No active agent execution.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex min-w-0 items-center gap-2">
              <BotIcon className="size-4 shrink-0 text-status-running" />

              <span className="truncate text-xs font-semibold text-text-primary">
                {
                  execution.agentName
                }
              </span>

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

            <dl className="grid gap-3 sm:grid-cols-2">
              <Detail label="Role">
                {
                  execution.agentRole
                }
              </Detail>

              <Detail label="Layer">
                Layer{" "}
                {
                  execution.layer
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
        )}
      </CardContent>
    </Card>
  );
}

/** Resolves the affected persisted execution for one event without inferring missing relationships. */
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

/** Renders the latest persisted business events independently from raw terminal output. */
function EventStream({
  detail,
}: {
  detail: RunDetail | null;
}) {
  const events = [
    ...(detail?.events ??
      []),
  ]
    .sort(
      (left, right) =>
        Date.parse(
          right.createdAt,
        ) -
        Date.parse(
          left.createdAt,
        ),
    )
    .slice(0, 8);

  return (
    <Card className="min-w-0">
      <CardHeader className="border-b border-divider px-3 py-2">
        <CardTitle className="flex items-center gap-2 text-xs">
          <ActivityIcon className="size-3.5" />
          Event Stream
        </CardTitle>
      </CardHeader>

      <CardContent className="p-0">
        {events.length ? (
          <div className="divide-y divide-divider">
            {events.map(
              (event) => (
                <div
                  key={event.id}
                  className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-2 px-3 py-2"
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

            {detail ? (
              <div className="px-3 py-2 text-right">
                <Link
                  href={`/runs/${detail.run.id}`}
                  className="text-[11px] font-medium text-link hover:underline"
                >
                  View full run
                </Link>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="p-3 text-xs text-text-muted">
            No workflow events recorded.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/** Renders separately configured supervisor settings without representing the Orchestrator as a worker layer. */
function OrchestratorSettingsCard({
  settings,
  error,
}: {
  settings: OrchestratorSettings | null;
  error: string | null;
}) {
  return (
    <Card className="min-w-0">
      <CardHeader className="border-b border-divider px-3 py-2">
        <CardTitle className="text-xs">
          Orchestrator Settings
        </CardTitle>
      </CardHeader>

      <CardContent className="p-3">
        {error ? (
          <p className="text-xs text-status-error">
            {error}
          </p>
        ) : !settings ? (
          <p className="text-xs text-text-muted">
            Loading settings...
          </p>
        ) : (
          <dl className="space-y-3">
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
                  260,
                )}
              </span>
            </Detail>
          </dl>
        )}
      </CardContent>
    </Card>
  );
}

/** Renders run summary, execution timeline, active worker telemetry, events, and supervisor settings. */
export function OrchestratorObservability({
  runDetail,
  runError,
  activeExecution,
  settings,
  settingsError,
  now,
}: OrchestratorObservabilityProps) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <RunSummary
        detail={runDetail}
        error={runError}
      />

      <div className="grid min-w-0 gap-3 2xl:grid-cols-2">
        <ExecutionTimeline
          detail={runDetail}
          now={now}
        />

        <ActiveAgentDetails
          execution={
            activeExecution
          }
        />
      </div>

      <div className="grid min-w-0 gap-3 2xl:grid-cols-[minmax(0,1.2fr)_minmax(230px,0.8fr)]">
        <EventStream
          detail={runDetail}
        />

        <OrchestratorSettingsCard
          settings={settings}
          error={settingsError}
        />
      </div>
    </div>
  );
}

/** Renders the existing replayable xterm session for the active or most recent execution. */
export function OrchestratorTerminalPanel({
  execution,
}: {
  execution: AgentExecution | null;
}) {
  if (!execution) {
    return (
      <Card>
        <CardHeader className="border-b border-divider px-3 py-2">
          <CardTitle className="text-xs">
            Live Terminal Output
          </CardTitle>
        </CardHeader>

        <CardContent className="flex min-h-64 items-center justify-center text-xs text-text-muted">
          No execution terminal is available yet.
        </CardContent>
      </Card>
    );
  }

  return (
    <AgentExecutionTerminal
      executionId={
        execution.id
      }
      title={`Live Terminal Output · ${execution.agentName}`}
      heightClassName="h-[260px] lg:h-[300px]"
    />
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

  return (
    <Card className="min-w-0">
      <CardHeader className="border-b border-divider px-3 py-2">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-xs">
            Structured Result / Handoff Preview
          </CardTitle>

          {result ? (
            <Badge
              variant={getResultBadgeVariant(
                result.status,
              )}
            >
              {formatStatusLabel(
                result.status,
              )}
            </Badge>
          ) : null}
        </div>
      </CardHeader>

      <CardContent className="p-3">
        {!result ? (
          <div className="flex min-h-56 items-center justify-center text-xs text-text-muted">
            No validated structured result is available yet.
          </div>
        ) : (
          <div className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-5">
            <section className="min-w-0">
              <h3 className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                Summary
              </h3>

              <p className="mt-2 text-xs leading-5 text-text-secondary">
                {result.summary}
              </p>

              {Object.keys(
                result.details,
              ).length ? (
                <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap rounded-md bg-surface-interactive p-2 font-mono text-[10px] text-text-muted">
                  {JSON.stringify(
                    result.details,
                    null,
                    2,
                  )}
                </pre>
              ) : null}
            </section>

            <section className="min-w-0">
              <h3 className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                Findings
              </h3>

              {result.findings
                .length ? (
                <ul className="mt-2 space-y-1.5">
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
                <p className="mt-2 text-xs text-text-muted">
                  None reported
                </p>
              )}
            </section>

            <section className="min-w-0">
              <h3 className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                Files Changed
              </h3>

              {result.filesChanged
                .length ? (
                <ul className="mt-2 space-y-1">
                  {result.filesChanged.map(
                    (file) => (
                      <li
                        key={file}
                        className="truncate font-mono text-[10px] text-text-secondary"
                        title={file}
                      >
                        {file}
                      </li>
                    ),
                  )}
                </ul>
              ) : (
                <p className="mt-2 text-xs text-text-muted">
                  None reported
                </p>
              )}
            </section>

            <section className="min-w-0">
              <h3 className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                Commands Run
              </h3>

              {result.commandsRun
                .length ? (
                <ul className="mt-2 space-y-1">
                  {result.commandsRun.map(
                    (
                      command,
                      index,
                    ) => (
                      <li
                        key={`${index}:${command}`}
                        className="break-all rounded bg-surface-interactive px-2 py-1 font-mono text-[10px] text-text-secondary"
                      >
                        {command}
                      </li>
                    ),
                  )}
                </ul>
              ) : (
                <p className="mt-2 text-xs text-text-muted">
                  None reported
                </p>
              )}
            </section>

            <section className="min-w-0">
              <h3 className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                Validation
              </h3>

              {Object.keys(
                result.validation,
              ).length ? (
                <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-surface-interactive p-2 font-mono text-[10px] text-text-secondary">
                  {JSON.stringify(
                    result.validation,
                    null,
                    2,
                  )}
                </pre>
              ) : (
                <p className="mt-2 text-xs text-text-muted">
                  No validation data
                </p>
              )}

              {result.commit ? (
                <p className="mt-3 inline-flex items-center gap-1 font-mono text-[10px] text-link">
                  <GitCommitHorizontalIcon className="size-3" />

                  {result.commit}
                </p>
              ) : null}
            </section>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
