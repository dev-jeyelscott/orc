"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useState,
} from "react";
import type {
  DashboardActivity,
  DashboardStatusCounts,
  DashboardSummary,
  DomainEvent,
  RunStatus,
} from "@orc/shared";
import type {
  LucideIcon,
} from "lucide-react";
import {
  ActivityIcon,
  BotIcon,
  CircleAlertIcon,
  Clock3Icon,
  CpuIcon,
  FolderGit2Icon,
  GitCommitHorizontalIcon,
  HardDriveIcon,
  Layers3Icon,
  ListTodoIcon,
  PlayIcon,
  RefreshCcwIcon,
  RouteIcon,
  ServerIcon,
  SquareIcon,
  ZapIcon,
} from "lucide-react";

import { HealthStatus } from "@/components/health-status";
import { MetricCard } from "@/components/metric-card";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import {
  Button,
  buttonVariants,
} from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getAgentExecutionMetrics } from "@/lib/agent-executions";
import { getDashboard } from "@/lib/dashboard";
import {
  describeDomainEvent,
  eventBadgeVariant,
  formatEventAge,
  shortIdentifier,
} from "@/lib/event-observability";
import { cn } from "@/lib/utils";
import {
  cancelRun,
  retryRun,
} from "@/lib/workflows";

const STATUS_DISPLAY_ORDER: RunStatus[] = [
  "running",
  "blocked",
  "failed",
  "pending",
  "completed",
  "cancelled",
];

type BadgeVariant =
  | "running"
  | "success"
  | "warning"
  | "error"
  | "neutral";

type PrimaryMetricTone =
  | "success"
  | "warning"
  | "running"
  | "brand"
  | "neutral";

type MetricsState =
  | "idle"
  | "loading"
  | "ready"
  | "unavailable";

type MetricsSnapshot = {
  executionId:
    string | null;
  state:
    | "ready"
    | "unavailable";
  cpuPercent:
    number | null;
  memoryBytes:
    number | null;
};

interface DashboardOverviewProps {
  initialData:
    DashboardSummary;
}

/**
 * Maps workflow and execution states to the shared semantic badge variants.
 */
function statusVariant(
  status: string,
): BadgeVariant {
  switch (
    status
  ) {
    case "running":
      return "running";

    case "starting":
      return "warning";

    case "completed":
      return "success";

    case "failed":
      return "error";

    case "blocked":
      return "warning";

    default:
      return "neutral";
  }
}

/**
 * Returns the design-system status-dot class for one workflow state.
 */
function statusDotClass(
  status: RunStatus,
): string {
  switch (
    status
  ) {
    case "running":
      return "bg-status-running";

    case "completed":
      return "bg-status-success";

    case "failed":
      return "bg-status-error";

    case "blocked":
      return "bg-status-warning";

    default:
      return "bg-status-neutral";
  }
}

/**
 * Converts a workflow status identifier into a compact display label.
 */
function statusLabel(
  status: string,
): string {
  return `${status.charAt(0).toUpperCase()}${status.slice(1)}`;
}

/**
 * Returns the total represented by one complete status-count object.
 */
function statusTotal(
  counts:
    DashboardStatusCounts | null,
): number | null {
  if (
    !counts
  ) {
    return null;
  }

  return STATUS_DISPLAY_ORDER.reduce(
    (
      total,
      status,
    ) =>
      total +
      counts[status],
    0,
  );
}

/**
 * Formats byte telemetry without inventing percentage-based capacity information.
 */
function formatBytes(
  value:
    number | null,
): string {
  if (
    value ===
    null
  ) {
    return "Unavailable";
  }

  if (
    value >=
    1024 ** 3
  ) {
    return `${(value / 1024 ** 3).toFixed(2)} GiB`;
  }

  if (
    value >=
    1024 ** 2
  ) {
    return `${(value / 1024 ** 2).toFixed(1)} MiB`;
  }

  if (
    value >=
    1024
  ) {
    return `${(value / 1024).toFixed(1)} KiB`;
  }

  return `${value} B`;
}

/**
 * Formats reported token totals for compact operational display.
 */
function formatTokens(
  value:
    number | null,
): string {
  if (
    value ===
    null
  ) {
    return "Unavailable";
  }

  if (
    value >=
    1_000_000
  ) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }

  if (
    value >=
    1_000
  ) {
    return `${(value / 1_000).toFixed(1)}k`;
  }

  return String(
    value,
  );
}

/**
 * Formats an ISO timestamp in a deterministic UTC representation.
 */
function formatUtc(
  value:
    string | null,
): string {
  if (
    !value
  ) {
    return "Unavailable";
  }

  const parsed =
    new Date(
      value,
    );

  if (
    Number.isNaN(
      parsed.getTime(),
    )
  ) {
    return "Unavailable";
  }

  return `${parsed
    .toISOString()
    .replace(
      "T",
      " ",
    )
    .slice(
      0,
      19,
    )} UTC`;
}

