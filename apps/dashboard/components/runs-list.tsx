"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
} from "recharts";
import {
  ActivityIcon,
  BanIcon,
  CheckCircle2Icon,
  CircleAlertIcon,
  CircleDotIcon,
  Clock3Icon,
  CopyIcon,
  GaugeIcon,
  ListChecksIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SearchIcon,
  SquareIcon,
  XCircleIcon,
} from "lucide-react";

import type {
  AgentExecution,
  RunMonitoringDetail,
  RunMonitoringSummary,
} from "@orc/shared";

import {
  cancelRun,
  getRunMonitoringDetail,
  getRunMonitoringRuns,
  retryRun,
} from "@/lib/workflows";
import {
  RUN_STATUS_FILTERS,
  RUN_TIME_RANGE_OPTIONS,
  aggregateRunUsage,
  buildRunsOverTime,
  calculateRunMetrics,
  deriveWorkflowSteps,
  describeDomainEvent,
  executionDurationMs,
  filterRunSummaries,
  findLatestFailure,
  formatCompactNumber,
  formatDateTime,
  formatDuration,
  formatRelativeTime,
  formatStatusLabel,
  normalizeContextUsage,
  normalizeTokenUsage,
  projectNameFromPath,
  scopeRunsByTime,
  shortIdentifier,
  type RunStatusFilter,
  type RunTimeRange,
  type WorkflowStep,
  type WorkflowStepState,
} from "@/lib/run-observability";
import { cn } from "@/lib/utils";

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
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Input,
} from "@/components/ui/input";
import {
  Progress,
} from "@/components/ui/progress";
import {
  Switch,
} from "@/components/ui/switch";
import {
  ContextUsage,
} from "@/components/context-usage";
import {
  MetricCard,
} from "@/components/metric-card";

const POLL_INTERVAL_MS = 2_000;

const chartConfig = {
  count: {
    label: "Runs",
    color:
      "var(--status-running)",
  },
} satisfies ChartConfig;

type ActionPending =
  | "cancel"
  | "retry"
  | null;

type BadgeVariant =
  | "running"
  | "success"
  | "warning"
  | "error"
  | "neutral";

type DetailErrorState = {
  runId: string;
  message: string;
};

/**
 * Converts an unknown request failure into an operator-readable message.
 */
function errorMessage(
  error: unknown,
): string {
  return error instanceof Error
    ? error.message
    : "Unable to load run monitoring data";
}

/**
 * Determines whether an exception represents an intentionally aborted browser request.
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
 * Maps persisted run status onto the shared semantic badge variants.
 */
function runStatusVariant(
  status:
    RunMonitoringSummary["status"],
): BadgeVariant {
  switch (status) {
    case "running":
      return "running";
    case "completed":
      return "success";
    case "pending":
    case "blocked":
      return "warning";
    case "failed":
      return "error";
    case "cancelled":
    default:
      return "neutral";
  }
}

/**
 * Maps persisted execution status onto the shared semantic badge variants.
 */
function executionStatusVariant(
  status:
    AgentExecution["status"],
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
    case "blocked":
      return "error";
    case "cancelled":
    default:
      return "neutral";
  }
}

/**
 * Maps pipeline state onto the shared semantic badge variants.
 */
function workflowStateVariant(
  state:
    WorkflowStepState,
): BadgeVariant {
  switch (state) {
    case "running":
      return "running";
    case "completed":
      return "success";
    case "failed":
      return "error";
    case "blocked":
      return "warning";
    case "cancelled":
      return "neutral";
    case "waiting":
    default:
      return "neutral";
  }
}

/**
 * Returns the visual semantic tone used by a run-progress bar.
 */
function progressToneClass(
  status:
    RunMonitoringSummary["status"],
): string {
  switch (status) {
    case "completed":
      return "[&_[data-slot=progress-indicator]]:bg-status-success";
    case "failed":
      return "[&_[data-slot=progress-indicator]]:bg-status-error";
    case "blocked":
      return "[&_[data-slot=progress-indicator]]:bg-status-warning";
    case "cancelled":
      return "[&_[data-slot=progress-indicator]]:bg-status-neutral";
    case "pending":
      return "[&_[data-slot=progress-indicator]]:bg-status-warning";
    case "running":
    default:
      return "[&_[data-slot=progress-indicator]]:bg-status-running";
  }
}

/**
 * Returns a compact progress percentage while safely handling retries beyond the original plan size.
 */
function executionProgress(
  executionCount: number,
  plannedExecutionCount: number,
): number {
  if (
    plannedExecutionCount <= 0
  ) {
    return 0;
  }

  return Math.min(
    100,
    (executionCount /
      plannedExecutionCount) *
      100,
  );
}

/**
 * Returns the selected run's current operator state using real run and execution state.
 */
function currentStateLabel(
  detail: RunMonitoringDetail,
): string {
  const currentExecution =
    [...detail.executions]
      .reverse()
      .find((execution) =>
        [
          "starting",
          "running",
        ].includes(
          execution.status,
        ),
      );

  if (
    currentExecution?.status ===
    "starting"
  ) {
    return "Starting";
  }

  if (
    currentExecution?.status ===
    "running"
  ) {
    return "Executing";
  }

  return formatStatusLabel(
    detail.run.status,
  );
}

/**
 * Copies operator data when clipboard access is available.
 */
async function copyText(
  value: string,
): Promise<void> {
  try {
    await navigator.clipboard.writeText(
      value,
    );
  } catch {
    // Clipboard failures are non-fatal and must not interrupt run monitoring.
  }
}

/**
 * Renders the complete live Runs monitoring dashboard.
 */
