"use client";

import Link from "next/link";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  CircleDotIcon,
  ExternalLinkIcon,
  GitCommitHorizontalIcon,
  Loader2Icon,
} from "lucide-react";
import type {
  ReactNode,
} from "react";
import type {
  DomainEvent,
  RunDetail,
} from "@orc/shared";

import {
  Badge,
} from "@/components/ui/badge";
import {
  Button,
} from "@/components/ui/button";
import {
  Progress,
} from "@/components/ui/progress";
import {
  ScrollArea,
} from "@/components/ui/scroll-area";
import {
  describeEventData,
  formatRelativeTimestamp,
  formatStatusLabel,
  formatTokenCount,
  getLifecycleBadgeVariant,
  getResultBadgeVariant,
  shortId,
  summarizeContextUsage,
  summarizeTokenUsage,
} from "@/lib/task-presentation";

type TaskObservabilityPanelProps = {
  latestRunId:
    string | null;
  detail:
    RunDetail | null;
  loading: boolean;
  error:
    string | null;
};

/** Maps domain event names onto compact semantic dot colors without changing persisted event types. */
function getEventDotClassName(
  type: string,
): string {
  const normalized =
    type.toLowerCase();

  if (
    normalized.includes(
      "failed",
    ) ||
    normalized.includes(
      "cancel",
    )
  ) {
    return "bg-status-error";
  }

  if (
    normalized.includes(
      "blocked",
    ) ||
    normalized.includes(
      "retry",
    ) ||
    normalized.includes(
      "route",
    )
  ) {
    return "bg-status-warning";
  }

  if (
    normalized.includes(
      "completed",
    ) ||
    normalized.includes(
      "approved",
    ) ||
    normalized.includes(
      "result",
    )
  ) {
    return "bg-status-success";
  }

  return "bg-status-running";
}

