"use client";

import {
  ActivityIcon,
  AlertTriangleIcon,
  BotIcon,
  GitCommitIcon,
  LayersIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  RouteIcon,
  SearchIcon,
  TerminalIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type {
  AgentMonitoringOverview,
  AgentMonitoringRange,
  AgentObservability,
  AgentWithRoutes,
} from "@orc/shared";

import {
  getAgentExecutionMetrics,
} from "@/lib/agent-executions";
import {
  getAgentMonitoringOverview,
  getAgentObservability,
} from "@/lib/agents";
import {
  AGENT_TIME_RANGE_OPTIONS,
  calculateApprovalRate,
  describeAgentMonitoringEvent,
  filterAgents,
  formatIdentifier,
  groupAgentsByLayer,
  type AgentStatusFilter,
} from "@/lib/agent-presentation";
import {
  formatRelativeTime,
} from "@/lib/run-observability";
import {
  cn,
} from "@/lib/utils";

import {
  AgentConfigDrawer,
} from "@/components/agent-config-drawer";
import {
  AgentInspector,
  AgentRouteHealth,
} from "@/components/agent-observability";
import {
  AgentWorkflowView,
} from "@/components/agent-workflow-view";
import {
  MetricCard,
} from "@/components/metric-card";
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
  Input,
} from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const LIVE_METRICS_INTERVAL_MS =
  3_000;

const OBSERVABILITY_INTERVAL_MS =
  5_000;

type ProcessMetrics = {
  cpuPercent:
    number | null;
  memoryBytes:
    number | null;
};

type LiveMetricsState = {
  executionId: string;
  metrics: ProcessMetrics;
};

type ObservabilityErrorState = {
  agentId: string;
  range:
    AgentMonitoringRange;
  message: string;
};

/**
 * Converts unknown request failures into a concise operator-facing message.
 */
function errorMessage(
  error: unknown,
): string {
  return error instanceof Error
    ? error.message
    : "Unable to load agent monitoring data";
}

/**
 * Determines whether a request failure was caused by intentional browser cancellation.
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
 * Renders the complete production Agents configuration and observability workspace.
 */