/**
 * Formats elapsed workflow time from authoritative persisted timestamps.
 */
function formatElapsed(
  startedAt: string,
  completedAt:
    string | null,
  now: number,
): string {
  const start =
    Date.parse(
      startedAt,
    );

  const end =
    completedAt
      ? Date.parse(
          completedAt,
        )
      : now;

  if (
    !Number.isFinite(
      start,
    ) ||
    !Number.isFinite(
      end,
    ) ||
    end <
      start
  ) {
    return "Unavailable";
  }

  const totalSeconds =
    Math.floor(
      (
        end -
        start
      ) /
        1000,
    );

  const hours =
    Math.floor(
      totalSeconds /
        3600,
    );

  const minutes =
    Math.floor(
      (
        totalSeconds %
        3600
      ) /
        60,
    );

  const seconds =
    totalSeconds %
    60;

  if (
    hours >
    0
  ) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }

  if (
    minutes >
    0
  ) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

/**
 * Renders a semantic icon treatment for one primary operational metric.
 */
function PrimaryMetricIcon({
  icon: Icon,
  tone,
}: {
  icon: LucideIcon;
  tone:
    PrimaryMetricTone;
}) {
  return (
    <div
      className={cn(
        "flex size-9 items-center justify-center rounded-lg border",
        tone ===
          "success" &&
          "border-status-success/25 bg-status-success/10 text-status-success",
        tone ===
          "warning" &&
          "border-status-warning/25 bg-status-warning/10 text-status-warning",
        tone ===
          "running" &&
          "border-status-running/25 bg-status-running/10 text-status-running",
        tone ===
          "brand" &&
          "border-brand-accent/25 bg-brand-accent/10 text-brand-accent",
        tone ===
          "neutral" &&
          "border-status-neutral/25 bg-status-neutral/10 text-status-neutral",
      )}
    >
      <Icon className="size-5" />
    </div>
  );
}

/**
 * Renders compact nonzero workflow badges for the primary Tasks and Runs metrics.
 */
function StatusBadges({
  counts,
}: {
  counts:
    DashboardStatusCounts | null;
}) {
  if (
    !counts
  ) {
    return (
      <Badge variant="neutral">
        Unavailable
      </Badge>
    );
  }

  const visible =
    STATUS_DISPLAY_ORDER.filter(
      (
        status,
      ) =>
        counts[status] >
        0,
    );

  if (
    visible.length ===
    0
  ) {
    return (
      <Badge variant="neutral">
        No records
      </Badge>
    );
  }

  return (
    <div className="flex flex-wrap gap-1">
      {visible.map(
        (
          status,
        ) => (
          <Badge
            key={
              status
            }
            variant={
              statusVariant(
                status,
              )
            }
          >
            {
              counts[
                status
              ]
            }{" "}
            {
              statusLabel(
                status,
              )
            }
          </Badge>
        ),
      )}
    </div>
  );
}

/**
 * Renders one label/value field inside workflow and execution metadata.
 */
function Detail({
  label,
  children,
}: {
  label: string;
  children:
    React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-text-muted">
        {label}
      </dt>
      <dd className="mt-1 min-w-0 text-sm text-text-primary">
        {children}
      </dd>
    </div>
  );
}

/**
 * Renders one secondary system fact inside the low-emphasis summary strip.
 */
function SecondaryFact({
  icon: Icon,
  label,
  children,
  className,
}: {
  icon: LucideIcon;
  label: string;
  children:
    React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "min-w-0 p-3",
        className,
      )}
    >
      <div className="flex items-center gap-2 text-[11px] font-medium text-text-muted">
        <Icon className="size-4 shrink-0" />
        <span>
          {label}
        </span>
      </div>

      <div className="mt-1.5 min-w-0 text-sm text-text-primary">
        {children}
      </div>
    </div>
  );
}

/**
 * Returns the semantic surface used for a persisted terminal reason.
 */
function terminalReasonClass(
  status: RunStatus,
): string {
  if (
    status ===
    "failed"
  ) {
    return "border-status-error/30 bg-status-error/5";
  }

  if (
    status ===
    "blocked"
  ) {
    return "border-status-warning/30 bg-status-warning/5";
  }

  return "border-status-neutral/30 bg-status-neutral/5";
}

/**
 * Renders the active workflow or most recent task-backed workflow summary.
 */
