"use client";

import {
  ActivityIcon,
  AlertTriangleIcon,
  BotIcon,
  PlusIcon,
  RefreshCwIcon,
  RouteIcon,
  SearchIcon,
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
  Team,
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
  describeAgentMonitoringEvent,
  filterAgents,
  formatIdentifier,
  groupAgentsByLayer,
  scopeAgentsToTeam,
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
  AgentLiveObservability,
  AgentRouteHealth,
  type AgentProcessMetrics,
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

type AgentsManagerProps = {
  team:
    Team;
};

type LiveMetricsState = {
  executionId: string;
  metrics:
    AgentProcessMetrics;
};

type ObservabilityErrorState = {
  agentId: string;
  range:
    AgentMonitoringRange;
  message: string;
};

/**
 * Converts unknown request failures into concise operator-facing text.
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
 * Renders Team-scoped Agent configuration, routing, and observability.
 */
export function AgentsManager({
  team,
}: AgentsManagerProps) {
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
   * Loads the selected Team's complete Agent overview while preventing stale response writes.
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
              team.id,
              controller.signal,
            );

          if (
            controller.signal
              .aborted
          ) {
            return;
          }

          const scopedAgents =
            scopeAgentsToTeam(
              next.agents,
              team.id,
            );

          const scopedOverview = {
            ...next,
            agents:
              scopedAgents,
          };

          setOverview(
            scopedOverview,
          );

          setError(
            null,
          );

          setSelectedAgentId(
            (current) => {
              if (
                preferredAgentId &&
                scopedAgents.some(
                  (agent) =>
                    agent.id ===
                    preferredAgentId,
                )
              ) {
                return preferredAgentId;
              }

              if (
                current &&
                scopedAgents.some(
                  (agent) =>
                    agent.id ===
                    current,
                )
              ) {
                return current;
              }

              return (
                scopedAgents[0]
                  ?.id ??
                null
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
            setLoading(
              false,
            );
          }
        }
      },
      [
        team.id,
      ],
    );

  useEffect(() => {
    let disposed =
      false;

    queueMicrotask(
      () => {
        if (!disposed) {
          void loadOverview(
            range,
          );
        }
      },
    );

    return () => {
      disposed =
        true;

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
      string =
      agentId;

    let cancelled =
      false;

    let timeout:
      ReturnType<
        typeof setTimeout
      > | null =
      null;

    let controller:
      AbortController | null =
      null;

    /**
     * Loads one selected-Agent observability snapshot and polls only while it remains active.
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
      cancelled =
        true;

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
      ?.id ??
    null;

  useEffect(() => {
    const executionId =
      activeExecutionId;

    if (!executionId) {
      return;
    }

    const stableExecutionId:
      string =
      executionId;

    let cancelled =
      false;

    /**
     * Loads live process metrics only while the selected execution remains active.
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
      cancelled =
        true;

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
        scopeAgentsToTeam(
          overview?.agents ??
            [],
          team.id,
        ),
      [
        overview?.agents,
        team.id,
      ],
    );

  const selectedAgent =
    agents.find(
      (agent) =>
        agent.id ===
        selectedAgentId,
    ) ??
    null;

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
            left -
            right,
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

  const activeGraphAgentId =
    visibleObservability
      ?.activeExecution
      ? selectedAgentId
      : null;

  /**
   * Selects one current Agent for the index, graph, inspector, and observability sections.
   */
  function selectAgent(
    agentId: string,
  ) {
    setSelectedAgentId(
      agentId,
    );
  }

  /**
   * Opens a fresh Team-owned create-Agent drawer session.
   */
  function openCreateDrawer() {
    setDrawerMode(
      "create",
    );

    setDrawerSession(
      (current) =>
        current + 1,
    );

    setDrawerOpen(
      true,
    );
  }

  /**
   * Opens a fresh edit drawer session for the currently selected persisted Agent.
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

    setDrawerOpen(
      true,
    );
  }

  /**
   * Reloads this Team's configuration after one persisted Agent or route mutation.
   */
  async function refreshAfterMutation(
    preferredAgentId:
      string | null,
  ) {
    setLoading(
      true,
    );

    await loadOverview(
      range,
      preferredAgentId ??
        undefined,
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <header className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-heading text-xl font-semibold text-text-primary">
              {team.name} Agents
            </h2>

            <Badge
              variant={
                team.enabled
                  ? "success"
                  : "disabled"
              }
            >
              {team.enabled
                ? "Team Enabled"
                : "Team Disabled"}
            </Badge>
          </div>

          <p className="mt-1 text-sm text-text-muted">
            Configure worker agents, layers, observability, and routes for this Team only.
          </p>
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-2">
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
                value !==
                  range
              ) {
                setLoading(
                  true,
                );

                setRange(
                  value as
                    AgentMonitoringRange,
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
              setLoading(
                true,
              );

              void loadOverview(
                range,
              );
            }}
            disabled={
              loading
            }
            aria-label={`Refresh ${team.name} agents`}
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
            Loading Team Agent configuration...
          </CardContent>
        </Card>
      ) : null}

      {overview ? (
        <>
          <section className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
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
              description="Enabled routes"
              icon={
                <RouteIcon className="size-4 text-brand-accent" />
              }
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

          <section className="grid min-w-0 items-start gap-3 xl:grid-cols-[minmax(18rem,0.75fr)_minmax(32rem,1.65fr)] 2xl:grid-cols-[minmax(18rem,0.72fr)_minmax(32rem,1.7fr)_minmax(22rem,1fr)] 2xl:items-stretch">
            <div className="min-w-0 2xl:h-full 2xl:[&>[data-slot=card]]:h-full">
              <AgentIndex
                agents={
                  filteredAgents
                }
                totalCount={
                  agents.length
                }
                totalLayers={
                  overview.metrics
                    .layers
                }
                selectedAgentId={
                  selectedAgentId
                }
                onSelect={
                  selectAgent
                }
              />
            </div>

            <div className="min-w-0 2xl:h-full 2xl:[&>[data-slot=card]]:h-full 2xl:[&>[data-slot=card]>[data-slot=card-content]]:flex 2xl:[&>[data-slot=card]>[data-slot=card-content]]:min-h-0 2xl:[&>[data-slot=card]>[data-slot=card-content]]:flex-1 2xl:[&_.agents-react-flow]:!h-full">
              <AgentWorkflowView
                agents={
                  agents
                }
                selectedAgentId={
                  selectedAgentId
                }
                activeAgentId={
                  activeGraphAgentId
                }
                onSelectAgent={
                  selectAgent
                }
              />
            </div>

            <div className="min-w-0 xl:col-span-2 2xl:col-span-1 2xl:h-full 2xl:[&>[data-slot=card]]:h-full">
              {selectedAgent ? (
                <AgentInspector
                  agent={
                    selectedAgent
                  }
                  agents={
                    agents
                  }
                  onEdit={
                    openEditDrawer
                  }
                />
              ) : (
                <Card
                  size="sm"
                  className="self-start"
                >
                  <CardContent className="py-12 text-center text-sm text-text-muted">
                    Select an agent to inspect its configuration.
                  </CardContent>
                </Card>
              )}
            </div>
          </section>

          {selectedAgent ? (
            <AgentLiveObservability
              agent={
                selectedAgent
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
            />
          ) : null}

          <section className="grid min-w-0 items-start gap-3 xl:grid-cols-[1fr_1.05fr_0.85fr]">
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
            key={`${team.id}:${drawerSession}:${drawerMode}:${
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
            createTeamId={
              team.id
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
  totalLayers: number;
  selectedAgentId:
    string | null;
  onSelect:
    (agentId: string) => void;
};

/**
 * Renders the compact searchable Agent index grouped by numeric workflow layer.
 */
function AgentIndex({
  agents,
  totalCount,
  totalLayers,
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
      className="min-w-0 self-start"
    >
      <CardHeader className="border-b border-divider">
        <div className="flex items-center justify-between gap-3">
          <CardTitle>
            Agent Index
          </CardTitle>

          <span className="text-[10px] text-text-muted">
            {totalCount}{" "}
            agent
            {totalCount ===
            1
              ? ""
              : "s"}{" "}
            ·{" "}
            {
              totalLayers
            }{" "}
            layer
            {totalLayers ===
            1
              ? ""
              : "s"}
          </span>
        </div>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col p-0">
        {agents.length ===
        0 ? (
          <p className="p-6 text-center text-xs text-text-muted">
            No agents match the current filters.
          </p>
        ) : (
          <div className="max-h-[30rem] overflow-y-auto">
            {groups.map(
              (group) => (
                <div
                  key={
                    group.layer
                  }
                >
                  <div className="border-b border-divider bg-surface-interactive/25 px-3 py-1.5 text-[10px] font-medium text-text-secondary">
                    Layer{" "}
                    {
                      group.layer
                    }{" "}
                    <span className="text-text-muted">
                      ·{" "}
                      {
                        group.agents
                          .length
                      }{" "}
                      agent
                      {group.agents
                        .length ===
                      1
                        ? ""
                        : "s"}
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
                          "flex w-full items-center gap-2.5 border-b border-divider px-3 py-2.5 text-left transition-colors last:border-0",
                          "hover:bg-surface-interactive/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus-ring",
                          selectedAgentId ===
                            agent.id &&
                            "bg-status-running/8 ring-1 ring-inset ring-status-running/40",
                          !agent.enabled &&
                            "opacity-70",
                        )}
                      >
                        <span
                          className={cn(
                            "flex size-8 shrink-0 items-center justify-center rounded-md",
                            selectedAgentId ===
                              agent.id
                              ? "bg-status-running/15 text-status-running"
                              : "bg-brand-accent/10 text-brand-accent",
                          )}
                          aria-hidden="true"
                        >
                          <BotIcon className="size-4" />
                        </span>

                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-medium text-text-primary">
                            {
                              agent.name
                            }
                          </span>

                          <span className="mt-0.5 block truncate text-[10px] text-text-muted">
                            {
                              agent.role
                            }{" "}
                            · #
                            {
                              agent.executionOrder
                            }
                          </span>
                        </span>

                        <Badge
                          variant={
                            agent.enabled
                              ? "success"
                              : "disabled"
                          }
                          className="h-4 px-1.5 text-[9px]"
                        >
                          {agent.enabled
                            ? "Enabled"
                            : "Disabled"}
                        </Badge>
                      </button>
                    ),
                  )}
                </div>
              ),
            )}
          </div>
        )}

        <div className="mt-auto border-t border-divider px-3 py-2 text-[10px] text-text-muted">
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
 * Renders recent persisted runtime events associated with this Team's Agent activity.
 */
function RecentAuditEvents({
  overview,
}: OverviewPanelProps) {
  return (
    <Card
      size="sm"
      className="min-w-0 self-start"
    >
      <CardHeader className="border-b border-divider">
        <CardTitle>
          Recent Audit Events
        </CardTitle>
      </CardHeader>

      <CardContent className="p-0">
        {overview.recentEvents.length ===
        0 ? (
          <p className="p-5 text-xs text-text-muted">
            No recent persisted Agent events.
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
                  className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-3 px-3 py-2"
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
 * Renders Team-scoped deterministic configuration warnings and the immutable run-snapshot notice.
 */
function ValidationNotices({
  overview,
}: OverviewPanelProps) {
  return (
    <Card
      size="sm"
      className="min-w-0 self-start"
    >
      <CardHeader className="border-b border-divider">
        <CardTitle>
          Validation & Notices
        </CardTitle>
      </CardHeader>

      <CardContent className="p-0">
        {overview.validationIssues.length ===
        0 ? (
          <div className="border-b border-divider px-3 py-3">
            <p className="text-xs font-medium text-status-success">
              No configuration issues detected
            </p>

            <p className="mt-1 text-[10px] leading-relaxed text-text-muted">
              Persisted Team configuration currently satisfies the deterministic checks available to this view.
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
                  role="alert"
                  className="flex gap-2 px-3 py-3"
                >
                  <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0 text-status-warning" />

                  <div>
                    <p className="text-xs font-medium text-status-warning">
                      Route target unavailable
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
              Active runs keep their own immutable Team Agent snapshot. Changes here affect future runs only.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
