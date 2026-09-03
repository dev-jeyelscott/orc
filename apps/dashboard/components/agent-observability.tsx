"use client";

import {
  ActivityIcon,
  CopyIcon,
  CpuIcon,
  Edit3Icon,
  GitCommitIcon,
  MemoryStickIcon,
} from "lucide-react";
import {
  Bar,
  BarChart,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
} from "recharts";

import type {
  AgentMonitoringRange,
  AgentObservability,
  AgentRecentExecution,
  AgentWithRoutes,
} from "@orc/shared";

import {
  AGENT_TIME_RANGE_OPTIONS,
  calculateApprovalRate,
  calculateResultSuccessRate,
  calculateRouteHealth,
  formatBytes,
  formatIdentifier,
} from "@/lib/agent-presentation";
import {
  formatCompactNumber,
  formatDuration,
  formatRelativeTime,
  shortIdentifier,
} from "@/lib/run-observability";

import {
  Badge,
} from "@/components/ui/badge";
import {
  Button,
} from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Progress,
} from "@/components/ui/progress";

type ProcessMetrics = {
  cpuPercent:
    number | null;
  memoryBytes:
    number | null;
};

type AgentInspectorProps = {
  agent:
    AgentWithRoutes;
  agents:
    AgentWithRoutes[];
  observability:
    AgentObservability | null;
  loading: boolean;
  error:
    string | null;
  range:
    AgentMonitoringRange;
  liveMetrics:
    ProcessMetrics | null;
  onEdit:
    () => void;
};

type BadgeVariant =
  | "running"
  | "success"
  | "warning"
  | "error"
  | "neutral";

const activityChartConfig = {
  count: {
    label:
      "Executions",
    color:
      "var(--status-running)",
  },
} satisfies ChartConfig;

const tokenChartConfig = {
  averageTokens: {
    label:
      "Average Tokens",
    color:
      "var(--brand-accent)",
  },
} satisfies ChartConfig;

const routeChartConfig = {
  agentTarget: {
    label:
      "Enabled Agent Target",
    color:
      "var(--status-success)",
  },
  terminal: {
    label:
      "Enabled Terminal",
    color:
      "var(--status-warning)",
  },
  disabled: {
    label:
      "Disabled",
    color:
      "var(--status-disabled)",
  },
} satisfies ChartConfig;

/**
 * Maps execution lifecycle status onto existing semantic badge variants.
 */
function executionVariant(
  status:
    AgentRecentExecution["status"],
): BadgeVariant {
  switch (status) {
    case "running":
      return "running";
    case "starting":
    case "pending":
      return "warning";
    case "completed":
      return "success";
    case "failed":
      return "error";
    case "blocked":
      return "warning";
    case "cancelled":
    default:
      return "neutral";
  }
}

/**
 * Calculates duration for a bounded recent-execution DTO.
 */