function CurrentActivityCard({
  activity,
  now,
  actionPending,
  actionError,
  onStop,
  onRetry,
}: {
  activity:
    DashboardActivity | null;
  now: number;
  actionPending:
    boolean;
  actionError:
    string | null;
  onStop:
    () => void;
  onRetry:
    () => void;
}) {
  const canStop =
    activity?.kind ===
      "active" &&
    [
      "pending",
      "running",
    ].includes(
      activity.runStatus,
    );

  const canRetry =
    activity?.kind ===
      "recent" &&
    [
      "failed",
      "blocked",
    ].includes(
      activity.runStatus,
    );

  return (
    <Card className="min-w-0">
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle className="text-sm">
          Current System Activity
        </CardTitle>

        {activity ? (
          <Badge
            variant={
              statusVariant(
                activity.runStatus,
              )
            }
          >
            {
              statusLabel(
                activity.runStatus,
              )
            }
          </Badge>
        ) : null}
      </CardHeader>

      <CardContent className="min-w-0">
        {!activity ? (
          <div className="rounded-lg border border-dashed p-6 text-center">
            <p className="text-sm font-medium text-text-primary">
              No task-backed runs yet
            </p>
            <p className="mt-1 text-xs text-text-muted">
              Start a task to populate system activity.
            </p>
          </div>
        ) : (
          <div className="min-w-0">
            <div className="border-b pb-4">
              <p
                className={cn(
                  "text-[11px] font-medium uppercase tracking-wide",
                  activity.kind ===
                    "active"
                    ? "text-brand-accent"
                    : "text-text-muted",
                )}
              >
                {activity.kind ===
                "active"
                  ? "Active task"
                  : "Most recent task"}
              </p>

              <h3 className="mt-1 text-base font-semibold text-text-primary">
                {activity.taskTitle ??
                  `Run ${shortIdentifier(activity.runId)}`}
              </h3>

              <dl className="mt-4 grid min-w-0 gap-x-5 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
                <Detail label="Run ID">
                  <Link
                    href={`/runs/${activity.runId}`}
                    title={
                      activity.runId
                    }
                    className="font-mono text-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                  >
                    {
                      shortIdentifier(
                        activity.runId,
                      )
                    }
                  </Link>
                </Detail>

                <Detail label="Project">
                  <span
                    title={
                      activity.projectPath
                    }
                    className="block truncate font-mono text-xs text-text-secondary"
                  >
                    {
                      activity.projectPath
                    }
                  </span>
                </Detail>

                <Detail label="Execution">
                  {activity.execution ? (
                    <Link
                      href={`/agent-executions/${activity.execution.id}`}
                      title={
                        activity.execution.id
                      }
                      className="text-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                    >
                      {
                        activity.execution.agentName
                      }
                    </Link>
                  ) : activity.kind ===
                    "active" ? (
                    "Transitioning between executions"
                  ) : (
                    "No recorded execution"
                  )}
                </Detail>

                <Detail label="Layer">
                  {activity.execution
                    ? `Layer ${activity.execution.layer}`
                    : "Unavailable"}
                </Detail>

                <Detail label="Started">
                  <span className="font-mono text-xs">
                    {
                      formatUtc(
                        activity.runCreatedAt,
                      )
                    }
                  </span>
                </Detail>

                <Detail label="Elapsed">
                  <span className="font-mono text-xs">
                    {
                      formatElapsed(
                        activity.runCreatedAt,
                        activity.kind ===
                          "active"
                          ? null
                          : activity.runUpdatedAt,
                        now,
                      )
                    }
                  </span>
                </Detail>
              </dl>

              {activity.terminalReason ? (
                <div
                  className={cn(
                    "mt-4 rounded-md border px-3 py-2 text-xs text-text-secondary",
                    terminalReasonClass(
                      activity.runStatus,
                    ),
                  )}
                >
                  {
                    activity.terminalReason
                  }
                </div>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-2 pt-4">
              <Link
                href={`/runs/${activity.runId}`}
                className={buttonVariants({
                  variant:
                    "outline",
                  size:
                    "sm",
                })}
              >
                <PlayIcon />
                View Run
              </Link>

              <Link
                href="/tasks"
                className={buttonVariants({
                  variant:
                    "outline",
                  size:
                    "sm",
                })}
              >
                <ListTodoIcon />
                Open Tasks
              </Link>

              {activity.execution ? (
                <Link
                  href={`/agent-executions/${activity.execution.id}`}
                  className={buttonVariants({
                    variant:
                      "outline",
                    size:
                      "sm",
                  })}
                >
                  <ActivityIcon />
                  Execution
                </Link>
              ) : null}

              {canRetry ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={
                    actionPending
                  }
                  onClick={
                    onRetry
                  }
                >
                  <RefreshCcwIcon />
                  Retry
                </Button>
              ) : null}

              {canStop ? (
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={
                    actionPending
                  }
                  onClick={
                    onStop
                  }
                >
                  <SquareIcon />
                  Stop
                </Button>
              ) : null}
            </div>

            {actionError ? (
              <p
                role="alert"
                className="mt-3 text-xs text-status-error"
              >
                {
                  actionError
                }
              </p>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Renders one compact execution fact without introducing nested card surfaces.
 */
function ExecutionFact({
  icon: Icon,
  label,
  children,
  className,
}: {
  icon: LucideIcon;
  label: string;
  children:
    React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "min-w-0",
        className,
      )}
    >
      <div className="flex items-center gap-2 text-[11px] text-text-muted">
        <Icon className="size-3.5 shrink-0" />
        <span>
          {label}
        </span>
      </div>

      <div className="mt-1 min-w-0 text-sm font-medium text-text-primary">
        {children}
      </div>
    </div>
  );
}

/**
 * Renders truthful live telemetry only while a current execution is actually active.
 */
function ActiveExecutionCard({
  activity,
  metrics,
  metricsState,
}: {
  activity:
    DashboardActivity;
  metrics: {
    cpuPercent:
      number | null;
    memoryBytes:
      number | null;
  };
  metricsState:
    MetricsState;
}) {
  const execution =
    activity.execution;

  if (
    !execution
  ) {
    return null;
  }

  const cpuValue =
    metricsState ===
    "loading"
      ? "Sampling..."
      : metricsState ===
            "ready" &&
          metrics.cpuPercent !==
            null
        ? `${metrics.cpuPercent.toFixed(1)}%`
        : "Unavailable";

  const memoryValue =
    metricsState ===
    "loading"
      ? "Sampling..."
      : metricsState ===
        "ready"
        ? formatBytes(
            metrics.memoryBytes,
          )
        : "Unavailable";

  const context =
    execution.contextUsage;

  return (
    <Card className="min-w-0">
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div className="min-w-0">
          <CardTitle className="text-sm">
            Active Execution
          </CardTitle>
          <p className="mt-1 truncate text-xs text-text-muted">
            {
              execution.agentName
            }{" "}
            ·{" "}
            {
              execution.agentRole
            }
          </p>
        </div>

        <Badge
          variant={
            statusVariant(
              execution.status,
            )
          }
        >
          {
            statusLabel(
              execution.status,
            )
          }
        </Badge>
      </CardHeader>

      <CardContent className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
          <div className="min-w-0">
            <p
              title={`${execution.harness} · ${execution.model} · ${execution.reasoning}`}
              className="truncate font-mono text-xs text-text-secondary"
            >
              {
                execution.harness
              }{" "}
              ·{" "}
              {
                execution.model
              }{" "}
              ·{" "}
              {
                execution.reasoning
              }
            </p>
          </div>

          <Link
            href={`/agent-executions/${execution.id}`}
            className={buttonVariants({
              variant:
                "outline",
              size:
                "xs",
            })}
          >
            <ActivityIcon />
            View Execution
          </Link>
        </div>

        <div className="grid min-w-0 gap-x-5 gap-y-4 pt-4 sm:grid-cols-2 lg:grid-cols-4">
          <ExecutionFact
            icon={
              Layers3Icon
            }
            label="Layer / Order"
          >
            Layer{" "}
            {
              execution.layer
            }{" "}
            · #{
              execution.executionOrder
            }
          </ExecutionFact>

          <ExecutionFact
            icon={
              ActivityIcon
            }
            label="PID"
          >
            {execution.pid ===
            null
              ? "Unavailable"
              : execution.pid}
          </ExecutionFact>

          <ExecutionFact
            icon={
              CpuIcon
            }
            label="CPU"
          >
            {
              cpuValue
            }
          </ExecutionFact>

          <ExecutionFact
            icon={
              HardDriveIcon
            }
            label="Memory"
          >
            {
              memoryValue
            }
          </ExecutionFact>

          <ExecutionFact
            icon={
              ZapIcon
            }
            label="Reported Tokens"
          >
            {
              formatTokens(
                execution.tokenTotal,
              )
            }
          </ExecutionFact>

          <ExecutionFact
            icon={
              Layers3Icon
            }
            label="Context Usage"
            className="sm:col-span-2"
          >
            {context ? (
              <div>
                <div>
                  {
                    formatTokens(
                      context.used,
                    )
                  }{" "}
                  /{" "}
                  {
                    formatTokens(
                      context.limit,
                    )
                  }{" "}
                  ·{" "}
                  {
                    context.percent.toFixed(
                      1,
                    )
                  }
                  %
                </div>

                <Progress
                  value={
                    context.percent
                  }
                  className="mt-2 max-w-72"
                  aria-label={`Context usage ${context.percent.toFixed(1)} percent`}
                />
              </div>
            ) : (
              "Unavailable"
            )}
          </ExecutionFact>

          {activity.latestCommitHash ? (
            <ExecutionFact
              icon={
                GitCommitHorizontalIcon
              }
              label="Latest Commit"
              className="sm:col-span-2 lg:col-span-4"
            >
              <span
                title={
                  activity.latestCommitHash
                }
                className="block truncate font-mono text-xs"
              >
                {
                  activity.latestCommitHash
                }
              </span>
            </ExecutionFact>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Renders one compact Tasks or Runs health section inside the shared workflow-health card.
 */
function WorkflowStatusSection({
  title,
  counts,
}: {
  title: string;
  counts:
    DashboardStatusCounts | null;
}) {
  if (
    !counts
  ) {
    return (
      <section>
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-xs font-medium text-text-primary">
            {title}
          </h3>
          <Badge variant="neutral">
            Unavailable
          </Badge>
        </div>

        <p className="mt-3 text-xs text-text-muted">
          Database summary unavailable.
        </p>
      </section>
    );
  }

  return (
    <section>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xs font-medium text-text-primary">
          {title}
        </h3>

        <div className="text-right">
          <span className="font-heading text-lg font-semibold text-text-primary">
            {
              statusTotal(
                counts,
              )
            }
          </span>
          <span className="ml-1 text-[11px] text-text-muted">
            total
          </span>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-5 gap-y-2">
        {STATUS_DISPLAY_ORDER.map(
          (
            status,
          ) => (
            <div
              key={
                status
              }
              className="flex min-w-0 items-center justify-between gap-3 text-xs"
            >
              <span className="flex min-w-0 items-center gap-2 text-text-secondary">
                <span
                  aria-hidden="true"
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    statusDotClass(
                      status,
                    ),
                  )}
                />
                <span className="truncate">
                  {
                    statusLabel(
                      status,
                    )
                  }
                </span>
              </span>

              <span className="font-mono font-medium text-text-primary">
                {
                  counts[
                    status
                  ]
                }
              </span>
            </div>
          ),
        )}
      </div>
    </section>
  );
}

/**
 * Renders consolidated task and run health without nested status cards.
 */
function WorkflowHealthCard({
  tasks,
  runs,
}: {
  tasks:
    DashboardStatusCounts | null;
  runs:
    DashboardStatusCounts | null;
}) {
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="text-sm">
          Workflow Health
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        <WorkflowStatusSection
          title="Tasks by Status"
          counts={
            tasks
          }
        />

        <Separator />

        <WorkflowStatusSection
          title="Runs by Status"
          counts={
            runs
          }
        />
      </CardContent>
    </Card>
  );
}

/**
 * Renders Run and Execution links associated with one dashboard event.
 */
function EventContext({
  event,
}: {
  event:
    DomainEvent;
}) {
  if (
    !event.runId &&
    !event.agentExecutionId
  ) {
    return (
      <span className="text-text-muted">
        System
      </span>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {event.runId ? (
        <Link
          href={`/runs/${event.runId}`}
          title={
            event.runId
          }
          className="text-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          Run{" "}
          {
            shortIdentifier(
              event.runId,
            )
          }
        </Link>
      ) : null}

      {event.agentExecutionId ? (
        <Link
          href={`/agent-executions/${event.agentExecutionId}`}
          title={
            event.agentExecutionId
          }
          className="text-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          Execution
        </Link>
      ) : null}
    </div>
  );
}

/**
 * Renders the bounded newest-first dashboard event preview.
 */
function RecentEventsCard({
  events,
  now,
}: {
  events:
    DomainEvent[];
  now: number;
}) {
  return (
    <Card className="min-w-0">
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle className="text-sm">
          Recent System Events
        </CardTitle>

        <Link
          href="/events"
          className={buttonVariants({
            variant:
              "outline",
            size:
              "xs",
          })}
        >
          View All
        </Link>
      </CardHeader>

      <CardContent className="min-w-0">
        {events.length ===
        0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-text-muted">
            No domain events recorded yet.
          </div>
        ) : (
          <Table className="min-w-[720px]">
            <TableHeader>
              <TableRow>
                <TableHead className="w-24 text-xs text-text-muted">
                  Time
                </TableHead>
                <TableHead className="w-52 text-xs text-text-muted">
                  Type
                </TableHead>
                <TableHead className="text-xs text-text-muted">
                  Description
                </TableHead>
                <TableHead className="w-56 text-xs text-text-muted">
                  Context
                </TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {events.map(
                (
                  event,
                ) => (
                  <TableRow
                    key={
                      event.id
                    }
                  >
                    <TableCell className="text-[11px] text-text-muted">
                      {
                        formatEventAge(
                          event.createdAt,
                          now,
                        )
                      }
                    </TableCell>

                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={
                            eventBadgeVariant(
                              event,
                            )
                          }
                          className="size-4 rounded-full p-0"
                          aria-label={
                            event.type
                          }
                        >
                          <span
                            aria-hidden="true"
                            className="size-1 rounded-full bg-current"
                          />
                        </Badge>

                        <span className="font-mono text-xs font-medium text-text-primary">
                          {
                            event.type
                          }
                        </span>
                      </div>
                    </TableCell>

                    <TableCell className="whitespace-normal text-xs leading-5 text-text-secondary">
                      {
                        describeDomainEvent(
                          event,
                        )
                      }
                    </TableCell>

                    <TableCell className="text-xs">
                      <EventContext
                        event={
                          event
                        }
                      />
                    </TableCell>
                  </TableRow>
                ),
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Coordinates bounded dashboard refresh, active execution telemetry polling, and operator controls.
 */
export function DashboardOverview({
  initialData,
}: DashboardOverviewProps) {
  const [
    data,
    setData,
  ] =
    useState(
      initialData,
    );

  const [
    now,
    setNow,
  ] =
    useState(
      () =>
        Date.parse(
          initialData.generatedAt,
        ),
    );

  const [
    refreshError,
    setRefreshError,
  ] =
    useState<
      string | null
    >(null);

  const [
    isRefreshing,
    setIsRefreshing,
  ] =
    useState(
      false,
    );

  const [
    actionPending,
    setActionPending,
  ] =
    useState(
      false,
    );

  const [
    actionError,
    setActionError,
  ] =
    useState<
      string | null
    >(null);

  const [
    metricsSnapshot,
    setMetricsSnapshot,
  ] =
    useState<MetricsSnapshot>({
      executionId:
        null,
      state:
        "unavailable",
      cpuPercent:
        null,
      memoryBytes:
        null,
    });

  const isActiveRun =
    data.activity?.kind ===
      "active" &&
    [
      "pending",
      "running",
    ].includes(
      data.activity.runStatus,
    );

  const executionId =
    data.activity?.execution?.id ??
    null;

  const shouldPollMetrics =
    Boolean(
      isActiveRun &&
        data.activity?.execution &&
        [
          "starting",
          "running",
        ].includes(
          data.activity.execution.status,
        ),
    );

  const metricsState:
    MetricsState =
    !shouldPollMetrics ||
    !executionId
      ? "idle"
      : metricsSnapshot.executionId !==
          executionId
        ? "loading"
        : metricsSnapshot.state;

  const metrics =
    metricsSnapshot.executionId ===
    executionId
      ? {
          cpuPercent:
            metricsSnapshot.cpuPercent,
          memoryBytes:
            metricsSnapshot.memoryBytes,
        }
      : {
          cpuPercent:
            null,
          memoryBytes:
            null,
        };

  /**
   * Refreshes the bounded dashboard summary while retaining stale data on transient failure.
   */
  const refreshDashboard =
    useCallback(
      async (
        showIndicator =
          false,
      ) => {
        if (
          showIndicator
        ) {
          setIsRefreshing(
            true,
          );
        }

        try {
          const next =
            await getDashboard();

          setData(
            next,
          );

          setNow(
            Date.parse(
              next.generatedAt,
            ),
          );

          setRefreshError(
            null,
          );
        } catch (
          error
        ) {
          setRefreshError(
            error instanceof
              Error
              ? error.message
              : "Unable to refresh dashboard",
          );
        } finally {
          if (
            showIndicator
          ) {
            setIsRefreshing(
              false,
            );
          }
        }
      },
      [],
    );

  useEffect(
    () => {
      if (
        !isActiveRun
      ) {
        return;
      }

      const timer =
        window.setInterval(
          () => {
            void refreshDashboard(
              false,
            );
          },
          10_000,
        );

      return () => {
        window.clearInterval(
          timer,
        );
      };
    },
    [
      isActiveRun,
      refreshDashboard,
    ],
  );

  useEffect(
    () => {
      if (
        !isActiveRun
      ) {
        return;
      }

      const timer =
        window.setInterval(
          () => {
            setNow(
              Date.now(),
            );
          },
          1_000,
        );

      return () => {
        window.clearInterval(
          timer,
        );
      };
    },
    [
      isActiveRun,
    ],
  );

  useEffect(
    () => {
      if (
        !shouldPollMetrics ||
        !executionId
      ) {
        return;
      }

      const activeExecutionId =
        executionId;

      let cancelled =
        false;

      /**
       * Reads one live process sample from the existing bounded metrics endpoint.
       */
      async function pollMetrics() {
        try {
          const next =
            await getAgentExecutionMetrics(
              activeExecutionId,
            );

          if (
            !cancelled
          ) {
            setMetricsSnapshot({
              executionId:
                activeExecutionId,
              state:
                "ready",
              cpuPercent:
                next.cpuPercent,
              memoryBytes:
                next.memoryBytes,
            });
          }
        } catch {
          if (
            !cancelled
          ) {
            setMetricsSnapshot({
              executionId:
                activeExecutionId,
              state:
                "unavailable",
              cpuPercent:
                null,
              memoryBytes:
                null,
            });
          }
        }
      }

      void pollMetrics();

      const timer =
        window.setInterval(
          () => {
            void pollMetrics();
          },
          5_000,
        );

      return () => {
        cancelled =
          true;

        window.clearInterval(
          timer,
        );
      };
    },
    [
      executionId,
      shouldPollMetrics,
    ],
  );

  /**
   * Cancels the currently active workflow through the existing run-control API.
   */
  async function handleStop() {
    if (
      !data.activity
    ) {
      return;
    }

    setActionPending(
      true,
    );

    setActionError(
      null,
    );

    try {
      await cancelRun(
        data.activity.runId,
      );

      await refreshDashboard(
        false,
      );
    } catch (
      error
    ) {
      setActionError(
        error instanceof
          Error
          ? error.message
          : "Unable to stop run",
      );
    } finally {
      setActionPending(
        false,
      );
    }
  }

  /**
   * Retries the most recent failed or blocked workflow through the existing retry API.
   */
  async function handleRetry() {
    if (
      !data.activity
    ) {
      return;
    }

    setActionPending(
      true,
    );

    setActionError(
      null,
    );

    try {
      await retryRun(
        data.activity.runId,
      );

      await refreshDashboard(
        false,
      );
    } catch (
      error
    ) {
      setActionError(
        error instanceof
          Error
          ? error.message
          : "Unable to retry run",
      );
    } finally {
      setActionPending(
        false,
      );
    }
  }

  const taskTotal =
    statusTotal(
      data.tasks,
    );

  const runTotal =
    statusTotal(
      data.runs,
    );

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-text-primary">
            Dashboard
          </h1>
          <p className="mt-1 text-sm text-text-muted">
            System overview and operational status
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <HealthStatus
            health={
              data.health
            }
            compact
          />

          <Button
            variant="outline"
            size="sm"
            disabled={
              isRefreshing
            }
            onClick={() =>
              void refreshDashboard(
                true,
              )
            }
          >
            <RefreshCcwIcon
              className={
                isRefreshing
                  ? "animate-spin"
                  : undefined
              }
            />
            Refresh
          </Button>

          <ThemeToggle />
        </div>
      </header>

      {data.databaseError ||
      data.projects.error ||
      refreshError ? (
        <div
          role="status"
          aria-live="polite"
          className="flex items-start gap-2 rounded-lg border border-status-warning/30 bg-status-warning/5 px-3 py-2 text-xs text-text-secondary"
        >
          <CircleAlertIcon className="mt-0.5 size-4 shrink-0 text-status-warning" />
          <span>
            {refreshError ??
              data.databaseError ??
              data.projects.error}
          </span>
        </div>
      ) : null}

      <section
        aria-label="Operational overview"
        className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
      >
        <MetricCard
          className="h-full"
          label="System Health"
          value={
            data.health.status ===
            "ok"
              ? "Healthy"
              : "Degraded"
          }
          icon={
            <PrimaryMetricIcon
              icon={
                ServerIcon
              }
              tone={
                data.health.status ===
                "ok"
                  ? "success"
                  : "warning"
              }
            />
          }
          footer={
            <div className="flex flex-wrap gap-1">
              <Badge
                variant={
                  data.health.status ===
                  "ok"
                    ? "success"
                    : "warning"
                }
              >
                App{" "}
                {data.health.status ===
                "ok"
                  ? "Operational"
                  : "Degraded"}
              </Badge>

              <Badge
                variant={
                  data.health.db ===
                  "up"
                    ? "success"
                    : "error"
                }
              >
                DB{" "}
                {data.health.db ===
                "up"
                  ? "Operational"
                  : "Down"}
              </Badge>
            </div>
          }
        />

        <MetricCard
          className="h-full"
          label="Active Work"
          value={
            isActiveRun
              ? "Running"
              : "Idle"
          }
          icon={
            <PrimaryMetricIcon
              icon={
                RouteIcon
              }
              tone={
                isActiveRun
                  ? "running"
                  : "neutral"
              }
            />
          }
          footer={
            isActiveRun &&
            data.activity ? (
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <Badge variant="running">
                  Running
                </Badge>

                <span
                  className="truncate"
                  title={
                    data.activity.execution
                      ? `${data.activity.execution.agentName} · Layer ${data.activity.execution.layer}`
                      : "Transitioning between executions"
                  }
                >
                  {data.activity.execution
                    ? `${data.activity.execution.agentName} · Layer ${data.activity.execution.layer}`
                    : "Transitioning"}{" "}
                  ·{" "}
                  {
                    formatElapsed(
                      data.activity.runCreatedAt,
                      null,
                      now,
                    )
                  }
                </span>
              </div>
            ) : data.activity ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge
                  variant={
                    statusVariant(
                      data.activity.runStatus,
                    )
                  }
                >
                  {
                    statusLabel(
                      data.activity.runStatus,
                    )
                  }
                </Badge>

                <span>
                  Most recent run
                </span>
              </div>
            ) : (
              <Badge variant="neutral">
                No activity
              </Badge>
            )
          }
        />

        <MetricCard
          className="h-full"
          label="Tasks"
          value={
            taskTotal ===
            null
              ? "Unavailable"
              : String(
                  taskTotal,
                )
          }
          icon={
            <PrimaryMetricIcon
              icon={
                ListTodoIcon
              }
              tone="brand"
            />
          }
          footer={
            <StatusBadges
              counts={
                data.tasks
              }
            />
          }
        />

        <MetricCard
          className="h-full"
          label="Runs"
          value={
            runTotal ===
            null
              ? "Unavailable"
              : String(
                  runTotal,
                )
          }
          icon={
            <PrimaryMetricIcon
              icon={
                PlayIcon
              }
              tone="running"
            />
          }
          footer={
            <StatusBadges
              counts={
                data.runs
              }
            />
          }
        />
      </section>

      <Card
        size="sm"
        className="gap-0 py-0"
      >
        <CardContent className="grid min-w-0 grid-cols-1 px-0 sm:grid-cols-2 xl:grid-cols-[1.35fr_1fr_2fr_1.15fr]">
          <SecondaryFact
            icon={
              FolderGit2Icon
            }
            label="Projects"
            className="border-b sm:border-r xl:border-b-0"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-heading text-lg font-semibold">
                {
                  data.projects.discovered
                }
              </span>
              <span className="text-xs text-text-muted">
                Discovered
              </span>
            </div>

            <div className="mt-1.5 flex flex-wrap gap-1">
              <Badge variant="success">
                {
                  data.projects.clean
                }{" "}
                Clean
              </Badge>
              <Badge variant="warning">
                {
                  data.projects.dirty
                }{" "}
                Dirty
              </Badge>
              <Badge variant="neutral">
                {
                  data.projects.unknown
                }{" "}
                Unknown
              </Badge>
            </div>
          </SecondaryFact>

          <SecondaryFact
            icon={
              BotIcon
            }
            label="Agents"
            className="border-b xl:border-b-0 xl:border-r"
          >
            {data.agents ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-heading text-lg font-semibold">
                  {
                    data.agents.configured
                  }
                </span>
                <span className="text-xs text-text-muted">
                  configured
                </span>

                <Badge variant="success">
                  {
                    data.agents.enabled
                  }{" "}
                  enabled
                </Badge>
              </div>
            ) : (
              <span className="text-text-muted">
                Unavailable
              </span>
            )}
          </SecondaryFact>

          <SecondaryFact
            icon={
              FolderGit2Icon
            }
            label="Workspace Root"
            className="border-b sm:border-b-0 sm:border-r"
          >
            <span
              title={
                data.projects.workspaceRoot
              }
              className="block truncate font-mono text-xs text-text-secondary"
            >
              {
                data.projects.workspaceRoot
              }
            </span>
          </SecondaryFact>

          <SecondaryFact
            icon={
              Clock3Icon
            }
            label="Summary Generated"
          >
            <span className="block truncate font-mono text-xs text-text-secondary">
              {
                formatUtc(
                  data.generatedAt,
                )
              }
            </span>
          </SecondaryFact>
        </CardContent>
      </Card>

      <div className="grid min-w-0 items-stretch gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]">
        <CurrentActivityCard
          activity={
            data.activity
          }
          now={
            now
          }
          actionPending={
            actionPending
          }
          actionError={
            actionError
          }
          onStop={() =>
            void handleStop()
          }
          onRetry={() =>
            void handleRetry()
          }
        />

        <WorkflowHealthCard
          tasks={
            data.tasks
          }
          runs={
            data.runs
          }
        />
      </div>

      {shouldPollMetrics &&
      data.activity?.kind ===
        "active" &&
      data.activity.execution ? (
        <ActiveExecutionCard
          activity={
            data.activity
          }
          metrics={
            metrics
          }
          metricsState={
            metricsState
          }
        />
      ) : null}

      <RecentEventsCard
        events={
          data.recentEvents
        }
        now={
          now
        }
      />
    </div>
  );
}
