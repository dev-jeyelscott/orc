"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  CircleAlertIcon,
  LoaderCircleIcon,
} from "lucide-react";

import type {
  RunMonitoringDetail,
  RunMonitoringSummary,
} from "@orc/shared";

import { RunMetricsStrip } from "@/components/run-metrics-strip";
import { RunNavigator } from "@/components/run-navigator";
import { RunsHeader } from "@/components/runs-header";
import { RunsOverTime } from "@/components/runs-over-time";
import { SelectedRunWorkspace } from "@/components/selected-run-workspace";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import {
  buildRunsOverTime,
  calculateRunMetrics,
  filterRunSummaries,
  scopeRunsByTime,
  type RunStatusFilter,
  type RunTimeRange,
} from "@/lib/run-observability";
import {
  cancelRun,
  getRunMonitoringDetail,
  getRunMonitoringRuns,
  retryRun,
} from "@/lib/workflows";

const POLL_INTERVAL_MS = 2_000;

type ActionPending =
  | "cancel"
  | "retry"
  | null;

type DetailErrorState = {
  runId: string;
  message: string;
};

/**
 * Converts an unknown monitoring request failure into an operator-readable message.
 */
function errorMessage(
  error: unknown,
): string {
  return error instanceof Error
    ? error.message
    : "Unable to load run monitoring data";
}

/**
 * Determines whether one browser request failure was caused by intentional cancellation.
 */
function isAbortError(
  error: unknown,
): boolean {
  return (
    error instanceof DOMException &&
    error.name === "AbortError"
  );
}

/**
 * Owns authoritative Runs page state, polling, mutations, and high-level page composition.
 */
export function RunsList() {
  const [
    runs,
    setRuns,
  ] = useState<RunMonitoringSummary[]>(
    [],
  );

  const [
    selectedRunId,
    setSelectedRunId,
  ] = useState<string | null>(
    null,
  );

  const [
    detailState,
    setDetail,
  ] =
    useState<RunMonitoringDetail | null>(
      null,
    );

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
  ] = useState<string | null>(
    null,
  );

  const [
    detailErrorState,
    setDetailErrorState,
  ] =
    useState<DetailErrorState | null>(
      null,
    );

  const [
    actionError,
    setActionError,
  ] = useState<string | null>(
    null,
  );

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
  ] = useState<number | null>(
    null,
  );

  const runsAbortRef =
    useRef<AbortController | null>(
      null,
    );

  const detailAbortRef =
    useRef<AbortController | null>(
      null,
    );

  /**
   * Loads monitoring summaries while cancelling any older list request.
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
            controller.signal.aborted
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
   * Loads one selected monitoring detail while cancelling any older detail request.
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
            controller.signal.aborted
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
    let disposed = false;

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

    let disposed = false;

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
     * Refreshes live monitoring only while the browser tab is visible.
     */
    function tick() {
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
    }

    /**
     * Immediately catches monitoring state up when the operator returns to the tab.
     */
    function handleVisibility() {
      if (
        document.visibilityState ===
        "visible"
      ) {
        tick();
      }
    }

    const timer =
      window.setInterval(
        tick,
        POLL_INTERVAL_MS,
      );

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

  /**
   * Reloads the run navigator and currently selected detail from authoritative backend state.
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
   * Cancels an active selected workflow after explicit destructive confirmation.
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
   * Retries the final failed or blocked execution through the existing backend policy.
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
    <div className="flex min-w-0 flex-col gap-3">
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

      <RunMetricsStrip
        metrics={metrics}
      />

      <RunsOverTime
        data={chartData}
        timeRange={
          timeRange
        }
      />

      {runsError ? (
        <Card className="border-status-error/40">
          <CardContent className="flex items-center justify-between gap-3 py-3 text-sm">
            <span className="flex min-w-0 items-center gap-2 text-status-error">
              <CircleAlertIcon className="size-4 shrink-0" />
              <span className="truncate">
                {runsError}
              </span>
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

      <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(280px,330px)_minmax(0,1fr)]">
        <RunNavigator
          runs={
            visibleRuns
          }
          selectedRunId={
            selectedRunId
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
          onReload={() => {
            if (
              selectedRunId
            ) {
              void loadDetail(
                selectedRunId,
              );
            }
          }}
          onCancel={() =>
            void handleCancel()
          }
          onRetry={() =>
            void handleRetry()
          }
        />
      </div>
    </div>
  );
}