/** Renders selected-run execution, telemetry, result, commit, and event observability from persisted run detail. */
export function TaskObservabilityPanel({
  latestRunId,
  detail,
  loading,
  error,
}: TaskObservabilityPanelProps) {
  if (!latestRunId) {
    return (
      <section className="flex min-h-[38rem] items-center justify-center rounded-lg border border-border-default bg-surface-elevated p-8 text-center shadow-xs">
        <div>
          <p className="text-sm font-medium text-text-secondary">
            No run
            observability yet
          </p>

          <p className="mt-1 text-xs text-text-muted">
            A related run will
            expose executions,
            events, usage,
            results, and commit
            metadata here.
          </p>
        </div>
      </section>
    );
  }

  if (
    loading &&
    !detail
  ) {
    return (
      <section className="flex min-h-[38rem] items-center justify-center rounded-lg border border-border-default bg-surface-elevated p-8 text-center shadow-xs">
        <div className="flex items-center gap-2 text-sm text-text-muted">
          <Loader2Icon
            className="size-4 animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />

          Loading run
          observability...
        </div>
      </section>
    );
  }

  if (
    error &&
    !detail
  ) {
    return (
      <section className="flex min-h-[38rem] items-center justify-center rounded-lg border border-status-error/30 bg-status-error/5 p-8 text-center shadow-xs">
        <div>
          <AlertTriangleIcon
            className="mx-auto size-5 text-status-error"
            aria-hidden="true"
          />

          <p className="mt-2 text-sm font-medium text-status-error">
            Unable to load
            run observability
          </p>

          <p className="mt-1 text-xs text-text-muted">
            {error}
          </p>
        </div>
      </section>
    );
  }

  if (!detail) {
    return null;
  }

  const latestExecution =
    detail.executions.at(-1) ??
    null;

  const contextExecution =
    [
      ...detail.executions,
    ]
      .reverse()
      .find(
        (execution) =>
          execution.contextUsage !==
          null,
      );

  const tokenUsage =
    summarizeTokenUsage(
      detail.executions,
    );

  const contextUsage =
    summarizeContextUsage(
      contextExecution
        ?.contextUsage ??
        null,
    );

  const commitHashes =
    Array.from(
      new Set(
        detail.executions.flatMap(
          (execution) =>
            execution.commitHash
              ? [
                  execution.commitHash,
                ]
              : [],
        ),
      ),
    );

  const recentEvents =
    detail.events.slice(-8);

  const runActive =
    detail.run.status ===
      "pending" ||
    detail.run.status ===
      "running";

  return (
    <aside
      className="min-w-0 space-y-3"
      aria-label="Selected task observability"
    >
      <section className="overflow-hidden rounded-lg border border-border-default bg-surface-elevated shadow-xs">
        <div className="flex items-center justify-between gap-2 border-b border-divider px-3 py-2.5">
          <div className="flex items-center gap-2">
            <CircleDotIcon
              className="size-3.5 text-status-running"
              aria-hidden="true"
            />

            <h2 className="text-sm font-medium text-text-primary">
              Agent Execution
              Progress
            </h2>
          </div>

          <span className="font-mono text-[11px] text-text-muted">
            Execution Count:{" "}
            {
              detail.run
                .executionCount
            }
          </span>
        </div>

        {detail.executions.length >
        0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[38rem] border-collapse text-left text-[11px]">
              <thead className="bg-surface-interactive text-text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">
                    Layer / Agent
                  </th>

                  <th className="px-2 py-2 font-medium">
                    Harness /
                    Model
                  </th>

                  <th className="px-2 py-2 font-medium">
                    Status
                  </th>

                  <th className="px-2 py-2 font-medium">
                    PID / Exit
                  </th>

                  <th className="px-2 py-2 font-medium">
                    Started /
                    Completed
                  </th>

                  <th className="px-3 py-2 font-medium">
                    Result
                  </th>
                </tr>
              </thead>

              <tbody>
                {detail.executions.map(
                  (execution) => (
                    <tr
                      key={
                        execution.id
                      }
                      className="border-t border-divider align-top"
                    >
                      <td className="px-3 py-2.5">
                        <Button
                          variant="link"
                          className="h-auto max-w-44 justify-start p-0 text-left text-xs"
                          render={
                            <Link
                              href={`/agent-executions/${execution.id}`}
                            />
                          }
                        >
                          <span className="min-w-0">
                            <span className="block text-[10px] text-text-muted">
                              Layer{" "}
                              {
                                execution.layer
                              }{" "}
                              · Order{" "}
                              {
                                execution.executionOrder
                              }
                            </span>

                            <span className="block truncate text-text-primary">
                              {
                                execution.agentName
                              }
                            </span>

                            <span className="block truncate text-[10px] text-text-muted">
                              {
                                execution.agentRole
                              }
                            </span>
                          </span>
                        </Button>
                      </td>

                      <td className="px-2 py-2.5 text-text-secondary">
                        <span className="block capitalize">
                          {
                            execution.harness
                          }
                        </span>

                        <span
                          className="block max-w-28 truncate font-mono text-[10px] text-text-muted"
                          title={
                            execution.model
                          }
                        >
                          {
                            execution.model
                          }
                        </span>

                        <span className="block text-[10px] capitalize text-text-muted">
                          {
                            execution.reasoning
                          }
                        </span>
                      </td>

                      <td className="px-2 py-2.5">
                        <Badge
                          variant={getLifecycleBadgeVariant(
                            execution.status,
                          )}
                        >
                          {formatStatusLabel(
                            execution.status,
                          )}
                        </Badge>
                      </td>

                      <td className="px-2 py-2.5 font-mono text-text-secondary">
                        <span className="block">
                          {execution.pid ??
                            "-"}
                        </span>

                        <span className="block text-[10px] text-text-muted">
                          exit{" "}
                          {execution.exitCode ??
                            "-"}
                        </span>
                      </td>

                      <td className="px-2 py-2.5 text-text-secondary">
                        <span className="block">
                          {formatRelativeTimestamp(
                            execution.startedAt,
                          )}
                        </span>

                        <span className="block text-[10px] text-text-muted">
                          {formatRelativeTimestamp(
                            execution.completedAt,
                          )}
                        </span>
                      </td>

                      <td className="px-3 py-2.5">
                        {execution.resultStatus ? (
                          <Badge
                            variant={getResultBadgeVariant(
                              execution.resultStatus,
                            )}
                          >
                            {formatStatusLabel(
                              execution.resultStatus,
                            )}
                          </Badge>
                        ) : (
                          <span className="text-text-muted">
                            -
                          </span>
                        )}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="p-6 text-center text-sm text-text-muted">
            Preparing the
            first worker
            execution.
          </p>
        )}
      </section>

      <div className="grid gap-3 sm:grid-cols-2">
        <TelemetryCard
          title="Token Usage"
          primary={formatTokenCount(
            tokenUsage.totalTokens,
          )}
          secondary={
            tokenUsage.availableExecutions >
            0
              ? `${tokenUsage.availableExecutions} execution${tokenUsage.availableExecutions === 1 ? "" : "s"} reported usage`
              : "No reliable provider token usage is available"
          }
        >
          {tokenUsage.availableExecutions >
          0 ? (
            <dl className="mt-2 grid grid-cols-3 gap-2 text-[10px]">
              <div>
                <dt className="text-text-muted">
                  Input
                </dt>

                <dd className="font-mono text-text-secondary">
                  {formatTokenCount(
                    tokenUsage.inputTokens,
                  )}
                </dd>
              </div>

              <div>
                <dt className="text-text-muted">
                  Output
                </dt>

                <dd className="font-mono text-text-secondary">
                  {formatTokenCount(
                    tokenUsage.outputTokens,
                  )}
                </dd>
              </div>

              <div>
                <dt className="text-text-muted">
                  Cached
                </dt>

                <dd className="font-mono text-text-secondary">
                  {formatTokenCount(
                    tokenUsage.cachedTokens,
                  )}
                </dd>
              </div>
            </dl>
          ) : null}
        </TelemetryCard>

        <TelemetryCard
          title="Context Usage"
          primary={
            contextUsage.percent ===
            null
              ? "Unavailable"
              : `${Math.round(contextUsage.percent)}%`
          }
          secondary={
            contextUsage.used !==
              null &&
            contextUsage.limit !==
              null
              ? `${contextUsage.used.toLocaleString()} / ${contextUsage.limit.toLocaleString()}`
              : "No reliable context window telemetry is available"
          }
        >
          {contextUsage.percent !==
          null ? (
            <Progress
              value={
                contextUsage.percent
              }
              className="mt-2"
            />
          ) : null}
        </TelemetryCard>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <MetricStateCard
          title="Result Status"
          value={
            latestExecution?.resultStatus
              ? formatStatusLabel(
                  latestExecution.resultStatus,
                )
              : "Unavailable"
          }
          variant={
            latestExecution?.resultStatus
              ? getResultBadgeVariant(
                  latestExecution.resultStatus,
                )
              : "neutral"
          }
        />

        <MetricStateCard
          title="Repair Attempted"
          value={
            latestExecution
              ? latestExecution.repairAttempted
                ? "Yes"
                : "No"
              : "Unavailable"
          }
          variant={
            latestExecution?.repairAttempted
              ? "warning"
              : "neutral"
          }
        />

        <MetricStateCard
          title="Failure Reason"
          value={
            latestExecution?.failureReason ??
            "None"
          }
          variant={
            latestExecution?.failureReason
              ? "error"
              : "neutral"
          }
        />
      </div>

      <section className="rounded-lg border border-border-default bg-surface-elevated shadow-xs">
        <div className="flex items-center justify-between gap-2 border-b border-divider px-3 py-2.5">
          <div className="flex items-center gap-2">
            <GitCommitHorizontalIcon
              className="size-3.5 text-text-muted"
              aria-hidden="true"
            />

            <h2 className="text-sm font-medium text-text-primary">
              Commit Hashes
            </h2>
          </div>

          <span className="text-[11px] text-text-muted">
            {
              commitHashes.length
            }{" "}
            recorded
          </span>
        </div>

        <div className="flex flex-wrap gap-2 p-3">
          {commitHashes.length >
          0 ? (
            commitHashes.map(
              (hash) => (
                <span
                  key={hash}
                  className="rounded-md border border-border-default bg-surface-interactive px-2 py-1 font-mono text-[11px] text-link"
                  title={hash}
                >
                  {shortId(
                    hash,
                    10,
                  )}
                </span>
              ),
            )
          ) : (
            <span className="text-xs text-text-muted">
              No execution has
              recorded a commit
              hash.
            </span>
          )}
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-border-default bg-surface-elevated shadow-xs">
        <div className="flex items-center justify-between gap-2 border-b border-divider px-3 py-2.5">
          <div className="flex items-center gap-2">
            {runActive ? (
              <CircleDotIcon
                className="size-3.5 animate-pulse text-status-success motion-reduce:animate-none"
                aria-hidden="true"
              />
            ) : (
              <CheckCircle2Icon
                className="size-3.5 text-status-neutral"
                aria-hidden="true"
              />
            )}

            <h2 className="text-sm font-medium text-text-primary">
              Events Stream
            </h2>
          </div>

          <span className="text-[11px] text-text-muted">
            {runActive
              ? "Live polling"
              : "Historical"}
          </span>
        </div>

        {error ? (
          <p className="border-b border-divider bg-status-error/5 px-3 py-2 text-xs text-status-error">
            Latest refresh
            failed. {error}
          </p>
        ) : null}

        <ScrollArea className="h-64">
          <div className="space-y-0.5 p-2">
            {recentEvents.length >
            0 ? (
              recentEvents.map(
                (event) => (
                  <EventRow
                    key={
                      event.id
                    }
                    event={
                      event
                    }
                  />
                ),
              )
            ) : (
              <p className="p-4 text-center text-xs text-text-muted">
                No domain
                events have
                been recorded.
              </p>
            )}
          </div>
        </ScrollArea>

        <div className="border-t border-divider p-2 text-center">
          <Button
            variant="link"
            size="xs"
            render={
              <Link
                href={`/runs/${detail.run.id}`}
              />
            }
          >
            View full event
            history
            <ExternalLinkIcon />
          </Button>
        </div>
      </section>
    </aside>
  );
}

/** Renders a compact telemetry card without inventing percentages or limits that are not persisted. */
function TelemetryCard({
  title,
  primary,
  secondary,
  children,
}: {
  title: string;
  primary: string;
  secondary: string;
  children?: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border-default bg-surface-elevated p-3 shadow-xs">
      <h2 className="text-xs font-medium text-text-secondary">
        {title}
      </h2>

      <div className="mt-1 font-mono text-lg font-semibold text-text-primary">
        {primary}
      </div>

      <p className="mt-0.5 text-[10px] leading-relaxed text-text-muted">
        {secondary}
      </p>

      {children}
    </section>
  );
}

/** Renders one compact result-state card with semantic text treatment. */
function MetricStateCard({
  title,
  value,
  variant,
}: {
  title: string;
  value: string;
  variant:
    | "running"
    | "success"
    | "warning"
    | "error"
    | "neutral";
}) {
  return (
    <section className="min-w-0 rounded-lg border border-border-default bg-surface-elevated p-3 shadow-xs">
      <h2 className="text-[11px] font-medium text-text-muted">
        {title}
      </h2>

      <div className="mt-1 min-w-0">
        <Badge
          variant={variant}
          className="max-w-full"
        >
          <span
            className="truncate"
            title={value}
          >
            {value}
          </span>
        </Badge>
      </div>
    </section>
  );
}

/** Renders one persisted domain event as a concise chronological stream entry. */
function EventRow({
  event,
}: {
  event: DomainEvent;
}) {
  const description =
    describeEventData(
      event.data,
    );

  return (
    <div className="grid grid-cols-[4.25rem_minmax(0,1fr)] gap-2 rounded-md px-1.5 py-1.5 hover:bg-surface-interactive">
      <span className="font-mono text-[10px] text-text-muted">
        {formatRelativeTimestamp(
          event.createdAt,
        )}
      </span>

      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span
            className={`size-1.5 shrink-0 rounded-full ${getEventDotClassName(event.type)}`}
            aria-hidden="true"
          />

          <span
            className="truncate font-mono text-[10px] text-link"
            title={
              event.type
            }
          >
            {event.type}
          </span>
        </div>

        <p
          className="mt-0.5 truncate text-[10px] text-text-muted"
          title={
            description
          }
        >
          {description}
        </p>
      </div>
    </div>
  );
}