function recentExecutionDuration(
  execution:
    AgentRecentExecution,
): number | null {
  if (
    !execution.startedAt ||
    !execution.completedAt
  ) {
    return null;
  }

  const start =
    Date.parse(
      execution.startedAt,
    );

  const end =
    Date.parse(
      execution.completedAt,
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

/**
 * Copies a stable identifier using the browser clipboard API when available.
 */
async function copyText(
  value: string,
): Promise<void> {
  await navigator.clipboard
    .writeText(value);
}

/**
 * Returns a human-readable label for the selected monitoring window.
 */
function rangeLabel(
  range:
    AgentMonitoringRange,
): string {
  return (
    AGENT_TIME_RANGE_OPTIONS.find(
      (option) =>
        option.value ===
        range,
    )?.label ?? range
  );
}

/**
 * Renders one compact telemetry value with a secondary operator label.
 */
function MiniMetric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?:
    string;
}) {
  return (
    <div className="min-w-0 rounded-md border border-divider bg-surface-interactive/30 p-2.5">
      <p className="text-[10px] font-medium uppercase tracking-wide text-text-muted">
        {label}
      </p>

      <p className="mt-1 truncate font-heading text-sm font-semibold text-text-primary">
        {value}
      </p>

      {detail ? (
        <p className="mt-0.5 truncate text-[10px] text-text-muted">
          {detail}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Renders one yes/no configuration capability without relying on color alone.
 */
function Capability({
  label,
  enabled,
}: {
  label: string;
  enabled: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="text-text-muted">
        {label}
      </span>

      <span className="inline-flex items-center gap-1.5 font-medium text-text-secondary">
        <span
          className={
            enabled
              ? "size-1.5 rounded-full bg-status-success"
              : "size-1.5 rounded-full bg-status-disabled"
          }
          aria-hidden="true"
        />

        {enabled
          ? "Yes"
          : "No"}
      </span>
    </div>
  );
}

/**
 * Renders selected-agent configuration, explicit routes, and persisted/live execution observability.
 */
export function AgentInspector({
  agent,
  agents,
  observability,
  loading,
  error,
  range,
  liveMetrics,
  onEdit,
}: AgentInspectorProps) {
  const agentsById =
    new Map(
      agents.map(
        (candidate) => [
          candidate.id,
          candidate,
        ],
      ),
    );

  const successRate =
    observability
      ? calculateResultSuccessRate(
          observability.successfulResults,
          observability.resultCount,
        )
      : null;

  const approvalRate =
    observability
      ? calculateApprovalRate(
          observability.approvedResults,
          observability.changesRequestedResults,
        )
      : null;

  const tokenDataAvailable =
    observability?.tokenBuckets.some(
      (bucket) =>
        bucket.averageTokens !==
        null,
    ) ?? false;

  const activityAvailable =
    observability?.activityBuckets.some(
      (bucket) =>
        bucket.count > 0,
    ) ?? false;

  return (
    <div className="grid min-w-0 gap-3">
      <Card size="sm">
        <CardHeader className="border-b border-divider">
          <div className="flex items-center justify-between gap-3">
            <CardTitle>
              Selected Agent
            </CardTitle>

            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={
                onEdit
              }
            >
              <Edit3Icon />
              Edit
            </Button>
          </div>
        </CardHeader>

        <CardContent className="grid gap-4">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate font-heading text-base font-semibold text-text-primary">
                  {
                    agent.name
                  }
                </h2>

                <Badge
                  variant={
                    agent.enabled
                      ? "success"
                      : "disabled"
                  }
                >
                  {agent.enabled
                    ? "Enabled"
                    : "Disabled"}
                </Badge>
              </div>

              <p className="mt-1 truncate text-xs text-text-muted">
                {
                  agent.role
                }
              </p>
            </div>

            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              onClick={() =>
                void copyText(
                  agent.id,
                )
              }
              aria-label="Copy agent ID"
            >
              <CopyIcon />
            </Button>
          </div>

          <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1.5 text-xs">
            <dt className="text-text-muted">
              ID
            </dt>
            <dd className="truncate font-mono text-text-secondary">
              {
                agent.id
              }
            </dd>

            <dt className="text-text-muted">
              Slug
            </dt>
            <dd className="truncate font-mono text-text-secondary">
              {
                agent.slug
              }
            </dd>

            <dt className="text-text-muted">
              Description
            </dt>
            <dd className="text-text-secondary">
              {agent.description ||
                "No description"}
            </dd>

            <dt className="text-text-muted">
              Layer
            </dt>
            <dd className="text-text-secondary">
              {
                agent.layer
              }
            </dd>

            <dt className="text-text-muted">
              Execution Order
            </dt>
            <dd className="text-text-secondary">
              {
                agent.executionOrder
              }
            </dd>

            <dt className="text-text-muted">
              Harness
            </dt>
            <dd className="text-text-secondary">
              {
                agent.harness
              }
            </dd>

            <dt className="text-text-muted">
              Model
            </dt>
            <dd className="truncate font-mono text-text-secondary">
              {
                agent.model
              }
            </dd>

            <dt className="text-text-muted">
              Reasoning
            </dt>
            <dd className="text-text-secondary">
              {
                agent.reasoning
              }
            </dd>
          </dl>

          <div className="grid gap-1.5 rounded-md border border-divider p-2.5">
            <Capability
              label="Can Write"
              enabled={
                agent.canWrite
              }
            />

            <Capability
              label="Can Run Commands"
              enabled={
                agent.canRunCommands
              }
            />

            <Capability
              label="Can Commit"
              enabled={
                agent.canCommit
              }
            />
          </div>

          <div>
            <p className="mb-1.5 text-xs font-medium text-text-secondary">
              System Prompt
              Preview
            </p>

            <pre className="line-clamp-5 whitespace-pre-wrap rounded-md border border-divider bg-bg-app/60 p-2.5 font-mono text-[10px] leading-relaxed text-text-muted">
              {
                agent.systemPrompt
              }
            </pre>
          </div>

          <p className="text-[10px] leading-relaxed text-text-muted">
            Active runs
            retain their own
            immutable agent
            snapshots.
            Configuration
            changes affect
            future runs only.
          </p>
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader className="border-b border-divider">
          <CardTitle>
            Routes
          </CardTitle>
        </CardHeader>

        <CardContent className="p-0">
          {agent.routes.length ===
          0 ? (
            <p className="p-3 text-xs text-text-muted">
              No explicit
              routing overrides
              configured.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[31rem] text-left text-[11px]">
                <thead className="border-b border-divider text-text-muted">
                  <tr>
                    <th className="px-3 py-2 font-medium">
                      Outcome
                    </th>
                    <th className="px-3 py-2 font-medium">
                      Target
                    </th>
                    <th className="px-3 py-2 font-medium">
                      Terminal
                    </th>
                    <th className="px-3 py-2 font-medium">
                      Enabled
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {agent.routes.map(
                    (
                      route,
                    ) => (
                      <tr
                        key={
                          route.id
                        }
                        className="border-b border-divider last:border-0"
                      >
                        <td className="px-3 py-2 font-mono text-text-secondary">
                          {
                            route.outcome
                          }
                        </td>

                        <td className="px-3 py-2 text-text-secondary">
                          {route.targetAgentId
                            ? agentsById.get(
                                route.targetAgentId,
                              )
                                ?.name ??
                              "Unavailable target"
                            : "None"}
                        </td>

                        <td className="px-3 py-2 font-mono text-text-secondary">
                          {route.terminalAction ??
                            "None"}
                        </td>

                        <td className="px-3 py-2">
                          <Badge
                            variant={
                              route.enabled
                                ? "success"
                                : "disabled"
                            }
                          >
                            {route.enabled
                              ? "Yes"
                              : "No"}
                          </Badge>
                        </td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader className="border-b border-divider">
          <div className="flex items-center justify-between gap-3">
            <CardTitle>
              Live
              Observability
            </CardTitle>

            <span className="text-[10px] text-text-muted">
              {rangeLabel(
                range,
              )}
            </span>
          </div>
        </CardHeader>

        <CardContent className="grid gap-3">
          {error ? (
            <p
              role="alert"
              className="rounded-md border border-status-error/30 bg-status-error/10 p-2 text-xs text-status-error"
            >
              {error}
            </p>
          ) : null}

          {loading &&
          !observability ? (
            <p className="text-xs text-text-muted">
              Loading
              execution
              telemetry...
            </p>
          ) : null}

          {observability ? (
            <>
              <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
                <MiniMetric
                  label="Success Rate"
                  value={
                    successRate ===
                    null
                      ? "Unavailable"
                      : `${successRate.toFixed(
                          1,
                        )}%`
                  }
                  detail={`${observability.resultCount} results`}
                />

                <MiniMetric
                  label="Approval Rate"
                  value={
                    approvalRate ===
                    null
                      ? "Unavailable"
                      : `${approvalRate.toFixed(
                          1,
                        )}%`
                  }
                  detail="Approved vs changes requested"
                />

                <MiniMetric
                  label="Avg Runtime"
                  value={formatDuration(
                    observability.averageDurationMs,
                  )}
                  detail={`${observability.totalExecutions} executions`}
                />

                <MiniMetric
                  label="Avg Tokens"
                  value={formatCompactNumber(
                    observability.averageTokens,
                  )}
                  detail={
                    observability.tokenTelemetryExecutions >
                    0
                      ? `${observability.tokenTelemetryExecutions} telemetry samples`
                      : "Telemetry unavailable"
                  }
                />

                <MiniMetric
                  label="Latest Exit"
                  value={
                    observability.latestExitCode ===
                    null
                      ? "Unavailable"
                      : String(
                          observability.latestExitCode,
                        )
                  }
                />

                <MiniMetric
                  label="Last Run"
                  value={shortIdentifier(
                    observability.lastActiveRunId,
                  )}
                />

                <MiniMetric
                  label="Last Commit"
                  value={shortIdentifier(
                    observability.lastCommitHash,
                  )}
                />

                <MiniMetric
                  label="Active"
                  value={String(
                    observability.activeExecutionCount,
                  )}
                />
              </div>

              <div className="grid gap-2 rounded-md border border-divider p-2.5">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-text-muted">
                    Context Usage
                  </span>

                  <span className="font-medium text-text-secondary">
                    {observability.contextUsagePercent ===
                    null
                      ? "Unavailable"
                      : `${observability.contextUsagePercent.toFixed(
                          1,
                        )}%`}
                  </span>
                </div>

                {observability.contextUsagePercent !==
                null ? (
                  <Progress
                    value={
                      observability.contextUsagePercent
                    }
                    className="[&_[data-slot=progress-indicator]]:bg-status-success"
                  />
                ) : null}
              </div>

              {observability.activeExecution ? (
                <div className="grid grid-cols-2 gap-2">
                  <MiniMetric
                    label="CPU"
                    value={
                      liveMetrics?.cpuPercent ===
                        null ||
                      liveMetrics?.cpuPercent ===
                        undefined
                        ? "Unavailable"
                        : `${liveMetrics.cpuPercent.toFixed(
                            1,
                          )}%`
                    }
                    detail="Live process"
                  />

                  <MiniMetric
                    label="Memory"
                    value={formatBytes(
                      liveMetrics?.memoryBytes ??
                        null,
                    )}
                    detail="Live process"
                  />
                </div>
              ) : null}

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-md border border-divider p-2.5">
                  <div className="mb-2 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-text-muted">
                    <ActivityIcon className="size-3" />
                    Activity
                  </div>

                  {activityAvailable ? (
                    <ChartContainer
                      config={
                        activityChartConfig
                      }
                      className="h-16 w-full aspect-auto"
                      initialDimension={{
                        width: 280,
                        height: 64,
                      }}
                    >
                      <BarChart
                        data={
                          observability.activityBuckets
                        }
                      >
                        <Bar
                          dataKey="count"
                          fill="var(--status-running)"
                          radius={[
                            2,
                            2,
                            0,
                            0,
                          ]}
                        />
                      </BarChart>
                    </ChartContainer>
                  ) : (
                    <p className="py-4 text-center text-[10px] text-text-muted">
                      No executions
                      in range
                    </p>
                  )}
                </div>

                <div className="rounded-md border border-divider p-2.5">
                  <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-text-muted">
                    Token Trend
                  </div>

                  {tokenDataAvailable ? (
                    <ChartContainer
                      config={
                        tokenChartConfig
                      }
                      className="h-16 w-full aspect-auto"
                      initialDimension={{
                        width: 280,
                        height: 64,
                      }}
                    >
                      <LineChart
                        data={
                          observability.tokenBuckets
                        }
                      >
                        <Line
                          type="monotone"
                          dataKey="averageTokens"
                          stroke="var(--brand-accent)"
                          strokeWidth={1.5}
                          dot={false}
                          connectNulls={false}
                        />
                      </LineChart>
                    </ChartContainer>
                  ) : (
                    <p className="py-4 text-center text-[10px] text-text-muted">
                      Token
                      telemetry
                      unavailable
                    </p>
                  )}
                </div>
              </div>

              {observability.activeExecution ? (
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="flex items-center gap-2 rounded-md border border-divider p-2">
                    <CpuIcon className="size-3.5 text-status-running" />
                    <span className="truncate text-text-muted">
                      Execution{" "}
                      <span className="font-mono text-text-secondary">
                        {shortIdentifier(
                          observability.activeExecution.id,
                        )}
                      </span>
                    </span>
                  </div>

                  <div className="flex items-center gap-2 rounded-md border border-divider p-2">
                    <MemoryStickIcon className="size-3.5 text-brand-accent" />
                    <span className="text-text-muted">
                      Process
                      telemetry
                      active
                    </span>
                  </div>
                </div>
              ) : null}

              <div>
                <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-text-muted">
                  Recent Runs
                </p>

                {observability.recentExecutions.length ===
                0 ? (
                  <p className="rounded-md border border-divider p-3 text-xs text-text-muted">
                    No executions
                    in this
                    reporting range.
                  </p>
                ) : (
                  <div className="divide-y divide-divider rounded-md border border-divider">
                    {observability.recentExecutions.map(
                      (
                        execution,
                      ) => (
                        <div
                          key={
                            execution.id
                          }
                          className="grid grid-cols-[auto_1fr_auto] items-center gap-2 p-2"
                        >
                          <Badge
                            variant={executionVariant(
                              execution.status,
                            )}
                          >
                            {formatIdentifier(
                              execution.status,
                            )}
                          </Badge>

                          <div className="min-w-0">
                            <p className="truncate font-mono text-[10px] text-text-secondary">
                              Run{" "}
                              {shortIdentifier(
                                execution.runId,
                              )}
                            </p>

                            <p className="truncate text-[10px] text-text-muted">
                              {execution.resultStatus
                                ? formatIdentifier(
                                    execution.resultStatus,
                                  )
                                : "No structured result"}
                            </p>
                          </div>

                          <div className="text-right text-[10px] text-text-muted">
                            <p>
                              {formatDuration(
                                recentExecutionDuration(
                                  execution,
                                ),
                              )}
                            </p>

                            <p>
                              {formatRelativeTime(
                                execution.updatedAt,
                              )}
                            </p>
                          </div>
                        </div>
                      ),
                    )}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap gap-3 text-[10px] text-text-muted">
                <span className="inline-flex items-center gap-1">
                  <GitCommitIcon className="size-3" />
                  Commit data
                  shown only
                  when persisted
                </span>

                <span className="inline-flex items-center gap-1">
                  <CpuIcon className="size-3" />
                  CPU and
                  memory are
                  live-only
                </span>
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

type AgentRouteHealthProps = {
  agents:
    AgentWithRoutes[];
};

/**
 * Renders a mutually exclusive persisted-route health breakdown.
 */
export function AgentRouteHealth({
  agents,
}: AgentRouteHealthProps) {
  const health =
    calculateRouteHealth(
      agents,
    );

  const data = [
    {
      key:
        "agentTarget",
      label:
        "Enabled Agent Targets",
      value:
        health.enabledAgentTargets,
      fill:
        "var(--status-success)",
    },
    {
      key:
        "terminal",
      label:
        "Enabled Terminal",
      value:
        health.enabledTerminalRoutes,
      fill:
        "var(--status-warning)",
    },
    {
      key:
        "disabled",
      label:
        "Disabled",
      value:
        health.disabledRoutes,
      fill:
        "var(--status-disabled)",
    },
  ];

  return (
    <Card
      size="sm"
      className="h-full"
    >
      <CardHeader className="border-b border-divider">
        <CardTitle>
          Route Health
        </CardTitle>
      </CardHeader>

      <CardContent className="grid min-h-40 gap-3 sm:grid-cols-[9rem_1fr] sm:items-center">
        {health.total > 0 ? (
          <ChartContainer
            config={
              routeChartConfig
            }
            className="mx-auto h-32 w-32 aspect-square"
            initialDimension={{
              width: 128,
              height: 128,
            }}
          >
            <PieChart>
              <Pie
                data={
                  data
                }
                dataKey="value"
                nameKey="label"
                innerRadius={34}
                outerRadius={54}
                strokeWidth={0}
              >
                {data.map(
                  (
                    item,
                  ) => (
                    <Cell
                      key={
                        item.key
                      }
                      fill={
                        item.fill
                      }
                    />
                  ),
                )}
              </Pie>
            </PieChart>
          </ChartContainer>
        ) : (
          <div className="flex h-32 items-center justify-center text-xs text-text-muted">
            No routes
          </div>
        )}

        <div className="grid gap-2 text-xs">
          {data.map(
            (item) => (
              <div
                key={
                  item.key
                }
                className="flex items-center justify-between gap-3"
              >
                <span className="flex min-w-0 items-center gap-2 text-text-muted">
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{
                      backgroundColor:
                        item.fill,
                    }}
                  />

                  <span className="truncate">
                    {
                      item.label
                    }
                  </span>
                </span>

                <span className="font-medium text-text-secondary">
                  {
                    item.value
                  }
                </span>
              </div>
            ),
          )}

          <div className="mt-1 flex items-center justify-between border-t border-divider pt-2">
            <span className="text-text-muted">
              Total
            </span>

            <span className="font-medium text-text-primary">
              {
                health.total
              }
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