export function RunsList() {
  const [
    runs,
    setRuns,
  ] = useState<
    RunMonitoringSummary[]
  >([]);

  const [
    selectedRunId,
    setSelectedRunId,
  ] = useState<
    string | null
  >(null);

  const [
    detailState,
    setDetail,
  ] = useState<
    RunMonitoringDetail | null
  >(null);

  const [
    search,
    setSearch,
  ] = useState("");

  const [
    statusFilter,
    setStatusFilter,
  ] =
    useState<RunStatusFilter>(
      "all",
    );

  const [
    timeRange,
    setTimeRange,
  ] =
    useState<RunTimeRange>(
      "1h",
    );

  const [
    autoRefresh,
    setAutoRefresh,
  ] = useState(true);

  const [
    initialLoading,
    setInitialLoading,
  ] = useState(true);

  const [
    refreshing,
    setRefreshing,
  ] = useState(false);

  const [
    runsError,
    setRunsError,
  ] = useState<
    string | null
  >(null);

  const [
    detailErrorState,
    setDetailErrorState,
  ] = useState<
    DetailErrorState | null
  >(null);

  const [
    actionError,
    setActionError,
  ] = useState<
    string | null
  >(null);

  const [
    actionPending,
    setActionPending,
  ] =
    useState<ActionPending>(
      null,
    );

  const [
    lastSyncedAt,
    setLastSyncedAt,
  ] = useState<
    number | null
  >(null);

  const runsAbortRef =
    useRef<
      AbortController | null
    >(null);

  const detailAbortRef =
    useRef<
      AbortController | null
    >(null);

  /**
   * Loads the run navigator while aborting any older in-flight list request.
   */
  const loadRuns =
    useCallback(
      async (
        initial = false,
      ) => {
        runsAbortRef.current?.abort();

        const controller =
          new AbortController();

        runsAbortRef.current =
          controller;

        try {
          const value =
            await getRunMonitoringRuns(
              controller.signal,
            );

          if (
            controller.signal
              .aborted
          ) {
            return;
          }

          setRuns(value);
          setRunsError(null);
          setLastSyncedAt(
            Date.now(),
          );

          setSelectedRunId(
            (current) => {
              if (
                current &&
                value.some(
                  (run) =>
                    run.id ===
                    current,
                )
              ) {
                return current;
              }

              return (
                value[0]?.id ??
                null
              );
            },
          );
        } catch (error) {
          if (
            !isAbortError(
              error,
            )
          ) {
            setRunsError(
              errorMessage(
                error,
              ),
            );
          }
        } finally {
          if (
            initial &&
            runsAbortRef.current ===
              controller
          ) {
            setInitialLoading(
              false,
            );
          }
        }
      },
      [],
    );

  /**
   * Loads one selected run while aborting any older detail request.
   */
  const loadDetail =
    useCallback(
      async (
        runId: string,
      ) => {
        detailAbortRef.current?.abort();

        const controller =
          new AbortController();

        detailAbortRef.current =
          controller;

        try {
          const value =
            await getRunMonitoringDetail(
              runId,
              controller.signal,
            );

          if (
            controller.signal
              .aborted
          ) {
            return;
          }

          setDetail(value);
          setDetailErrorState(
            null,
          );
        } catch (error) {
          if (
            !isAbortError(
              error,
            )
          ) {
            setDetailErrorState({
              runId,
              message:
                errorMessage(
                  error,
                ),
            });
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
        void loadRuns(true);
      }
    });

    return () => {
      disposed = true;

      runsAbortRef.current?.abort();
      detailAbortRef.current?.abort();
    };
  }, [loadRuns]);

  useEffect(() => {
    const runId =
      selectedRunId;

    if (!runId) {
      detailAbortRef.current?.abort();
      return;
    }

    let disposed =
      false;

    queueMicrotask(() => {
      if (!disposed) {
        void loadDetail(
          runId,
        );
      }
    });

    return () => {
      disposed = true;

      detailAbortRef.current?.abort();
    };
  }, [
    loadDetail,
    selectedRunId,
  ]);

  useEffect(() => {
    if (!autoRefresh) {
      return;
    }

    /**
     * Refreshes visible monitoring state while avoiding unnecessary background-tab traffic.
     */
    const tick = () => {
      if (
        document.visibilityState !==
        "visible"
      ) {
        return;
      }

      void loadRuns(false);

      if (selectedRunId) {
        void loadDetail(
          selectedRunId,
        );
      }
    };

    const timer =
      window.setInterval(
        tick,
        POLL_INTERVAL_MS,
      );

    /**
     * Refreshes immediately when the browser tab becomes visible again.
     */
    const handleVisibility =
      () => {
        if (
          document.visibilityState ===
          "visible"
        ) {
          tick();
        }
      };

    document.addEventListener(
      "visibilitychange",
      handleVisibility,
    );

    return () => {
      window.clearInterval(
        timer,
      );

      document.removeEventListener(
        "visibilitychange",
        handleVisibility,
      );
    };
  }, [
    autoRefresh,
    loadDetail,
    loadRuns,
    selectedRunId,
  ]);

  const detail =
    detailState?.run.id ===
      selectedRunId
      ? detailState
      : null;

  const detailError =
    detailErrorState?.runId ===
      selectedRunId
      ? detailErrorState.message
      : null;

  const detailLoading =
    Boolean(
      selectedRunId,
    ) &&
    !detail &&
    !detailError;

  const scopedRuns =
    useMemo(
      () =>
        scopeRunsByTime(
          runs,
          timeRange,
        ),
      [
        runs,
        timeRange,
      ],
    );

  const visibleRuns =
    useMemo(
      () =>
        filterRunSummaries(
          scopedRuns,
          search,
          statusFilter,
        ),
      [
        scopedRuns,
        search,
        statusFilter,
      ],
    );

  const metrics =
    useMemo(
      () =>
        calculateRunMetrics(
          scopedRuns,
        ),
      [scopedRuns],
    );

  const chartData =
    useMemo(
      () =>
        buildRunsOverTime(
          runs,
          timeRange,
        ),
      [
        runs,
        timeRange,
      ],
    );

  const selectedUsage =
    useMemo(
      () =>
        detail
          ? aggregateRunUsage(
              detail.executions,
            )
          : null,
      [detail],
    );

  /**
   * Refreshes both the run navigator and current selected run on explicit operator request.
   */
  const refreshSelected =
    useCallback(
      async () => {
        setRefreshing(true);

        try {
          await Promise.all([
            loadRuns(false),
            selectedRunId
              ? loadDetail(
                  selectedRunId,
                )
              : Promise.resolve(),
          ]);
        } finally {
          setRefreshing(false);
        }
      },
      [
        loadDetail,
        loadRuns,
        selectedRunId,
      ],
    );

  /**
   * Cancels the current active workflow only after destructive confirmation.
   */
  const handleCancel =
    useCallback(
      async () => {
        if (
          !selectedRunId ||
          !window.confirm(
            "Cancel this active workflow?",
          )
        ) {
          return;
        }

        setActionPending(
          "cancel",
        );
        setActionError(null);

        try {
          await cancelRun(
            selectedRunId,
          );

          await Promise.all([
            loadRuns(false),
            loadDetail(
              selectedRunId,
            ),
          ]);
        } catch (error) {
          setActionError(
            errorMessage(
              error,
            ),
          );
        } finally {
          setActionPending(
            null,
          );
        }
      },
      [
        loadDetail,
        loadRuns,
        selectedRunId,
      ],
    );

  /**
   * Retries the final execution using the backend's existing persisted settings and validation rules.
   */
  const handleRetry =
    useCallback(
      async () => {
        if (!selectedRunId) {
          return;
        }

        setActionPending(
          "retry",
        );
        setActionError(null);

        try {
          await retryRun(
            selectedRunId,
          );

          await Promise.all([
            loadRuns(false),
            loadDetail(
              selectedRunId,
            ),
          ]);
        } catch (error) {
          setActionError(
            errorMessage(
              error,
            ),
          );
        } finally {
          setActionPending(
            null,
          );
        }
      },
      [
        loadDetail,
        loadRuns,
        selectedRunId,
      ],
    );

  if (
    initialLoading &&
    !runs.length
  ) {
    return (
      <Card>
        <CardContent className="flex min-h-48 items-center justify-center gap-2 text-sm text-text-muted">
          <LoaderCircleIcon className="size-4 animate-spin motion-reduce:animate-none" />
          Loading runs...
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <RunsHeader
        search={search}
        onSearchChange={
          setSearch
        }
        timeRange={
          timeRange
        }
        onTimeRangeChange={
          setTimeRange
        }
        autoRefresh={
          autoRefresh
        }
        onAutoRefreshChange={
          setAutoRefresh
        }
        refreshing={
          refreshing
        }
        lastSyncedAt={
          lastSyncedAt
        }
        onRefresh={() =>
          void refreshSelected()
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <MetricCard
          label="Running Now"
          value={String(
            metrics.running,
          )}
          icon={
            <ActivityIcon className="size-4 text-status-running" />
          }
        />

        <MetricCard
          label="Queue / Pending"
          value={String(
            metrics.pending,
          )}
          icon={
            <ListChecksIcon className="size-4 text-status-warning" />
          }
        />

        <MetricCard
          label="Success Rate"
          value={
            metrics.successRate ===
            null
              ? "Unavailable"
              : `${metrics.successRate.toFixed(
                  1,
                )}%`
          }
          icon={
            <CheckCircle2Icon className="size-4 text-status-success" />
          }
        />

        <MetricCard
          label="Failed / Blocked"
          value={String(
            metrics.failedBlocked,
          )}
          icon={
            <CircleAlertIcon className="size-4 text-status-error" />
          }
        />

        <MetricCard
          label="Median Duration"
          value={formatDuration(
            metrics.medianDurationMs,
          )}
          icon={
            <Clock3Icon className="size-4 text-status-running" />
          }
        />

        <MetricCard
          label="Context Pressure"
          description="Selected run"
          value={
            selectedUsage
              ?.context
              ? `${selectedUsage.context.percent.toFixed(
                  0,
                )}%`
              : "Unavailable"
          }
          icon={
            <GaugeIcon className="size-4 text-status-warning" />
          }
        />
      </div>

      {runsError ? (
        <Card className="border-status-error/40">
          <CardContent className="flex items-center justify-between gap-3 py-3 text-sm">
            <span className="text-status-error">
              {runsError}
            </span>

            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                void loadRuns(
                  false,
                )
              }
            >
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(300px,0.95fr)_minmax(560px,1.7fr)_minmax(300px,0.9fr)]">
        <div className="flex min-w-0 flex-col gap-3">
          <RunNavigator
            runs={
              visibleRuns
            }
            selectedRunId={
              selectedRunId
            }
            search={search}
            onSearchChange={
              setSearch
            }
            statusFilter={
              statusFilter
            }
            onStatusFilterChange={
              setStatusFilter
            }
            onSelect={
              setSelectedRunId
            }
          />

          <RunsOverTime
            data={chartData}
            timeRange={
              timeRange
            }
          />
        </div>

        <SelectedRunWorkspace
          detail={detail}
          loading={
            detailLoading
          }
          error={
            detailError
          }
          actionError={
            actionError
          }
          actionPending={
            actionPending
          }
          onRefresh={() =>
            void refreshSelected()
          }
          onCancel={() =>
            void handleCancel()
          }
          onRetry={() =>
            void handleRetry()
          }
        />

        <ObservabilityRail
          detail={detail}
          loading={
            detailLoading
          }
        />
      </div>
    </div>
  );
}

interface RunsHeaderProps {
  search: string;
  onSearchChange: (
    value: string,
  ) => void;
  timeRange: RunTimeRange;
  onTimeRangeChange: (
    value: RunTimeRange,
  ) => void;
  autoRefresh: boolean;
  onAutoRefreshChange: (
    value: boolean,
  ) => void;
  refreshing: boolean;
  lastSyncedAt:
    | number
    | null;
  onRefresh: () => void;
}

/**
 * Renders the page title, global search, range selection, refresh status, and polling control.
 */
function RunsHeader({
  search,
  onSearchChange,
  timeRange,
  onTimeRangeChange,
  autoRefresh,
  onAutoRefreshChange,
  refreshing,
  lastSyncedAt,
  onRefresh,
}: RunsHeaderProps) {
  return (
    <header className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-text-primary">
          Runs
        </h1>

        <p className="mt-1 text-sm text-text-muted">
          Monitor live workflows and inspect historical runs.
        </p>
      </div>

      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center xl:justify-end">
        <div className="relative min-w-0 sm:w-72">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-text-muted" />

          <Input
            value={search}
            onChange={(event) =>
              onSearchChange(
                event.target
                  .value,
              )
            }
            placeholder="Search runs..."
            aria-label="Search runs"
            className="pl-8"
          />
        </div>

        <select
          value={timeRange}
          onChange={(event) =>
            onTimeRangeChange(
              event.target
                .value as RunTimeRange,
            )
          }
          aria-label="Run history time range"
          className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm text-text-secondary outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {RUN_TIME_RANGE_OPTIONS.map(
            (option) => (
              <option
                key={
                  option.value
                }
                value={
                  option.value
                }
              >
                {option.label}
              </option>
            ),
          )}
        </select>

        <Button
          variant="outline"
          size="sm"
          onClick={
            onRefresh
          }
          aria-label="Refresh runs"
        >
          <RefreshCwIcon
            className={cn(
              "size-3.5",
              refreshing &&
                "animate-spin motion-reduce:animate-none",
            )}
          />
          Refresh
        </Button>

        <label className="flex h-8 items-center gap-2 rounded-lg border border-border-default px-2.5 text-xs text-text-secondary">
          <span>
            {autoRefresh
              ? "Live 2s"
              : "Paused"}
          </span>

          <Switch
            size="sm"
            checked={
              autoRefresh
            }
            onCheckedChange={
              onAutoRefreshChange
            }
            aria-label="Auto refresh"
          />
        </label>

        {lastSyncedAt ? (
          <span className="hidden text-[11px] text-text-muted 2xl:inline">
            Synced{" "}
            {formatRelativeTime(
              new Date(
                lastSyncedAt,
              ).toISOString(),
            )}
          </span>
        ) : null}
      </div>
    </header>
  );
}

interface RunNavigatorProps {
  runs: RunMonitoringSummary[];
  selectedRunId:
    | string
    | null;
  search: string;
  onSearchChange: (
    value: string,
  ) => void;
  statusFilter: RunStatusFilter;
  onStatusFilterChange: (
    value: RunStatusFilter,
  ) => void;
  onSelect: (
    runId: string,
  ) => void;
}

/**
 * Renders status filters, search, and selectable run history.
 */
function RunNavigator({
  runs,
  selectedRunId,
  search,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  onSelect,
}: RunNavigatorProps) {
  return (
    <Card className="min-w-0 gap-0 overflow-hidden">
      <CardHeader className="gap-3 border-b border-divider">
        <div className="flex flex-wrap gap-1">
          {RUN_STATUS_FILTERS.map(
            (status) => {
              const selected =
                status ===
                statusFilter;

              return (
                <Button
                  key={status}
                  variant="ghost"
                  size="xs"
                  className={cn(
                    selected &&
                      "bg-link/10 text-link hover:bg-link/15 hover:text-link",
                  )}
                  onClick={() =>
                    onStatusFilterChange(
                      status,
                    )
                  }
                >
                  {formatStatusLabel(
                    status,
                  )}
                </Button>
              );
            },
          )}
        </div>

        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-text-muted" />

          <Input
            value={search}
            onChange={(event) =>
              onSearchChange(
                event.target
                  .value,
              )
            }
            placeholder="Filter by task, project, run ID..."
            aria-label="Filter run navigator"
            className="pl-8"
          />
        </div>
      </CardHeader>

      <CardContent className="max-h-[580px] overflow-y-auto p-0">
        {runs.length ? (
          runs.map((run) => (
            <RunNavigatorRow
              key={run.id}
              run={run}
              selected={
                selectedRunId ===
                run.id
              }
              onSelect={
                onSelect
              }
            />
          ))
        ) : (
          <div className="flex min-h-40 flex-col items-center justify-center gap-2 px-4 text-center">
            <CircleDotIcon className="size-5 text-text-muted" />

            <p className="text-sm font-medium text-text-secondary">
              No matching runs
            </p>

            <p className="text-xs text-text-muted">
              Adjust the filters or wait for a workflow to start.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface RunNavigatorRowProps {
  run: RunMonitoringSummary;
  selected: boolean;
  onSelect: (
    runId: string,
  ) => void;
}

/**
 * Renders one compact selectable run summary.
 */
function RunNavigatorRow({
  run,
  selected,
  onSelect,
}: RunNavigatorRowProps) {
  const planned =
    run.plannedExecutionCount;

  const progress =
    executionProgress(
      run.executionCount,
      planned,
    );

  return (
    <button
      type="button"
      aria-pressed={
        selected
      }
      onClick={() =>
        onSelect(run.id)
      }
      className={cn(
        "block w-full border-b border-divider px-3 py-3 text-left transition-colors last:border-b-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus-ring hover:bg-surface-interactive",
        selected &&
          "bg-link/5 ring-1 ring-inset ring-link",
      )}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <span
          className={cn(
            "mt-2 size-2 shrink-0 rounded-full",
            run.status ===
              "running" &&
              "bg-status-running",
            run.status ===
              "completed" &&
              "bg-status-success",
            run.status ===
              "pending" &&
              "bg-status-warning",
            run.status ===
              "blocked" &&
              "bg-status-warning",
            run.status ===
              "failed" &&
              "bg-status-error",
            run.status ===
              "cancelled" &&
              "bg-status-neutral",
          )}
          aria-hidden="true"
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <Badge
                  variant={runStatusVariant(
                    run.status,
                  )}
                >
                  {formatStatusLabel(
                    run.status,
                  )}
                </Badge>

                <p className="truncate text-sm font-medium text-text-primary">
                  {run.taskTitle ??
                    "Workflow run"}
                </p>
              </div>

              <p className="mt-1 truncate text-xs text-text-muted">
                {projectNameFromPath(
                  run.projectPath,
                )}
                {"  /  "}
                {run.taskId
                  ? `Task ${shortIdentifier(
                      run.taskId,
                    )}`
                  : "No task"}
              </p>
            </div>

            <span className="shrink-0 text-[11px] text-text-muted">
              {formatRelativeTime(
                run.updatedAt,
              )}
            </span>
          </div>

          <div className="mt-2 flex min-w-0 items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-mono text-[10px] text-text-muted">
                {run.id}
              </p>

              {run.currentAgent ? (
                <p className="mt-1 truncate text-[11px] text-text-secondary">
                  {run.currentAgent.name}
                </p>
              ) : null}
            </div>

            <div className="w-20 shrink-0 text-right">
              <p className="mb-1 text-xs font-medium tabular-nums text-text-primary">
                {planned > 0
                  ? `${run.executionCount} / ${planned}`
                  : `${run.executionCount} attempts`}
              </p>

              <Progress
                value={
                  progress
                }
                className={cn(
                  progressToneClass(
                    run.status,
                  ),
                )}
              />
            </div>
          </div>
        </div>
      </div>
    </button>
  );
}

interface RunsOverTimeProps {
  data: ReturnType<
    typeof buildRunsOverTime
  >;
  timeRange: RunTimeRange;
}

/**
 * Renders persisted run-start throughput for the selected time range.
 */
function RunsOverTime({
  data,
  timeRange,
}: RunsOverTimeProps) {
  const label =
    RUN_TIME_RANGE_OPTIONS.find(
      (option) =>
        option.value ===
        timeRange,
    )?.label ??
    "Selected range";

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>
          Runs over time
        </CardTitle>

        <span className="text-[11px] text-text-muted">
          {label}
        </span>
      </CardHeader>

      <CardContent>
        <ChartContainer
          config={
            chartConfig
          }
          className="h-32 w-full aspect-auto"
          initialDimension={{
            width: 360,
            height: 128,
          }}
        >
          <BarChart
            accessibilityLayer
            data={data}
            margin={{
              left: 0,
              right: 0,
              top: 4,
              bottom: 0,
            }}
          >
            <CartesianGrid
              vertical={
                false
              }
            />

            <XAxis
              dataKey="label"
              axisLine={
                false
              }
              tickLine={
                false
              }
              minTickGap={
                24
              }
            />

            <ChartTooltip
              cursor={
                false
              }
              content={
                <ChartTooltipContent />
              }
            />

            <Bar
              dataKey="count"
              fill="var(--color-count)"
              radius={[
                2,
                2,
                0,
                0,
              ]}
            />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

interface SelectedRunWorkspaceProps {
  detail:
    | RunMonitoringDetail
    | null;
  loading: boolean;
  error:
    | string
    | null;
  actionError:
    | string
    | null;
  actionPending: ActionPending;
  onRefresh: () => void;
  onCancel: () => void;
  onRetry: () => void;
}

/**
 * Renders the selected-run summary, immutable workflow pipeline, and real execution attempts.
 */
function SelectedRunWorkspace({
  detail,
  loading,
  error,
  actionError,
  actionPending,
  onRefresh,
  onCancel,
  onRetry,
}: SelectedRunWorkspaceProps) {
  if (
    loading &&
    !detail
  ) {
    return (
      <Card className="min-h-80">
        <CardContent className="flex min-h-80 items-center justify-center gap-2 text-sm text-text-muted">
          <LoaderCircleIcon className="size-4 animate-spin motion-reduce:animate-none" />
          Loading selected run...
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border-status-error/40">
        <CardContent className="flex min-h-64 flex-col items-center justify-center gap-3 text-center">
          <CircleAlertIcon className="size-5 text-status-error" />

          <p className="text-sm text-status-error">
            {error}
          </p>

          <Button
            variant="outline"
            size="sm"
            onClick={
              onRefresh
            }
          >
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!detail) {
    return (
      <Card className="min-h-80">
        <CardContent className="flex min-h-80 flex-col items-center justify-center gap-2 text-center">
          <CircleDotIcon className="size-5 text-text-muted" />

          <p className="text-sm font-medium text-text-secondary">
            Select a run
          </p>

          <p className="text-xs text-text-muted">
            Choose a run from the navigator to inspect its execution state.
          </p>
        </CardContent>
      </Card>
    );
  }

  const planned =
    detail.executionPlan.length;

  const currentAgent =
    detail.executionPlan.find(
      (agent) =>
        agent.id ===
        detail.run
          .currentAgentId,
    ) ?? null;

  const active =
    detail.run.status ===
      "running" ||
    detail.run.status ===
      "pending";

  const retryable =
    detail.run.status ===
      "failed" ||
    detail.run.status ===
      "blocked";

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Card>
        <CardHeader className="gap-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-base">
                  {detail.task
                    ?.title ??
                    "Workflow run"}
                </CardTitle>

                <Badge
                  variant={runStatusVariant(
                    detail.run
                      .status,
                  )}
                >
                  {formatStatusLabel(
                    detail.run
                      .status,
                  )}
                </Badge>
              </div>

              <p className="mt-1 truncate text-xs text-text-muted">
                {projectNameFromPath(
                  detail.run
                    .projectPath,
                )}
                {detail.task
                  ? `  /  Task ${shortIdentifier(
                      detail.task
                        .id,
                    )}`
                  : ""}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={
                  onRefresh
                }
              >
                <RefreshCwIcon className="size-3.5" />
                Refresh
              </Button>

              {active ? (
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={
                    actionPending !==
                    null
                  }
                  onClick={
                    onCancel
                  }
                >
                  <SquareIcon className="size-3.5" />
                  {actionPending ===
                  "cancel"
                    ? "Cancelling..."
                    : "Cancel Run"}
                </Button>
              ) : null}

              {retryable ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={
                    actionPending !==
                    null
                  }
                  onClick={
                    onRetry
                  }
                >
                  <RotateCcwIcon className="size-3.5" />
                  {actionPending ===
                  "retry"
                    ? "Retrying..."
                    : "Retry"}
                </Button>
              ) : null}

              <Button
                variant="outline"
                size="sm"
                render={
                  <Link
                    href={`/runs/${detail.run.id}`}
                  />
                }
              >
                Open details
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          <div className="grid gap-4 border-t border-divider pt-4 sm:grid-cols-2 xl:grid-cols-5">
            <RunSummaryField
              label="Current Agent"
              value={
                currentAgent
                  ?.name ??
                "Unavailable"
              }
            />

            <RunSummaryField
              label="Executions"
              value={
                planned > 0
                  ? `${detail.run.executionCount} of ${planned}`
                  : `${detail.run.executionCount} attempts`
              }
            />

            <RunSummaryField
              label="Current State"
              value={currentStateLabel(
                detail,
              )}
            />

            <RunSummaryField
              label="Created"
              value={formatDateTime(
                detail.run
                  .createdAt,
              )}
            />

            <RunSummaryField
              label="Last Update"
              value={formatDateTime(
                detail.run
                  .updatedAt,
              )}
            />
          </div>

          {actionError ? (
            <p className="mt-4 text-xs text-status-error">
              {actionError}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <WorkflowPipeline
        detail={detail}
      />

      <ExecutionsTable
        executions={
          detail.executions
        }
      />
    </div>
  );
}

interface RunSummaryFieldProps {
  label: string;
  value: string;
}

/**
 * Renders one compact key-value field in the selected run summary.
 */
function RunSummaryField({
  label,
  value,
}: RunSummaryFieldProps) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-medium uppercase tracking-wide text-text-muted">
        {label}
      </p>

      <p className="mt-1 truncate text-xs font-medium text-text-primary">
        {value}
      </p>
    </div>
  );
}

interface WorkflowPipelineProps {
  detail: RunMonitoringDetail;
}

/**
 * Renders future workflow agents from the immutable snapshot and states from persisted executions.
 */
function WorkflowPipeline({
  detail,
}: WorkflowPipelineProps) {
  const steps =
    deriveWorkflowSteps(
      detail,
    );

  return (
    <Card className="min-w-0">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>
            Workflow / Execution Pipeline
          </CardTitle>

          <span className="text-[11px] text-text-muted">
            {steps.length
              ? `${steps.length} configured agents`
              : "Snapshot unavailable"}
          </span>
        </div>
      </CardHeader>

      <CardContent>
        {steps.length ? (
          <div className="overflow-x-auto pb-1">
            <div className="flex min-w-max items-start">
              {steps.map(
                (
                  step,
                  index,
                ) => (
                  <div
                    key={
                      step.id
                    }
                    className="flex items-start"
                  >
                    <WorkflowPipelineStep
                      step={
                        step
                      }
                      index={
                        index
                      }
                    />

                    {index <
                    steps.length -
                      1 ? (
                      <div className="mt-3 h-px w-8 shrink-0 bg-divider" />
                    ) : null}
                  </div>
                ),
              )}
            </div>
          </div>
        ) : (
          <p className="text-sm text-text-muted">
            This run does not expose a valid workflow snapshot.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

interface WorkflowPipelineStepProps {
  step: WorkflowStep;
  index: number;
}

/**
 * Renders one generic workflow pipeline node.
 */
function WorkflowPipelineStep({
  step,
  index,
}: WorkflowPipelineStepProps) {
  return (
    <div className="w-28 shrink-0 text-center">
      <div
        className={cn(
          "mx-auto flex size-6 items-center justify-center rounded-full border text-[10px] font-semibold",
          step.state ===
            "completed" &&
            "border-status-success bg-status-success/10 text-status-success",
          step.state ===
            "running" &&
            "border-status-running bg-status-running/10 text-status-running",
          step.state ===
            "failed" &&
            "border-status-error bg-status-error/10 text-status-error",
          step.state ===
            "blocked" &&
            "border-status-warning bg-status-warning/10 text-status-warning",
          [
            "waiting",
            "cancelled",
          ].includes(
            step.state,
          ) &&
            "border-border-strong bg-surface-interactive text-text-muted",
        )}
      >
        {index + 1}
      </div>

      <p className="mt-2 max-w-28 truncate text-[11px] font-medium text-text-primary">
        {step.name}
      </p>

      <p className="mt-0.5 text-[10px] text-text-muted">
        Layer {step.layer}
      </p>

      <div className="mt-1 flex justify-center">
        <Badge
          variant={workflowStateVariant(
            step.state,
          )}
          className="max-w-24"
        >
          {step.state ===
          "waiting"
            ? "Waiting"
            : formatStatusLabel(
                step.outcome,
              )}
        </Badge>
      </div>

      {step.attemptCount >
      1 ? (
        <p className="mt-1 text-[10px] text-text-muted">
          {step.attemptCount} attempts
        </p>
      ) : step.durationMs !==
        null ? (
        <p className="mt-1 text-[10px] text-text-muted">
          {formatDuration(
            step.durationMs,
          )}
        </p>
      ) : null}
    </div>
  );
}

interface ExecutionsTableProps {
  executions: AgentExecution[];
}

/**
 * Renders persisted worker attempts with supported runtime and result telemetry.
 */
function ExecutionsTable({
  executions,
}: ExecutionsTableProps) {
  return (
    <Card className="min-w-0">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>
          Executions
        </CardTitle>

        <span className="text-[11px] text-text-muted">
          {executions.length} attempts
        </span>
      </CardHeader>

      <CardContent className="min-w-0 p-0">
        {executions.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1180px] border-collapse text-left text-[11px]">
              <thead>
                <tr className="border-y border-divider bg-surface-interactive/40 text-text-muted">
                  <th className="px-3 py-2 font-medium">Agent</th>
                  <th className="px-3 py-2 font-medium">Layer / Order</th>
                  <th className="px-3 py-2 font-medium">Harness</th>
                  <th className="px-3 py-2 font-medium">Model</th>
                  <th className="px-3 py-2 font-medium">Reasoning</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Result</th>
                  <th className="px-3 py-2 font-medium">PID</th>
                  <th className="px-3 py-2 font-medium">Started</th>
                  <th className="px-3 py-2 font-medium">Completed</th>
                  <th className="px-3 py-2 font-medium">Exit</th>
                  <th className="px-3 py-2 font-medium">Tokens</th>
                  <th className="px-3 py-2 font-medium">Context</th>
                  <th className="px-3 py-2 font-medium">Commit</th>
                  <th className="px-3 py-2 font-medium">Repair</th>
                </tr>
              </thead>

              <tbody>
                {executions.map(
                  (
                    execution,
                  ) => (
                    <ExecutionTableRow
                      key={
                        execution.id
                      }
                      execution={
                        execution
                      }
                    />
                  ),
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-4 py-8 text-center text-sm text-text-muted">
            Preparing the first worker.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface ExecutionTableRowProps {
  execution: AgentExecution;
}

/**
 * Renders one persisted agent execution and only telemetry that can be normalized reliably.
 */
function ExecutionTableRow({
  execution,
}: ExecutionTableRowProps) {
  const tokens =
    normalizeTokenUsage(
      execution.tokenUsage,
    );

  const context =
    normalizeContextUsage(
      execution.contextUsage,
    );

  const elapsed =
    executionDurationMs(
      execution,
    );

  return (
    <tr className="border-b border-divider last:border-b-0 hover:bg-surface-interactive/40">
      <td className="px-3 py-2.5 align-top">
        <Link
          href={`/agent-executions/${execution.id}`}
          className="font-medium text-link hover:underline"
        >
          {execution.agentName}
        </Link>

        <p className="mt-0.5 text-[10px] text-text-muted">
          {execution.agentRole}
        </p>
      </td>

      <td className="px-3 py-2.5 align-top tabular-nums text-text-secondary">
        {execution.layer} /{" "}
        {execution.executionOrder}
      </td>

      <td className="px-3 py-2.5 align-top capitalize text-text-secondary">
        {execution.harness}
      </td>

      <td className="max-w-32 truncate px-3 py-2.5 align-top font-mono text-text-secondary">
        {execution.model}
      </td>

      <td className="px-3 py-2.5 align-top capitalize text-text-secondary">
        {execution.reasoning}
      </td>

      <td className="px-3 py-2.5 align-top">
        <Badge
          variant={executionStatusVariant(
            execution.status,
          )}
        >
          {formatStatusLabel(
            execution.status,
          )}
        </Badge>
      </td>

      <td className="max-w-48 px-3 py-2.5 align-top">
        <span className="text-text-secondary">
          {execution.resultStatus
            ? formatStatusLabel(
                execution.resultStatus,
              )
            : "Pending"}
        </span>

        {execution.failureReason ? (
          <p className="mt-1 line-clamp-2 text-[10px] text-status-error">
            {execution.failureReason}
          </p>
        ) : null}
      </td>

      <td className="px-3 py-2.5 align-top font-mono tabular-nums text-text-secondary">
        {execution.pid ??
          "Unavailable"}
      </td>

      <td className="px-3 py-2.5 align-top whitespace-nowrap text-text-secondary">
        {formatDateTime(
          execution.startedAt,
        )}
      </td>

      <td className="px-3 py-2.5 align-top whitespace-nowrap text-text-secondary">
        {execution.completedAt
          ? formatDateTime(
              execution.completedAt,
            )
          : formatDuration(
              elapsed,
            )}
      </td>

      <td className="px-3 py-2.5 align-top font-mono tabular-nums text-text-secondary">
        {execution.exitCode ??
          "Unavailable"}
      </td>

      <td className="px-3 py-2.5 align-top tabular-nums text-text-secondary">
        {tokens?.totalTokens !==
        null &&
        tokens?.totalTokens !==
        undefined
          ? formatCompactNumber(
              tokens.totalTokens,
            )
          : "Unavailable"}
      </td>

      <td className="px-3 py-2.5 align-top tabular-nums text-text-secondary">
        {context
          ? `${context.percent.toFixed(
              0,
            )}%`
          : "Unavailable"}
      </td>

      <td className="px-3 py-2.5 align-top font-mono text-link">
        {execution.commitHash
          ? shortIdentifier(
              execution.commitHash,
            )
          : "Unavailable"}
      </td>

      <td className="px-3 py-2.5 align-top text-text-secondary">
        {execution.repairAttempted
          ? "Yes"
          : "No"}
      </td>
    </tr>
  );
}

interface ObservabilityRailProps {
  detail:
    | RunMonitoringDetail
    | null;
  loading: boolean;
}

/**
 * Renders selected-run facts, usage, events, and terminal-reason observability.
 */
function ObservabilityRail({
  detail,
  loading,
}: ObservabilityRailProps) {
  if (
    loading &&
    !detail
  ) {
    return (
      <Card>
        <CardContent className="flex min-h-48 items-center justify-center gap-2 text-sm text-text-muted">
          <LoaderCircleIcon className="size-4 animate-spin motion-reduce:animate-none" />
          Loading observability...
        </CardContent>
      </Card>
    );
  }

  if (!detail) {
    return (
      <Card>
        <CardContent className="flex min-h-48 items-center justify-center text-center text-sm text-text-muted">
          Run observability appears after a run is selected.
        </CardContent>
      </Card>
    );
  }

  return (
    <aside className="flex min-w-0 flex-col gap-3">
      <RunFactsCard
        detail={detail}
      />

      <UsageCard
        detail={detail}
      />

      <EventsCard
        detail={detail}
      />

      <LatestFailureCard
        detail={detail}
      />
    </aside>
  );
}

interface DetailCardProps {
  detail: RunMonitoringDetail;
}

/**
 * Renders immutable run identity and lifecycle facts.
 */
function RunFactsCard({
  detail,
}: DetailCardProps) {
  const currentAgent =
    detail.executionPlan.find(
      (agent) =>
        agent.id ===
        detail.run
          .currentAgentId,
    ) ?? null;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>
          Run Facts
        </CardTitle>

        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Copy run ID"
          onClick={() =>
            void copyText(
              detail.run.id,
            )
          }
        >
          <CopyIcon className="size-3" />
        </Button>
      </CardHeader>

      <CardContent className="grid gap-2.5 text-xs">
        <FactRow
          label="Run ID"
          value={
            detail.run.id
          }
          mono
        />

        <FactRow
          label="Task ID"
          value={
            detail.run
              .taskId ??
            "Unavailable"
          }
          mono
        />

        <FactRow
          label="Project"
          value={
            detail.run
              .projectPath
          }
        />

        <FactRow
          label="Status"
          value={formatStatusLabel(
            detail.run.status,
          )}
        />

        <FactRow
          label="Current Agent"
          value={
            currentAgent
              ? `${currentAgent.name} (${currentAgent.role})`
              : "Unavailable"
          }
        />

        <FactRow
          label="Created At"
          value={formatDateTime(
            detail.run
              .createdAt,
          )}
        />

        <FactRow
          label="Updated At"
          value={formatDateTime(
            detail.run
              .updatedAt,
          )}
        />
      </CardContent>
    </Card>
  );
}

interface FactRowProps {
  label: string;
  value: string;
  mono?: boolean;
}

/**
 * Renders one fact row while preserving long values through wrapping.
 */
function FactRow({
  label,
  value,
  mono = false,
}: FactRowProps) {
  return (
    <div className="grid grid-cols-[92px_minmax(0,1fr)] gap-3">
      <span className="text-text-muted">
        {label}
      </span>

      <span
        className={cn(
          "break-all text-text-secondary",
          mono &&
            "font-mono text-[10px]",
        )}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * Renders normalized usage telemetry and explicit unavailable states.
 */
function UsageCard({
  detail,
}: DetailCardProps) {
  const usage =
    aggregateRunUsage(
      detail.executions,
    );

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Usage (Aggregated)
        </CardTitle>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <div>
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="font-medium text-text-secondary">
              Tokens Used
            </span>

            <span className="font-medium tabular-nums text-text-primary">
              {usage.tokens
                ?.totalTokens !==
                null &&
              usage.tokens
                ?.totalTokens !==
                undefined
                ? formatCompactNumber(
                    usage.tokens
                      .totalTokens,
                  )
                : "Unavailable"}
            </span>
          </div>

          {usage.tokens ? (
            <div className="mt-2 grid grid-cols-3 gap-2 text-[10px] text-text-muted">
              <span>
                In{" "}
                {formatCompactNumber(
                  usage.tokens
                    .inputTokens,
                )}
              </span>

              <span>
                Out{" "}
                {formatCompactNumber(
                  usage.tokens
                    .outputTokens,
                )}
              </span>

              <span>
                Cached{" "}
                {formatCompactNumber(
                  usage.tokens
                    .cachedTokens,
                )}
              </span>
            </div>
          ) : (
            <p className="mt-1 text-[11px] text-text-muted">
              Provider token telemetry is unavailable.
            </p>
          )}

          {usage.tokenTelemetryPartial ? (
            <p className="mt-1 text-[10px] text-status-warning">
              Partial provider telemetry
            </p>
          ) : null}
        </div>

        <div className="border-t border-divider pt-4">
          {usage.context ? (
            usage.context
              .usedTokens !==
              null &&
            usage.context
              .limitTokens !==
              null ? (
              <ContextUsage
                label="Context Used"
                percent={
                  usage.context
                    .percent
                }
                current={formatCompactNumber(
                  usage.context
                    .usedTokens,
                )}
                total={formatCompactNumber(
                  usage.context
                    .limitTokens,
                )}
              />
            ) : (
              <div>
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <span className="font-medium text-text-secondary">
                    Context Used
                  </span>

                  <span className="font-medium text-text-primary">
                    {usage.context.percent.toFixed(
                      0,
                    )}
                    %
                  </span>
                </div>

                <Progress
                  value={
                    usage.context
                      .percent
                  }
                  className="[&_[data-slot=progress-indicator]]:bg-status-running"
                />
              </div>
            )
          ) : (
            <div>
              <p className="text-xs font-medium text-text-secondary">
                Context Used
              </p>

              <p className="mt-1 text-[11px] text-text-muted">
                Unavailable
              </p>
            </div>
          )}

          {usage.contextTelemetryPartial ? (
            <p className="mt-2 text-[10px] text-status-warning">
              Context telemetry is available for only part of this run.
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Returns the semantic event indicator tone for one persisted domain event.
 */
function eventToneClass(
  type: string,
): string {
  if (
    type.includes(
      "failed",
    )
  ) {
    return "bg-status-error";
  }

  if (
    type.includes(
      "blocked",
    )
  ) {
    return "bg-status-warning";
  }

  if (
    type.includes(
      "completed",
    ) ||
    type ===
      "result.received"
  ) {
    return "bg-status-success";
  }

  if (
    type.includes(
      "cancelled",
    )
  ) {
    return "bg-status-neutral";
  }

  return "bg-status-running";
}

/**
 * Renders the newest business-domain events separately from terminal output.
 */
function EventsCard({
  detail,
}: DetailCardProps) {
  const events =
    [...detail.events]
      .reverse()
      .slice(0, 8);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>
          Events
        </CardTitle>

        <Button
          variant="ghost"
          size="xs"
          render={
            <Link
              href={`/runs/${detail.run.id}`}
            />
          }
        >
          View all
        </Button>
      </CardHeader>

      <CardContent>
        {events.length ? (
          <div className="relative flex flex-col gap-4 before:absolute before:bottom-2 before:left-[3px] before:top-2 before:w-px before:bg-divider">
            {events.map(
              (event) => (
                <div
                  key={
                    event.id
                  }
                  className="relative grid grid-cols-[8px_minmax(0,1fr)] gap-2.5"
                >
                  <span
                    className={cn(
                      "relative z-10 mt-1 size-2 rounded-full",
                      eventToneClass(
                        event.type,
                      ),
                    )}
                    aria-hidden="true"
                  />

                  <div className="min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <span className="truncate font-mono text-[10px] font-medium text-text-secondary">
                        {event.type}
                      </span>

                      <span className="shrink-0 text-[10px] text-text-muted">
                        {formatRelativeTime(
                          event.createdAt,
                        )}
                      </span>
                    </div>

                    <p className="mt-0.5 text-[11px] leading-4 text-text-muted">
                      {describeDomainEvent(
                        event,
                        detail.executionPlan,
                        detail.executions,
                      )}
                    </p>
                  </div>
                </div>
              ),
            )}
          </div>
        ) : (
          <p className="text-xs text-text-muted">
            No workflow events recorded.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Renders the latest terminal or execution failure reason without inventing failure state.
 */
function LatestFailureCard({
  detail,
}: DetailCardProps) {
  const failure =
    findLatestFailure(
      detail,
    );

  return (
    <Card>
      <CardHeader className="flex-row items-center gap-2">
        {failure ? (
          <XCircleIcon className="size-4 text-status-error" />
        ) : detail.run
            .status ===
          "completed" ? (
          <CheckCircle2Icon className="size-4 text-status-success" />
        ) : detail.run
            .status ===
          "cancelled" ? (
          <BanIcon className="size-4 text-status-neutral" />
        ) : (
          <CircleDotIcon className="size-4 text-status-running" />
        )}

        <CardTitle>
          Latest Failure / Terminal Reason
        </CardTitle>
      </CardHeader>

      <CardContent>
        {failure ? (
          <p className="text-xs leading-5 text-text-secondary">
            {failure}
          </p>
        ) : detail.run
            .status ===
          "completed" ? (
          <p className="text-xs text-status-success">
            Run completed without a recorded failure.
          </p>
        ) : detail.run
            .status ===
          "cancelled" ? (
          <p className="text-xs text-text-muted">
            Run was cancelled without an additional failure reason.
          </p>
        ) : (
          <>
            <p className="text-xs font-medium text-text-primary">
              No failure yet
            </p>

            <p className="mt-1 text-[11px] text-text-muted">
              Run has no persisted terminal failure reason.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
