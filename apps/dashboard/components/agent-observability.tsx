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

export type AgentProcessMetrics = {
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
  onEdit:
    () => void;
};

type AgentLiveObservabilityProps = {
  agent:
    AgentWithRoutes;
  observability:
    AgentObservability | null;
  loading: boolean;
  error:
    string | null;
  range:
    AgentMonitoringRange;
  liveMetrics:
    AgentProcessMetrics | null;
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
 * Maps execution lifecycle status onto the existing semantic badge variants.
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
 * Calculates one bounded recent-execution duration from authoritative timestamps.
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
    !Number.isFinite(
      start,
    ) ||
    !Number.isFinite(
      end,
    ) ||
    end < start
  ) {
    return null;
  }

  return end - start;
}

/**
 * Copies a stable persisted identifier using the browser clipboard API.
 */
async function copyText(
  value: string,
): Promise<void> {
  await navigator.clipboard.writeText(
    value,
  );
}

/**
 * Returns the configured human-readable monitoring-window label.
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
    )?.label ??
    range
  );
}

/**
 * Renders one compact operator metric with optional supporting context.
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

      <p
        title={
          value
        }
        className="mt-1 truncate font-heading text-sm font-semibold text-text-primary"
      >
        {value}
      </p>

      {detail ? (
        <p
          title={
            detail
          }
          className="mt-0.5 truncate text-[10px] text-text-muted"
        >
          {detail}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Renders one yes/no capability without relying on color alone.
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
 * Resolves one persisted explicit route into a concise operator destination label.
 */
function routeDestination(
  agent:
    AgentWithRoutes,
  agentsById:
    Map<
      string,
      AgentWithRoutes
    >,
): Array<{
  id: string;
  outcome: string;
  destination: string;
  enabled: boolean;
}> {
  return agent.routes.map(
    (route) => {
      const destination =
        route.targetAgentId
          ? agentsById.get(
              route.targetAgentId,
            )?.name ??
            "Unavailable target"
          : route.terminalAction
            ? formatIdentifier(
                route.terminalAction,
              )
            : "No destination";

      return {
        id:
          route.id,
        outcome:
          formatIdentifier(
            route.outcome,
          ),
        destination,
        enabled:
          route.enabled,
      };
    },
  );
}

/**
 * Renders the compact persisted configuration inspector for the currently selected agent.
 */
