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
import type { LucideIcon } from "lucide-react";
import {
  ActivityIcon,
  BotIcon,
  CheckCircle2Icon,
  CircleAlertIcon,
  Clock3Icon,
  CpuIcon,
  DatabaseIcon,
  FolderGit2Icon,
  GitCommitHorizontalIcon,
  HardDriveIcon,
  Layers3Icon,
  ListTodoIcon,
  MessageSquareIcon,
  PlayIcon,
  RefreshCcwIcon,
  RouteIcon,
  ServerIcon,
  SquareIcon,
  XCircleIcon,
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
import {
  getAgentExecutionMetrics,
} from "@/lib/agent-executions";
import { getDashboard } from "@/lib/dashboard";
import {
  cancelRun,
  retryRun,
} from "@/lib/workflows";

const STATUS_ORDER: RunStatus[] = [
  "pending",
  "running",
  "completed",
  "failed",
  "blocked",
  "cancelled",
];

type BadgeVariant =
  | "running"
  | "success"
  | "warning"
  | "error"
  | "neutral";

type MetricsState =
  | "idle"
  | "loading"
  | "ready"
  | "unavailable";

interface DashboardOverviewProps {
  initialData: DashboardSummary;
}

/**
 * Maps workflow states to the shared semantic badge variants.
 */
function statusVariant(status: string): BadgeVariant {
  switch (status) {
    case "running":
      return "running";
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
 * Converts a workflow status identifier into a compact display label.
 */
function statusLabel(status: string): string {
  return `${status.charAt(0).toUpperCase()}${status.slice(1)}`;
}

/**
 * Returns the total represented by one complete status-count object.
 */
function statusTotal(
  counts: DashboardStatusCounts | null,
): number | null {
  if (!counts) {
    return null;
  }

  return STATUS_ORDER.reduce(
    (total, status) => total + counts[status],
    0,
  );
}

/**
 * Formats byte telemetry without inventing a percentage or capacity.
 */
function formatBytes(value: number | null): string {
  if (value === null) {
    return "Unavailable";
  }

  if (value >= 1024 ** 3) {
    return `${(value / 1024 ** 3).toFixed(2)} GiB`;
  }

  if (value >= 1024 ** 2) {
    return `${(value / 1024 ** 2).toFixed(1)} MiB`;
  }

  if (value >= 1024) {
    return `${(value / 1024).toFixed(1)} KiB`;
  }

  return `${value} B`;
}

/**
 * Formats reported token totals for compact dashboard display.
 */
function formatTokens(value: number | null): string {
  if (value === null) {
    return "Unavailable";
  }

  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }

  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}k`;
  }

  return String(value);
}

/**
 * Formats an ISO timestamp in a deterministic UTC representation.
 */
function formatUtc(value: string | null): string {
  if (!value) {
    return "Unavailable";
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return "Unavailable";
  }

  return `${parsed
    .toISOString()
    .replace("T", " ")
    .slice(0, 19)} UTC`;
}

/**
 * Formats elapsed workflow time from authoritative persisted timestamps.
 */
function formatElapsed(
  startedAt: string,
  completedAt: string | null,
  now: number,
): string {
  const start = Date.parse(startedAt);
  const end = completedAt
    ? Date.parse(completedAt)
    : now;

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end < start
  ) {
    return "Unavailable";
  }

  const totalSeconds = Math.floor(
    (end - start) / 1000,
  );
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor(
    (totalSeconds % 3600) / 60,
  );
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

/**
 * Formats an event timestamp relative to the current dashboard clock.
 */
function formatAge(
  createdAt: string,
  now: number,
): string {
  const timestamp = Date.parse(createdAt);

  if (!Number.isFinite(timestamp)) {
    return "Unknown";
  }

  const seconds = Math.max(
    0,
    Math.floor((now - timestamp) / 1000),
  );

  if (seconds < 60) {
    return `${seconds}s ago`;
  }

  const minutes = Math.floor(seconds / 60);

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return `${hours}h ago`;
  }

  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * Produces a short visual identifier while preserving full IDs in links and titles.
 */
function shortId(value: string): string {
  return value.slice(0, 8);
}

/**
 * Reads a string field from event payload data without assuming provider-specific structure.
 */
function eventString(
  event: DomainEvent,
  key: string,
): string | null {
  const value = event.data[key];

  return typeof value === "string"
    ? value
    : null;
}

/**
 * Reads a numeric field from event payload data without coercing unknown data.
 */
function eventNumber(
  event: DomainEvent,
  key: string,
): number | null {
  const value = event.data[key];

  return typeof value === "number" &&
    Number.isFinite(value)
    ? value
    : null;
}

/**
 * Creates a concise operator description from currently persisted domain-event fields.
 */
function describeEvent(event: DomainEvent): string {
  switch (event.type) {
    case "run.started":
      return eventString(event, "title")
        ? `Run started for ${eventString(event, "title")}`
        : "Run started";
    case "agent.started": {
      const layer = eventNumber(event, "layer");

      return layer === null
        ? "Agent execution started"
        : `Agent execution started on layer ${layer}`;
    }
    case "result.received":
      return eventString(event, "status")
        ? `Structured result received: ${eventString(event, "status")}`
        : "Structured result received";
    case "route.selected":
      return eventString(event, "outcome")
        ? `Workflow route selected after ${eventString(event, "outcome")}`
        : "Workflow route selected";
    case "execution.retried":
      return "Execution retry requested";
    case "run.completed":
      return "Run completed";
    case "run.blocked":
      return "Run blocked";
    case "run.failed":
      return "Run failed";
    case "run.cancelled":
      return "Run cancelled";
    default:
      return event.type;
  }
}

/**
 * Chooses semantic event styling from the persisted event outcome.
 */
function eventVariant(
  event: DomainEvent,
): BadgeVariant {
  if (
    event.type.includes("failed")
  ) {
    return "error";
  }

  if (
    event.type.includes("blocked")
  ) {
    return "warning";
  }

  if (
    event.type.includes("completed")
  ) {
    return "success";
  }

  if (
    event.type.includes("cancelled")
  ) {
    return "neutral";
  }

  return "running";
}

/**
 * Renders compact nonzero status badges for overview metric cards.
 */
function StatusBadges({
  counts,
}: {
  counts: DashboardStatusCounts | null;
}) {
  if (!counts) {
    return (
      <Badge variant="neutral">
        Unavailable
      </Badge>
    );
  }

  const visible = STATUS_ORDER.filter(
    (status) => counts[status] > 0,
  );

  if (visible.length === 0) {
    return (
      <Badge variant="neutral">
        No records
      </Badge>
    );
  }

  return (
    <div className="flex flex-wrap gap-1">
      {visible.map((status) => (
        <Badge
          key={status}
          variant={statusVariant(status)}
        >
          {counts[status]} {statusLabel(status)}
        </Badge>
      ))}
    </div>
  );
}

/**
 * Renders one label/value row in an activity detail grid.
 */
function Detail({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
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
  activity: DashboardActivity | null;
  now: number;
  actionPending: boolean;
  actionError: string | null;
  onStop: () => void;
  onRetry: () => void;
}) {
  const canStop =
    activity?.kind === "active" &&
    ["pending", "running"].includes(
      activity.runStatus,
    );

  const canRetry =
    activity?.kind === "recent" &&
    ["failed", "blocked"].includes(
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
            variant={statusVariant(
              activity.runStatus,
            )}
          >
            {statusLabel(activity.runStatus)}
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
              Start a task to populate system
              activity.
            </p>
          </div>
        ) : (
          <div className="flex min-w-0 flex-col gap-5">
            <div className="rounded-lg border bg-surface-interactive/30 p-4">
              <p className="text-[11px] uppercase tracking-wide text-text-muted">
                {activity.kind === "active"
                  ? "Active task"
                  : "Most recent task"}
              </p>

              <h3 className="mt-1 text-base font-semibold text-text-primary">
                {activity.taskTitle ??
                  `Run ${shortId(
                    activity.runId,
                  )}`}
              </h3>

              <dl className="mt-4 grid min-w-0 gap-4 sm:grid-cols-2">
                <Detail label="Run ID">
                  <Link
                    href={`/runs/${activity.runId}`}
                    title={activity.runId}
                    className="font-mono text-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                  >
                    {shortId(activity.runId)}
                  </Link>
                </Detail>

                <Detail label="Project">
                  <span
                    title={activity.projectPath}
                    className="block truncate font-mono text-xs text-text-secondary"
                  >
                    {activity.projectPath}
                  </span>
                </Detail>

                <Detail label="Execution">
                  {activity.execution ? (
                    <Link
                      href={`/agent-executions/${activity.execution.id}`}
                      className="text-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                    >
                      {activity.execution.agentName}
                    </Link>
                  ) : activity.kind === "active" ? (
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
                    {formatUtc(
                      activity.runCreatedAt,
                    )}
                  </span>
                </Detail>

                <Detail label="Elapsed">
                  <span className="font-mono text-xs">
                    {formatElapsed(
                      activity.runCreatedAt,
                      activity.kind === "active"
                        ? null
                        : activity.runUpdatedAt,
                      now,
                    )}
                  </span>
                </Detail>
              </dl>

              {activity.terminalReason ? (
                <div className="mt-4 rounded-md border border-status-warning/30 bg-status-warning/5 px-3 py-2 text-xs text-text-secondary">
                  {activity.terminalReason}
                </div>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-2">
              <Link
                href={`/runs/${activity.runId}`}
                className={buttonVariants({
                  variant: "outline",
                  size: "sm",
                })}
              >
                <PlayIcon />
                View Run
              </Link>

              <Link
                href="/tasks"
                className={buttonVariants({
                  variant: "outline",
                  size: "sm",
                })}
              >
                <ListTodoIcon />
                Open Tasks
              </Link>

              {activity.execution ? (
                <Link
                  href={`/agent-executions/${activity.execution.id}`}
                  className={buttonVariants({
                    variant: "outline",
                    size: "sm",
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
                  disabled={actionPending}
                  onClick={onRetry}
                >
                  <RefreshCcwIcon />
                  Retry
                </Button>
              ) : null}

              {canStop ? (
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={actionPending}
                  onClick={onStop}
                >
                  <SquareIcon />
                  Stop
                </Button>
              ) : null}
            </div>

            {actionError ? (
              <p
                role="alert"
                className="text-xs text-status-error"
              >
                {actionError}
              </p>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Renders one execution telemetry tile with an optional truthful percentage bar.
 */
function UsageTile({
  icon: Icon,
  label,
  value,
  progress,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  progress?: number | null;
}) {
  const boundedProgress =
    progress === undefined ||
    progress === null
      ? null
      : Math.min(
          100,
          Math.max(0, progress),
        );

  return (
    <div className="min-w-0 rounded-lg border bg-surface-interactive/20 p-3">
      <div className="flex items-center gap-2 text-xs text-text-muted">
        <Icon className="size-4" />
        <span>{label}</span>
      </div>

      <p className="mt-3 truncate font-heading text-xl font-semibold text-text-primary">
        {value}
      </p>

      {boundedProgress !== null ? (
        <Progress
          value={boundedProgress}
          className="mt-3"
          aria-label={`${label} ${boundedProgress.toFixed(
            1,
          )} percent`}
        />
      ) : null}
    </div>
  );
}

/**
 * Renders live process metrics and persisted provider usage for the selected execution.
 */
function ExecutionHealthCard({
  activity,
  metrics,
  metricsState,
}: {
  activity: DashboardActivity | null;
  metrics: {
    cpuPercent: number | null;
    memoryBytes: number | null;
  };
  metricsState: MetricsState;
}) {
  const execution = activity?.execution ?? null;

  const cpuValue =
    metricsState === "loading"
      ? "Sampling..."
      : metricsState === "ready" &&
          metrics.cpuPercent !== null
        ? `${metrics.cpuPercent.toFixed(1)}%`
        : "Unavailable";

  const memoryValue =
    metricsState === "loading"
      ? "Sampling..."
      : metricsState === "ready"
        ? formatBytes(metrics.memoryBytes)
        : "Unavailable";

  const context = execution?.contextUsage ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">
          Execution Health and Usage
        </CardTitle>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <UsageTile
            icon={CpuIcon}
            label="CPU Usage"
            value={cpuValue}
            progress={
              metricsState === "ready"
                ? metrics.cpuPercent
                : null
            }
          />

          <UsageTile
            icon={HardDriveIcon}
            label="Memory Usage"
            value={memoryValue}
          />

          <UsageTile
            icon={ZapIcon}
            label="Reported Tokens"
            value={formatTokens(
              execution?.tokenTotal ?? null,
            )}
          />

          <UsageTile
            icon={Layers3Icon}
            label="Context Usage"
            value={
              context
                ? `${formatTokens(
                    context.used,
                  )} / ${formatTokens(
                    context.limit,
                  )}`
                : "Unavailable"
            }
            progress={context?.percent ?? null}
          />
        </div>

        <div className="rounded-lg border p-3">
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <GitCommitHorizontalIcon className="size-4" />
            Latest Recorded Commit
          </div>

          <p className="mt-2 break-all font-mono text-sm text-text-primary">
            {activity?.latestCommitHash ??
              "Unavailable"}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Renders a complete six-state count list for tasks or runs.
 */
function StatusList({
  title,
  counts,
}: {
  title: string;
  counts: DashboardStatusCounts | null;
}) {
  if (!counts) {
    return (
      <div className="rounded-lg border p-4">
        <p className="text-sm font-medium text-text-primary">
          {title}
        </p>
        <p className="mt-4 text-sm text-text-muted">
          Database summary unavailable.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border p-4">
      <p className="text-sm font-medium text-text-primary">
        {title}
      </p>

      <div className="mt-4 space-y-2.5">
        {STATUS_ORDER.map((status) => (
          <div
            key={status}
            className="flex items-center justify-between gap-4 text-sm"
          >
            <span className="flex items-center gap-2 text-text-secondary">
              <span
                aria-hidden="true"
                className={[
                  "size-2 rounded-full",
                  status === "running"
                    ? "bg-status-running"
                    : status === "completed"
                      ? "bg-status-success"
                      : status === "failed"
                        ? "bg-status-error"
                        : status === "blocked"
                          ? "bg-status-warning"
                          : "bg-status-neutral",
                ].join(" ")}
              />
              {statusLabel(status)}
            </span>

            <span className="font-mono font-medium text-text-primary">
              {counts[status]}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between border-t pt-3 text-sm">
        <span className="text-text-muted">
          Total
        </span>
        <span className="font-mono font-semibold text-text-primary">
          {statusTotal(counts)}
        </span>
      </div>
    </div>
  );
}

/**
 * Renders truthful task and run status aggregates side by side.
 */
function StatusOverviewCard({
  tasks,
  runs,
}: {
  tasks: DashboardStatusCounts | null;
  runs: DashboardStatusCounts | null;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">
          Status Overview
        </CardTitle>
      </CardHeader>

      <CardContent className="grid gap-3 md:grid-cols-2">
        <StatusList
          title="Tasks by Status"
          counts={tasks}
        />
        <StatusList
          title="Runs by Status"
          counts={runs}
        />
      </CardContent>
    </Card>
  );
}

/**
 * Renders recent persisted domain events with links to available detail routes.
 */
function RecentEventsCard({
  events,
  now,
}: {
  events: DomainEvent[];
  now: number;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle className="text-sm">
          Recent System Events
        </CardTitle>
        <ActivityIcon className="size-4 text-text-muted" />
      </CardHeader>

      <CardContent>
        {events.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-text-muted">
            No domain events recorded yet.
          </div>
        ) : (
          <div className="divide-y">
            {events.map((event) => (
              <div
                key={event.id}
                className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-3 py-3"
              >
                <div className="pt-0.5">
                  <Badge
                    variant={eventVariant(
                      event,
                    )}
                    className="size-5 rounded-full p-0"
                    aria-label={event.type}
                  >
                    <span
                      aria-hidden="true"
                      className="size-1.5 rounded-full bg-current"
                    />
                  </Badge>
                </div>

                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-mono text-xs font-medium text-text-primary">
                      {event.type}
                    </span>
                    <span className="text-[11px] text-text-muted">
                      {formatAge(
                        event.createdAt,
                        now,
                      )}
                    </span>
                  </div>

                  <p className="mt-1 text-xs leading-5 text-text-secondary">
                    {describeEvent(event)}
                  </p>

                  <div className="mt-1 flex flex-wrap gap-3 text-xs">
                    {event.runId ? (
                      <Link
                        href={`/runs/${event.runId}`}
                        className="text-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                      >
                        Run{" "}
                        {shortId(event.runId)}
                      </Link>
                    ) : null}

                    {event.agentExecutionId ? (
                      <Link
                        href={`/agent-executions/${event.agentExecutionId}`}
                        className="text-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                      >
                        Execution
                      </Link>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Renders authoritative filesystem project counts and deterministic run-based activity.
 */
function ProjectsSummaryCard({
  data,
}: {
  data: DashboardSummary;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle className="text-sm">
          Projects Summary
        </CardTitle>
        <Link
          href="/projects"
          className={buttonVariants({
            variant: "outline",
            size: "xs",
          })}
        >
          View All
        </Link>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-2">
          <div>
            <p className="font-heading text-xl font-semibold text-text-primary">
              {data.projects.discovered}
            </p>
            <p className="text-xs text-text-muted">
              Discovered
            </p>
          </div>

          <div>
            <p className="font-heading text-xl font-semibold text-status-success">
              {data.projects.clean}
            </p>
            <p className="text-xs text-text-muted">
              Clean
            </p>
          </div>

          <div>
            <p className="font-heading text-xl font-semibold text-status-warning">
              {data.projects.dirty}
            </p>
            <p className="text-xs text-text-muted">
              Dirty
            </p>
          </div>

          <div>
            <p className="font-heading text-xl font-semibold text-status-neutral">
              {data.projects.unknown}
            </p>
            <p className="text-xs text-text-muted">
              Unknown
            </p>
          </div>
        </div>

        {data.projects.error ? (
          <div className="rounded-md border border-status-warning/30 bg-status-warning/5 p-3 text-xs text-text-secondary">
            {data.projects.error}
          </div>
        ) : null}

        {data.projectActivity.length > 0 ? (
          <div className="border-t pt-4">
            <p className="mb-3 text-xs font-medium text-text-primary">
              Top Projects by Run Count
            </p>

            <div className="space-y-3">
              {data.projectActivity.map(
                (project) => (
                  <div
                    key={project.projectPath}
                    className="flex min-w-0 items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-text-primary">
                        {project.projectName}
                      </p>
                      <p
                        title={project.projectPath}
                        className="truncate font-mono text-[11px] text-text-muted"
                      >
                        {project.projectPath}
                      </p>
                    </div>

                    <Badge variant="running">
                      {project.runCount} runs
                    </Badge>
                  </div>
                ),
              )}
            </div>
          </div>
        ) : null}

        <p
          title={data.projects.workspaceRoot}
          className="truncate border-t pt-3 font-mono text-[11px] text-text-muted"
        >
          {data.projects.workspaceRoot}
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * Renders only navigation destinations that are implemented by the current repository.
 */
function QuickNavigationCard({
  activity,
}: {
  activity: DashboardActivity | null;
}) {
  const items: Array<{
    title: string;
    href: string;
    icon: LucideIcon;
  }> = [
    {
      title: "Projects",
      href: "/projects",
      icon: FolderGit2Icon,
    },
    {
      title: "Tasks",
      href: "/tasks",
      icon: ListTodoIcon,
    },
    {
      title: "Runs",
      href: "/runs",
      icon: PlayIcon,
    },
    {
      title: "Agents",
      href: "/agents",
      icon: BotIcon,
    },
    {
      title: "Orchestrator",
      href: "/orchestrator",
      icon: MessageSquareIcon,
    },
  ];

  if (activity?.execution) {
    items.push({
      title: "Execution",
      href: `/agent-executions/${activity.execution.id}`,
      icon: ActivityIcon,
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">
          Quick Navigation
        </CardTitle>
      </CardHeader>

      <CardContent className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-2 2xl:grid-cols-3">
        {items.map((item) => {
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex min-h-20 flex-col items-center justify-center gap-2 rounded-lg border bg-surface-interactive/20 p-3 text-center text-xs font-medium text-text-secondary transition-colors hover:bg-surface-interactive hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              <Icon className="size-5" />
              {item.title}
            </Link>
          );
        })}
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
  const [data, setData] =
    useState(initialData);
  const [now, setNow] = useState(
    () => Date.parse(initialData.generatedAt),
  );
  const [refreshError, setRefreshError] =
    useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] =
    useState(false);
  const [actionPending, setActionPending] =
    useState(false);
  const [actionError, setActionError] =
    useState<string | null>(null);
  const [metrics, setMetrics] = useState<{
    cpuPercent: number | null;
    memoryBytes: number | null;
  }>({
    cpuPercent: null,
    memoryBytes: null,
  });
  const [metricsState, setMetricsState] =
    useState<MetricsState>("idle");

  const isActiveRun =
    data.activity?.kind === "active" &&
    ["pending", "running"].includes(
      data.activity.runStatus,
    );

  const executionId =
    data.activity?.execution?.id ?? null;

  const shouldPollMetrics =
    isActiveRun &&
    data.activity?.execution !== null &&
    ["starting", "running"].includes(
      data.activity?.execution?.status ?? "",
    );

  /**
   * Refreshes the bounded dashboard summary while retaining stale data on transient failure.
   */
  const refreshDashboard = useCallback(
    async (showIndicator = false) => {
      if (showIndicator) {
        setIsRefreshing(true);
      }

      try {
        const next = await getDashboard();

        setData(next);
        setNow(Date.parse(next.generatedAt));
        setRefreshError(null);
      } catch (error) {
        setRefreshError(
          error instanceof Error
            ? error.message
            : "Unable to refresh dashboard",
        );
      } finally {
        if (showIndicator) {
          setIsRefreshing(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    if (!isActiveRun) {
      return;
    }

    const timer = window.setInterval(() => {
      void refreshDashboard(false);
    }, 10_000);

    return () => {
      window.clearInterval(timer);
    };
  }, [isActiveRun, refreshDashboard]);

  useEffect(() => {
    if (!isActiveRun) {
      return;
    }

    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1_000);

    return () => {
      window.clearInterval(timer);
    };
  }, [isActiveRun]);

  useEffect(() => {
    setMetrics({
      cpuPercent: null,
      memoryBytes: null,
    });

    if (
      !shouldPollMetrics ||
      !executionId
    ) {
      setMetricsState("idle");
      return;
    }

    let cancelled = false;

    setMetricsState("loading");

    /**
     * Reads one live process sample from the existing bounded metrics endpoint.
     */
    async function pollMetrics() {
      try {
        const next =
          await getAgentExecutionMetrics(
            executionId!,
          );

        if (!cancelled) {
          setMetrics(next);
          setMetricsState("ready");
        }
      } catch {
        if (!cancelled) {
          setMetricsState("unavailable");
        }
      }
    }

    void pollMetrics();

    const timer = window.setInterval(() => {
      void pollMetrics();
    }, 5_000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [executionId, shouldPollMetrics]);

  /**
   * Cancels the currently active workflow through the existing run control API.
   */
  async function handleStop() {
    if (!data.activity) {
      return;
    }

    setActionPending(true);
    setActionError(null);

    try {
      await cancelRun(data.activity.runId);
      await refreshDashboard(false);
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "Unable to stop run",
      );
    } finally {
      setActionPending(false);
    }
  }

  /**
   * Retries the most recent failed or blocked workflow through the existing retry API.
   */
  async function handleRetry() {
    if (!data.activity) {
      return;
    }

    setActionPending(true);
    setActionError(null);

    try {
      await retryRun(data.activity.runId);
      await refreshDashboard(false);
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "Unable to retry run",
      );
    } finally {
      setActionPending(false);
    }
  }

  const taskTotal = statusTotal(data.tasks);
  const runTotal = statusTotal(data.runs);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-text-primary">
            Dashboard
          </h1>
          <p className="mt-1 text-sm text-text-muted">
            System overview and operational
            status
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <HealthStatus
            health={data.health}
            compact
          />

          <Button
            variant="outline"
            size="sm"
            disabled={isRefreshing}
            onClick={() =>
              void refreshDashboard(true)
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
        className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8"
      >
        <MetricCard
          label="Application Health"
          value={
            data.health.status === "ok"
              ? "Healthy"
              : "Degraded"
          }
          icon={
            <ServerIcon className="size-4" />
          }
          footer={
            <HealthStatus
              health={data.health}
              compact
            />
          }
        />

        <MetricCard
          label="Database Health"
          value={
            data.health.db === "up"
              ? "Healthy"
              : "Unavailable"
          }
          icon={
            <DatabaseIcon className="size-4" />
          }
          footer={
            <Badge
              variant={
                data.health.db === "up"
                  ? "success"
                  : "error"
              }
            >
              {data.health.db === "up"
                ? "Operational"
                : "Down"}
            </Badge>
          }
        />

        <MetricCard
          label="Discovered Projects"
          value={String(
            data.projects.discovered,
          )}
          icon={
            <FolderGit2Icon className="size-4" />
          }
          footer={
            <div className="flex flex-wrap gap-1">
              <Badge variant="success">
                {data.projects.clean} Clean
              </Badge>
              <Badge variant="warning">
                {data.projects.dirty} Dirty
              </Badge>
              {data.projects.unknown > 0 ? (
                <Badge variant="neutral">
                  {data.projects.unknown} Unknown
                </Badge>
              ) : null}
            </div>
          }
        />

        <MetricCard
          label="Agents Configured"
          value={
            data.agents
              ? String(
                  data.agents.configured,
                )
              : "Unavailable"
          }
          icon={
            <BotIcon className="size-4" />
          }
        />

        <MetricCard
          label="Agents Enabled"
          value={
            data.agents
              ? String(data.agents.enabled)
              : "Unavailable"
          }
          icon={
            <CheckCircle2Icon className="size-4" />
          }
        />

        <MetricCard
          label="Tasks Overview"
          value={
            taskTotal === null
              ? "Unavailable"
              : String(taskTotal)
          }
          icon={
            <ListTodoIcon className="size-4" />
          }
          footer={
            <StatusBadges
              counts={data.tasks}
            />
          }
        />

        <MetricCard
          label="Runs Overview"
          value={
            runTotal === null
              ? "Unavailable"
              : String(runTotal)
          }
          icon={
            <PlayIcon className="size-4" />
          }
          footer={
            <StatusBadges
              counts={data.runs}
            />
          }
        />

        <MetricCard
          label="Active Workflow"
          value={isActiveRun ? "1" : "0"}
          icon={
            <RouteIcon className="size-4" />
          }
          footer={
            <Badge
              variant={
                isActiveRun
                  ? "running"
                  : "neutral"
              }
            >
              {isActiveRun
                ? "Running"
                : "Idle"}
            </Badge>
          }
        />
      </section>

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1.2fr)_minmax(280px,0.78fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <CurrentActivityCard
            activity={data.activity}
            now={now}
            actionPending={actionPending}
            actionError={actionError}
            onStop={() => void handleStop()}
            onRetry={() =>
              void handleRetry()
            }
          />

          <ExecutionHealthCard
            activity={data.activity}
            metrics={metrics}
            metricsState={metricsState}
          />
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <StatusOverviewCard
            tasks={data.tasks}
            runs={data.runs}
          />

          <RecentEventsCard
            events={data.recentEvents}
            now={now}
          />
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <ProjectsSummaryCard
            data={data}
          />

          <QuickNavigationCard
            activity={data.activity}
          />
        </div>
      </div>

      <footer className="grid gap-3 border-t pt-4 text-[11px] text-text-muted sm:grid-cols-2">
        <div className="min-w-0">
          <span className="mr-2 font-medium text-text-secondary">
            Workspace Root
          </span>
          <span
            title={data.projects.workspaceRoot}
            className="font-mono"
          >
            {data.projects.workspaceRoot}
          </span>
        </div>

        <div className="sm:text-right">
          <span className="mr-2 font-medium text-text-secondary">
            Summary Generated
          </span>
          <span className="font-mono">
            {formatUtc(data.generatedAt)}
          </span>
        </div>
      </footer>
    </div>
  );
}