export function AgentsManager() {
  const [
    overview,
    setOverview,
  ] =
    useState<AgentMonitoringOverview | null>(
      null,
    );

  const [
    selectedAgentId,
    setSelectedAgentId,
  ] =
    useState<string | null>(
      null,
    );

  const [
    observability,
    setObservability,
  ] =
    useState<AgentObservability | null>(
      null,
    );

  const [
    liveMetricsState,
    setLiveMetricsState,
  ] =
    useState<LiveMetricsState | null>(
      null,
    );

  const [
    range,
    setRange,
  ] =
    useState<AgentMonitoringRange>(
      "7d",
    );

  const [
    search,
    setSearch,
  ] =
    useState("");

  const [
    layerFilter,
    setLayerFilter,
  ] =
    useState("all");

  const [
    statusFilter,
    setStatusFilter,
  ] =
    useState<AgentStatusFilter>(
      "all",
    );

  const [
    loading,
    setLoading,
  ] =
    useState(true);

  const [
    error,
    setError,
  ] =
    useState<string | null>(
      null,
    );

  const [
    observabilityErrorState,
    setObservabilityErrorState,
  ] =
    useState<ObservabilityErrorState | null>(
      null,
    );

  const [
    drawerOpen,
    setDrawerOpen,
  ] =
    useState(false);

  const [
    drawerMode,
    setDrawerMode,
  ] =
    useState<
      "create" | "edit"
    >("create");

  const [
    drawerSession,
    setDrawerSession,
  ] =
    useState(0);

  const overviewAbort =
    useRef<AbortController | null>(
      null,
    );

  /**
   * Loads the complete Agents overview while ensuring stale requests cannot overwrite newer state.
   */
  const loadOverview =
    useCallback(
      async (
        nextRange:
          AgentMonitoringRange,
        preferredAgentId?:
          string,
      ) => {
        overviewAbort.current?.abort();

        const controller =
          new AbortController();

        overviewAbort.current =
          controller;

        try {
          const next =
            await getAgentMonitoringOverview(
              nextRange,
              controller.signal,
            );

          if (
            controller.signal
              .aborted
          ) {
            return;
          }

          setOverview(
            next,
          );

          setError(null);

          setSelectedAgentId(
            (current) => {
              if (
                preferredAgentId &&
                next.agents.some(
                  (agent) =>
                    agent.id ===
                    preferredAgentId,
                )
              ) {
                return preferredAgentId;
              }

              if (
                current &&
                next.agents.some(
                  (agent) =>
                    agent.id ===
                    current,
                )
              ) {
                return current;
              }

              return (
                next.agents[0]
                  ?.id ?? null
              );
            },
          );
        } catch (caught) {
          if (
            !isAbortError(
              caught,
            )
          ) {
            setError(
              errorMessage(
                caught,
              ),
            );
          }
        } finally {
          if (
            !controller.signal
              .aborted
          ) {
            setLoading(false);
          }
        }
      },
      [],
    );

  useEffect(() => {
    let disposed =
      false;

    queueMicrotask(() => {
      if (!disposed) {
        void loadOverview(
          range,
        );
      }
    });

    return () => {
      disposed = true;

      overviewAbort.current?.abort();
    };
  }, [
    range,
    loadOverview,
  ]);

  useEffect(() => {
    const agentId =
      selectedAgentId;

    if (!agentId) {
      return;
    }

    const stableAgentId:
      string = agentId;

    let cancelled =
      false;

    let timeout:
      ReturnType<
        typeof setTimeout
      > | null = null;

    let controller:
      AbortController | null =
      null;

    /**
     * Loads one selected-agent observability snapshot and continues polling only while it is active.
     */
    async function loadSelectedObservability() {
      controller?.abort();

      controller =
        new AbortController();

      try {
        const next =
          await getAgentObservability(
            stableAgentId,
            range,
            controller.signal,
          );

        if (
          cancelled ||
          controller.signal
            .aborted
        ) {
          return;
        }

        setObservability(
          next,
        );

        setObservabilityErrorState(
          null,
        );

        if (
          next.activeExecution
        ) {
          timeout =
            setTimeout(
              () =>
                void loadSelectedObservability(),
              OBSERVABILITY_INTERVAL_MS,
            );
        }
      } catch (caught) {
        if (
          !cancelled &&
          !isAbortError(
            caught,
          )
        ) {
          setObservabilityErrorState({
            agentId:
              stableAgentId,
            range,
            message:
              errorMessage(
                caught,
              ),
          });
        }
      }
    }

    void loadSelectedObservability();

    return () => {
      cancelled = true;

      controller?.abort();

      if (timeout) {
        clearTimeout(
          timeout,
        );
      }
    };
  }, [
    selectedAgentId,
    range,
  ]);

  const visibleObservability =
    observability?.agentId ===
      selectedAgentId &&
    observability.range ===
      range
      ? observability
      : null;

  const visibleObservabilityError =
    observabilityErrorState
      ?.agentId ===
      selectedAgentId &&
    observabilityErrorState
      ?.range ===
      range
      ? observabilityErrorState
          .message
      : null;

  const observabilityLoading =
    Boolean(
      selectedAgentId,
    ) &&
    !visibleObservability &&
    !visibleObservabilityError;

  const activeExecutionId =
    visibleObservability
      ?.activeExecution
      ?.id ?? null;

  useEffect(() => {
    const executionId =
      activeExecutionId;

    if (!executionId) {
      return;
    }

    const stableExecutionId:
      string = executionId;

    let cancelled =
      false;

    /**
     * Reads the existing runtime process endpoint while the selected execution remains active.
     */
    async function loadLiveMetrics() {
      try {
        const next =
          await getAgentExecutionMetrics(
            stableExecutionId,
          );

        if (!cancelled) {
          setLiveMetricsState({
            executionId:
              stableExecutionId,
            metrics:
              next,
          });
        }
      } catch {
        if (!cancelled) {
          setLiveMetricsState({
            executionId:
              stableExecutionId,
            metrics: {
              cpuPercent:
                null,
              memoryBytes:
                null,
            },
          });
        }
      }
    }

    void loadLiveMetrics();

    const interval =
      setInterval(
        () =>
          void loadLiveMetrics(),
        LIVE_METRICS_INTERVAL_MS,
      );

    return () => {
      cancelled = true;

      clearInterval(
        interval,
      );
    };
  }, [
    activeExecutionId,
  ]);

  const liveMetrics =
    liveMetricsState
      ?.executionId ===
      activeExecutionId
      ? liveMetricsState.metrics
      : null;

  const agents =
    useMemo(
      () =>
        overview?.agents ??
        [],
      [overview?.agents],
    );

  const selectedAgent =
    agents.find(
      (agent) =>
        agent.id ===
        selectedAgentId,
    ) ?? null;

  const availableLayers =
    useMemo(
      () =>
        [
          ...new Set(
            agents.map(
              (agent) =>
                agent.layer,
            ),
          ),
        ].sort(
          (
            left,
            right,
          ) =>
            left - right,
        ),
      [agents],
    );

  const filteredAgents =
    useMemo(
      () =>
        filterAgents(
          agents,
          search,
          layerFilter ===
            "all"
            ? null
            : Number(
                layerFilter,
              ),
          statusFilter,
        ),
      [
        agents,
        search,
        layerFilter,
        statusFilter,
      ],
    );

  const approvalRate =
    overview
      ? calculateApprovalRate(
          overview.metrics
            .approvedResults,
          overview.metrics
            .changesRequestedResults,
        )
      : null;

  /**
   * Selects one current agent and keeps all surrounding overview panels synchronized.
   */
  function selectAgent(
    agentId: string,
  ) {
    setSelectedAgentId(
      agentId,
    );
  }

  /**
   * Opens a fresh create-agent drawer session without altering the current agent selection.
   */
  function openCreateDrawer() {
    setDrawerMode(
      "create",
    );

    setDrawerSession(
      (current) =>
        current + 1,
    );

    setDrawerOpen(true);
  }

  /**
   * Opens a fresh edit drawer session for the currently selected persisted agent.
   */
  function openEditDrawer() {
    if (!selectedAgent) {
      return;
    }

    setDrawerMode(
      "edit",
    );

    setDrawerSession(
      (current) =>
        current + 1,
    );

    setDrawerOpen(true);
  }

  /**
   * Refreshes current configuration after any agent or route mutation.
   */
  async function refreshAfterMutation(
    preferredAgentId:
      string | null,
  ) {
    setLoading(true);

    await loadOverview(
      range,
      preferredAgentId ??
        undefined,
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <header className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-text-primary">
            Agents
          </h1>

          <p className="mt-1 text-sm text-text-muted">
            Layered worker
            configuration,
            capabilities, and
            route
            observability.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[15rem] flex-1 xl:w-[20rem]">
            <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-text-muted" />

            <Input
              value={
                search
              }
              onChange={(
                event,
              ) =>
                setSearch(
                  event.target
                    .value,
                )
              }
              className="pl-8"
              placeholder="Search agents, roles, slugs..."
              aria-label="Search agents"
            />
          </div>

          <Select
            value={
              layerFilter
            }
            onValueChange={(
              value,
            ) =>
              setLayerFilter(
                value ??
                  "all",
              )
            }
          >
            <SelectTrigger
              className="min-w-28"
              aria-label="Filter by layer"
            >
              <SelectValue />
            </SelectTrigger>

            <SelectContent align="end">
              <SelectItem value="all">
                All Layers
              </SelectItem>

              {availableLayers.map(
                (
                  layer,
                ) => (
                  <SelectItem
                    key={
                      layer
                    }
                    value={String(
                      layer,
                    )}
                  >
                    Layer{" "}
                    {
                      layer
                    }
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>

          <Select
            value={
              statusFilter
            }
            onValueChange={(
              value,
            ) =>
              setStatusFilter(
                (
                  value ??
                  "all"
                ) as AgentStatusFilter,
              )
            }
          >
            <SelectTrigger
              className="min-w-28"
              aria-label="Filter by status"
            >
              <SelectValue />
            </SelectTrigger>

            <SelectContent align="end">
              <SelectItem value="all">
                All Status
              </SelectItem>

              <SelectItem value="enabled">
                Enabled
              </SelectItem>

              <SelectItem value="disabled">
                Disabled
              </SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={
              range
            }
            onValueChange={(
              value,
            ) => {
              if (
                value &&
                value !== range
              ) {
                setLoading(true);

                setRange(
                  value as AgentMonitoringRange,
                );
              }
            }}
          >
            <SelectTrigger
              className="min-w-32"
              aria-label="Monitoring range"
            >
              <SelectValue />
            </SelectTrigger>

            <SelectContent align="end">
              {AGENT_TIME_RANGE_OPTIONS.map(
                (
                  option,
                ) => (
                  <SelectItem
                    key={
                      option.value
                    }
                    value={
                      option.value
                    }
                  >
                    {
                      option.label
                    }
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>

          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            onClick={() => {
              setLoading(true);

              void loadOverview(
                range,
              );
            }}
            disabled={
              loading
            }
            aria-label="Refresh Agents page"
          >
            <RefreshCwIcon
              className={
                loading
                  ? "animate-spin"
                  : undefined
              }
            />
          </Button>

          <Button
            type="button"
            onClick={
              openCreateDrawer
            }
          >
            <PlusIcon />
            Create Agent
          </Button>
        </div>
      </header>

      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-status-error/30 bg-status-error/10 p-3 text-sm text-status-error"
        >
          {error}
        </p>
      ) : null}

      {loading &&
      !overview ? (
        <Card size="sm">
          <CardContent className="py-12 text-center text-sm text-text-muted">
            Loading agent
            configuration...
          </CardContent>
        </Card>
      ) : null}

      {overview ? (
        <>
          <section className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
            <MetricCard
              label="Layers"
              value={String(
                overview.metrics
                  .layers,
              )}
              description="Configured"
              icon={
                <LayersIcon className="size-4" />
              }
            />

            <MetricCard
              label="Enabled Agents"
              value={String(
                overview.metrics
                  .enabledAgents,
              )}
              description={`of ${overview.metrics.totalAgents} total`}
              icon={
                <BotIcon className="size-4 text-status-success" />
              }
            />

            <MetricCard
              label="Active Executions"
              value={String(
                overview.metrics
                  .activeExecutions,
              )}
              description={`Across ${overview.metrics.activeRuns} active run${overview.metrics.activeRuns === 1 ? "" : "s"}`}
              icon={
                <ActivityIcon className="size-4 text-status-running" />
              }
            />

            <MetricCard
              label="Route Rules"
              value={String(
                overview.metrics
                  .enabledRouteRules,
              )}
              description="Enabled"
              icon={
                <RouteIcon className="size-4 text-brand-accent" />
              }
            />

            <MetricCard
              label="Approval Rate"
              value={
                approvalRate ===
                null
                  ? "Unavailable"
                  : `${approvalRate.toFixed(
                      1,
                    )}%`
              }
              description="Approved vs changes requested"
            />

            <MetricCard
              label="Validation Issues"
              value={String(
                overview
                  .validationIssues
                  .length,
              )}
              description={
                overview
                  .validationIssues
                  .length >
                0
                  ? "Needs attention"
                  : "No issues detected"
              }
              icon={
                <AlertTriangleIcon
                  className={cn(
                    "size-4",
                    overview
                      .validationIssues
                      .length >
                      0
                      ? "text-status-warning"
                      : "text-status-success",
                  )}
                />
              }
            />
          </section>

          <section className="grid min-w-0 gap-3 2xl:grid-cols-[minmax(17rem,0.8fr)_minmax(34rem,1.55fr)_minmax(23rem,1fr)]">
            <AgentIndex
              agents={
                filteredAgents
              }
              totalCount={
                agents.length
              }
              selectedAgentId={
                selectedAgentId
              }
              onSelect={
                selectAgent
              }
            />

            <AgentWorkflowView
              agents={
                agents
              }
              selectedAgentId={
                selectedAgentId
              }
              onSelectAgent={
                selectAgent
              }
            />

            {selectedAgent ? (
              <AgentInspector
                agent={
                  selectedAgent
                }
                agents={
                  agents
                }
                observability={
                  visibleObservability
                }
                loading={
                  observabilityLoading
                }
                error={
                  visibleObservabilityError
                }
                range={
                  range
                }
                liveMetrics={
                  liveMetrics
                }
                onEdit={
                  openEditDrawer
                }
              />
            ) : (
              <Card size="sm">
                <CardContent className="py-12 text-center text-sm text-text-muted">
                  Select an
                  agent to inspect
                  its configuration
                  and execution
                  history.
                </CardContent>
              </Card>
            )}
          </section>

          <section className="grid min-w-0 gap-3 xl:grid-cols-[1fr_1.25fr_0.8fr]">
            <RecentAuditEvents
              overview={
                overview
              }
            />

            <ValidationNotices
              overview={
                overview
              }
            />

            <AgentRouteHealth
              agents={
                agents
              }
            />
          </section>

          <AgentConfigDrawer
            key={`${drawerSession}:${drawerMode}:${
              drawerMode ===
              "edit"
                ? selectedAgent?.id ??
                  "none"
                : "create"
            }`}
            open={
              drawerOpen
            }
            mode={
              drawerMode
            }
            agent={
              drawerMode ===
                "edit"
                ? selectedAgent
                : null
            }
            agents={
              agents
            }
            onOpenChange={
              setDrawerOpen
            }
            onRefresh={
              refreshAfterMutation
            }
          />
        </>
      ) : null}
    </div>
  );
}

type AgentIndexProps = {
  agents:
    AgentWithRoutes[];
  totalCount: number;
  selectedAgentId:
    string | null;
  onSelect:
    (agentId: string) => void;
};

/**
 * Renders the compact searchable agent index grouped by generic numeric layer.
 */
function AgentIndex({
  agents,
  totalCount,
  selectedAgentId,
  onSelect,
}: AgentIndexProps) {
  const groups =
    groupAgentsByLayer(
      agents,
    );

  return (
    <Card
      size="sm"
      className="min-w-0"
    >
      <CardHeader className="border-b border-divider">
        <CardTitle>
          Agent Index
        </CardTitle>
      </CardHeader>

      <CardContent className="p-0">
        {agents.length ===
        0 ? (
          <p className="p-6 text-center text-xs text-text-muted">
            No agents match
            the current
            filters.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[34rem]">
              <div className="grid grid-cols-[minmax(9rem,1fr)_5rem_6rem_5.5rem_5.5rem] gap-2 border-b border-divider px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-text-muted">
                <span>
                  Agent
                </span>
                <span>
                  Harness
                </span>
                <span>
                  Model
                </span>
                <span>
                  Status
                </span>
                <span>
                  Caps
                </span>
              </div>

              {groups.map(
                (group) => (
                  <div
                    key={
                      group.layer
                    }
                  >
                    <div className="border-b border-divider bg-surface-interactive/30 px-3 py-1.5 text-[10px] font-medium text-text-secondary">
                      Layer{" "}
                      {
                        group.layer
                      }{" "}
                      <span className="text-text-muted">
                        (
                        {
                          group.agents
                            .length
                        }
                        )
                      </span>
                    </div>

                    {group.agents.map(
                      (
                        agent,
                      ) => (
                        <button
                          key={
                            agent.id
                          }
                          type="button"
                          onClick={() =>
                            onSelect(
                              agent.id,
                            )
                          }
                          aria-pressed={
                            selectedAgentId ===
                            agent.id
                          }
                          className={cn(
                            "grid w-full grid-cols-[minmax(9rem,1fr)_5rem_6rem_5.5rem_5.5rem] items-center gap-2 border-b border-divider px-3 py-2 text-left transition-colors last:border-0 hover:bg-surface-interactive/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus-ring",
                            selectedAgentId ===
                              agent.id &&
                              "bg-status-running/8 ring-1 ring-inset ring-status-running/40",
                            !agent.enabled &&
                              "opacity-55",
                          )}
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-xs font-medium text-text-primary">
                              {
                                agent.name
                              }
                            </span>

                            <span className="block truncate font-mono text-[10px] text-text-muted">
                              {
                                agent.slug
                              }{" "}
                              ·{" "}
                              {
                                agent.executionOrder
                              }
                            </span>
                          </span>

                          <span className="truncate font-mono text-[10px] text-text-secondary">
                            {
                              agent.harness
                            }
                          </span>

                          <span className="truncate font-mono text-[10px] text-text-secondary">
                            {
                              agent.model
                            }
                          </span>

                          <Badge
                            variant={
                              agent.enabled
                                ? "success"
                                : "disabled"
                            }
                            className="px-1.5 text-[10px]"
                          >
                            {agent.enabled
                              ? "Enabled"
                              : "Disabled"}
                          </Badge>

                          <span className="flex items-center gap-1 text-text-muted">
                            {agent.canWrite ? (
                              <PencilIcon
                                className="size-3"
                                aria-label="Can write"
                              />
                            ) : null}

                            {agent.canRunCommands ? (
                              <TerminalIcon
                                className="size-3"
                                aria-label="Can run commands"
                              />
                            ) : null}

                            {agent.canCommit ? (
                              <GitCommitIcon
                                className="size-3"
                                aria-label="Can commit"
                              />
                            ) : null}

                            {!agent.canWrite &&
                            !agent.canRunCommands &&
                            !agent.canCommit ? (
                              <span className="text-[10px]">
                                Read
                              </span>
                            ) : null}
                          </span>
                        </button>
                      ),
                    )}
                  </div>
                ),
              )}
            </div>
          </div>
        )}

        <div className="border-t border-divider px-3 py-2 text-[10px] text-text-muted">
          Showing{" "}
          {agents.length} of{" "}
          {totalCount} agents
        </div>
      </CardContent>
    </Card>
  );
}

type OverviewPanelProps = {
  overview:
    AgentMonitoringOverview;
};

/**
 * Renders recent persisted runtime events that can be accurately associated with agent activity.
 */
function RecentAuditEvents({
  overview,
}: OverviewPanelProps) {
  return (
    <Card
      size="sm"
      className="h-full"
    >
      <CardHeader className="border-b border-divider">
        <CardTitle>
          Recent Audit
          Events
        </CardTitle>
      </CardHeader>

      <CardContent className="p-0">
        {overview.recentEvents.length ===
        0 ? (
          <p className="p-5 text-xs text-text-muted">
            No recent
            persisted agent
            events.
          </p>
        ) : (
          <div className="divide-y divide-divider">
            {overview.recentEvents.map(
              (
                event,
              ) => (
                <div
                  key={
                    event.id
                  }
                  className="grid grid-cols-[4.5rem_1fr] gap-3 px-3 py-2"
                >
                  <span className="text-[10px] text-text-muted">
                    {formatRelativeTime(
                      event.createdAt,
                    )}
                  </span>

                  <div className="min-w-0">
                    <p className="truncate text-xs text-text-secondary">
                      {describeAgentMonitoringEvent(
                        event,
                        overview.agents,
                      )}
                    </p>

                    <p className="mt-0.5 truncate font-mono text-[10px] text-text-muted">
                      {formatIdentifier(
                        event.type,
                      )}
                    </p>
                  </div>
                </div>
              ),
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Renders only deterministic current-configuration warnings plus the immutable snapshot notice.
 */
function ValidationNotices({
  overview,
}: OverviewPanelProps) {
  return (
    <Card
      size="sm"
      className="h-full"
    >
      <CardHeader className="border-b border-divider">
        <CardTitle>
          Validation &
          Notices
        </CardTitle>
      </CardHeader>

      <CardContent className="p-0">
        {overview.validationIssues.length ===
        0 ? (
          <div className="border-b border-divider px-3 py-3">
            <p className="text-xs font-medium text-status-success">
              No configuration
              issues detected
            </p>

            <p className="mt-1 text-[10px] leading-relaxed text-text-muted">
              Persisted
              configuration
              currently satisfies
              the deterministic
              checks available to
              this view.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-divider">
            {overview.validationIssues.map(
              (
                issue,
              ) => (
                <div
                  key={
                    issue.routeId
                  }
                  className="flex gap-2 px-3 py-3"
                >
                  <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0 text-status-warning" />

                  <div>
                    <p className="text-xs font-medium text-status-warning">
                      Route target
                      unavailable
                    </p>

                    <p className="mt-1 text-[10px] leading-relaxed text-text-muted">
                      {
                        issue.message
                      }
                    </p>
                  </div>
                </div>
              ),
            )}
          </div>
        )}

        <div className="flex gap-2 px-3 py-3">
          <BotIcon className="mt-0.5 size-3.5 shrink-0 text-status-running" />

          <div>
            <p className="text-xs font-medium text-status-running">
              Snapshot note
            </p>

            <p className="mt-1 text-[10px] leading-relaxed text-text-muted">
              Active runs keep
              their own immutable
              agent snapshot.
              Changes on this page
              affect future runs
              only.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