export function AgentInspector({
  agent,
  agents,
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

  const routes =
    routeDestination(
      agent,
      agentsById,
    );

  return (
    <Card
      size="sm"
      className="min-w-0 self-start"
    >
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

            {agent.description ? (
              <p className="mt-1 text-[10px] leading-relaxed text-text-muted">
                {
                  agent.description
                }
              </p>
            ) : null}
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

        <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-xs">
          <dt className="text-text-muted">
            ID
          </dt>
          <dd
            title={
              agent.id
            }
            className="truncate font-mono text-text-secondary"
          >
            {
              agent.id
            }
          </dd>

          <dt className="text-text-muted">
            Slug
          </dt>
          <dd
            title={
              agent.slug
            }
            className="truncate font-mono text-text-secondary"
          >
            {
              agent.slug
            }
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
            Order
          </dt>
          <dd className="text-text-secondary">
            {
              agent.executionOrder
            }
          </dd>

          <dt className="text-text-muted">
            Harness
          </dt>
          <dd className="font-mono text-text-secondary">
            {
              agent.harness
            }
          </dd>

          <dt className="text-text-muted">
            Model
          </dt>
          <dd
            title={
              agent.model
            }
            className="truncate font-mono text-text-secondary"
          >
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

        <div className="grid gap-1.5 rounded-md border border-divider bg-surface-interactive/20 p-2.5">
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

        <section>
          <p className="mb-1.5 text-xs font-medium text-text-secondary">
            System Prompt
            Preview
          </p>

          <pre className="line-clamp-5 whitespace-pre-wrap rounded-md border border-divider bg-bg-app/60 p-2.5 font-mono text-[10px] leading-relaxed text-text-muted">
            {
              agent.systemPrompt
            }
          </pre>
        </section>

        <section>
          <div className="mb-1.5 flex items-center justify-between gap-3">
            <p className="text-xs font-medium text-text-secondary">
              Routes
            </p>

            <span className="text-[10px] text-text-muted">
              {
                routes.length
              }{" "}
              configured
            </span>
          </div>

          {routes.length ===
          0 ? (
            <p className="rounded-md border border-divider p-2.5 text-[10px] text-text-muted">
              No explicit
              routing overrides
              configured.
            </p>
          ) : (
            <div className="divide-y divide-divider rounded-md border border-divider">
              {routes.map(
                (route) => (
                  <div
                    key={
                      route.id
                    }
                    className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 p-2.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[10px] font-medium text-text-secondary">
                        {
                          route.outcome
                        }
                      </p>

                      <p
                        title={
                          route.destination
                        }
                        className="mt-0.5 truncate text-[10px] text-text-muted"
                      >
                        →{" "}
                        {
                          route.destination
                        }
                      </p>
                    </div>

                    <Badge
                      variant={
                        route.enabled
                          ? "success"
                          : "disabled"
                      }
                      className="h-4 px-1.5 text-[9px]"
                    >
                      {route.enabled
                        ? "Enabled"
                        : "Disabled"}
                    </Badge>
                  </div>
                ),
              )}
            </div>
          )}
        </section>

        <p className="border-t border-divider pt-3 text-[10px] leading-relaxed text-text-muted">
          Active runs retain
          their own immutable
          agent snapshots.
          Configuration changes
          affect future runs
          only.
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * Renders the selected agent's already-fetched persisted and live execution observability across the full page width.
 */
export function AgentLiveObservability({
  agent,
  observability,
  loading,
  error,
  range,
  liveMetrics,
}: AgentLiveObservabilityProps) {
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

  const hasActiveExecution =
    Boolean(
      observability
        ?.activeExecution,
    );

  return (
    <Card
      size="sm"
      className="min-w-0"
    >
      <CardHeader className="border-b border-divider">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <ActivityIcon className="size-4 shrink-0 text-brand-accent" />

            <CardTitle>
              Live
              Observability
            </CardTitle>

            <span className="hidden truncate text-[10px] text-text-muted sm:inline">
              Selected:{" "}
              {
                agent.name
              }
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[10px] text-text-muted">
              {rangeLabel(
                range,
              )}
            </span>

            {hasActiveExecution ? (
              <Badge variant="running">
                Live
              </Badge>
            ) : null}
          </div>
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
          <p className="py-8 text-center text-xs text-text-muted">
            Loading execution
            telemetry...
          </p>
        ) : null}

        {!loading &&
        !error &&
        !observability ? (
          <p className="py-8 text-center text-xs text-text-muted">
            No observability
            snapshot is
            available for this
            agent.
          </p>
        ) : null}

        {observability ? (
          <>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-8">
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
                detail="Approved vs changes"
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
                    ? `${observability.tokenTelemetryExecutions} samples`
                    : "Unavailable"
                }
              />

              <MiniMetric
                label="Context Usage"
                value={
                  observability.contextUsagePercent ===
                  null
                    ? "Unavailable"
                    : `${observability.contextUsagePercent.toFixed(
                        1,
                      )}%`
                }
                detail={
                  observability.contextTelemetryExecutions >
                  0
                    ? `${observability.contextTelemetryExecutions} samples`
                    : "Unavailable"
                }
              />

              <MiniMetric
                label="Active Executions"
                value={String(
                  observability.activeExecutionCount,
                )}
                detail={
                  hasActiveExecution
                    ? "Live execution"
                    : "No active process"
                }
              />

              <MiniMetric
                label="CPU Usage"
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
                detail="Live process only"
              />

              <MiniMetric
                label="Memory Usage"
                value={formatBytes(
                  liveMetrics?.memoryBytes ??
                    null,
                )}
                detail="Live process only"
              />
            </div>

            {observability.contextUsagePercent !==
            null ? (
              <div className="grid gap-1.5">
                <div className="flex items-center justify-between gap-3 text-[10px] text-text-muted">
                  <span>
                    Context-window
                    usage
                  </span>

                  <span>
                    {
                      observability.contextUsagePercent.toFixed(
                        1,
                      )
                    }
                    %
                  </span>
                </div>

                <Progress
                  value={
                    observability.contextUsagePercent
                  }
                  className="[&_[data-slot=progress-indicator]]:bg-status-success"
                />
              </div>
            ) : null}

            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
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
                label="Active Execution"
                value={shortIdentifier(
                  observability.activeExecution
                    ?.id ??
                    null,
                )}
              />
            </div>

            <div className="grid min-w-0 gap-3 xl:grid-cols-[1fr_1fr_minmax(18rem,0.9fr)]">
              <section className="min-w-0 rounded-md border border-divider p-3">
                <div className="mb-3 flex items-center gap-1.5 text-xs font-medium text-text-secondary">
                  <ActivityIcon className="size-3.5 text-status-running" />
                  Agent Activity
                </div>

                {activityAvailable ? (
                  <ChartContainer
                    config={
                      activityChartConfig
                    }
                    className="h-40 w-full aspect-auto"
                    initialDimension={{
                      width: 420,
                      height: 160,
                    }}
                  >
                    <BarChart
                      accessibilityLayer
                      data={
                        observability.activityBuckets
                      }
                    >
                      <Bar
                        dataKey="count"
                        fill="var(--status-running)"
                        radius={[
                          3,
                          3,
                          0,
                          0,
                        ]}
                      />
                    </BarChart>
                  </ChartContainer>
                ) : (
                  <div className="flex h-40 items-center justify-center text-xs text-text-muted">
                    No executions
                    in range
                  </div>
                )}
              </section>

              <section className="min-w-0 rounded-md border border-divider p-3">
                <div className="mb-3 text-xs font-medium text-text-secondary">
                  Token Usage
                  Trend
                </div>

                {tokenDataAvailable ? (
                  <ChartContainer
                    config={
                      tokenChartConfig
                    }
                    className="h-40 w-full aspect-auto"
                    initialDimension={{
                      width: 420,
                      height: 160,
                    }}
                  >
                    <LineChart
                      accessibilityLayer
                      data={
                        observability.tokenBuckets
                      }
                    >
                      <Line
                        type="monotone"
                        dataKey="averageTokens"
                        stroke="var(--brand-accent)"
                        strokeWidth={
                          1.8
                        }
                        dot={{
                          r: 2,
                          fill:
                            "var(--brand-accent)",
                        }}
                        activeDot={{
                          r: 3,
                        }}
                        connectNulls={
                          false
                        }
                      />
                    </LineChart>
                  </ChartContainer>
                ) : (
                  <div className="flex h-40 items-center justify-center text-xs text-text-muted">
                    Token
                    telemetry
                    unavailable
                  </div>
                )}
              </section>

              <section className="min-w-0 rounded-md border border-divider">
                <div className="flex items-center justify-between gap-3 border-b border-divider px-3 py-2.5">
                  <p className="text-xs font-medium text-text-secondary">
                    Recent Runs
                  </p>

                  <span className="text-[10px] text-text-muted">
                    {
                      observability.recentExecutions.length
                    }{" "}
                    shown
                  </span>
                </div>

                {observability.recentExecutions.length ===
                0 ? (
                  <p className="p-4 text-xs text-text-muted">
                    No executions
                    in this
                    reporting range.
                  </p>
                ) : (
                  <div className="divide-y divide-divider">
                    {observability.recentExecutions.map(
                      (
                        execution,
                      ) => (
                        <div
                          key={
                            execution.id
                          }
                          className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 px-3 py-2"
                        >
                          <Badge
                            variant={executionVariant(
                              execution.status,
                            )}
                            className="h-4 px-1.5 text-[9px]"
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

                            <p className="truncate text-[9px] text-text-muted">
                              {execution.resultStatus
                                ? formatIdentifier(
                                    execution.resultStatus,
                                  )
                                : "No structured result"}

                              {execution.commitHash
                                ? ` · ${shortIdentifier(
                                    execution.commitHash,
                                  )}`
                                : ""}
                            </p>
                          </div>

                          <div className="text-right text-[9px] text-text-muted">
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
              </section>
            </div>

            {observability.activeExecution ? (
              <div className="grid gap-2 text-xs sm:grid-cols-2">
                <div className="flex items-center gap-2 rounded-md border border-divider p-2.5">
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

                <div className="flex items-center gap-2 rounded-md border border-divider p-2.5">
                  <MemoryStickIcon className="size-3.5 text-brand-accent" />

                  <span className="text-text-muted">
                    Live process
                    telemetry active
                  </span>
                </div>
              </div>
            ) : null}

            <div className="flex flex-wrap gap-3 border-t border-divider pt-3 text-[10px] text-text-muted">
              <span className="inline-flex items-center gap-1">
                <GitCommitIcon className="size-3" />
                Commit data is
                shown only when
                persisted
              </span>

              <span className="inline-flex items-center gap-1">
                <CpuIcon className="size-3" />
                CPU and memory
                are live-only
              </span>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

type AgentRouteHealthProps = {
  agents:
    AgentWithRoutes[];
};

/**
 * Renders the mutually exclusive persisted-route health breakdown.
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
      className="min-w-0 self-start"
    >
      <CardHeader className="border-b border-divider">
        <CardTitle>
          Route Health
        </CardTitle>
      </CardHeader>

      <CardContent className="grid gap-3 sm:grid-cols-[7.5rem_1fr] sm:items-center">
        {health.total >
        0 ? (
          <ChartContainer
            config={
              routeChartConfig
            }
            className="mx-auto h-28 w-28 aspect-square"
            initialDimension={{
              width: 112,
              height: 112,
            }}
          >
            <PieChart>
              <Pie
                data={
                  data
                }
                dataKey="value"
                nameKey="label"
                innerRadius={
                  30
                }
                outerRadius={
                  47
                }
                strokeWidth={
                  0
                }
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
          <div className="flex h-28 items-center justify-center text-xs text-text-muted">
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
