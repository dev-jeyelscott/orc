"use client";

import {
  AlertTriangleIcon,
  InboxIcon,
  LayoutGridIcon,
  ListIcon,
  RefreshCwIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  TableIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type {
  RunMonitoringSummary,
} from "@orc/shared";

import {
  RunCollectionViews,
  type RunViewMode,
} from "@/components/run-collection-views";
import { ListEmptyState } from "@/components/patterns/empty-state";
import { FilterSelect } from "@/components/patterns/filter-select";
import { SearchInput } from "@/components/patterns/search-input";
import { ViewToggle } from "@/components/patterns/view-toggle";
import { Button } from "@/components/ui/button";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
} from "@/components/ui/pagination";
import {
  RUN_STATUS_FILTERS,
  formatRelativeTime,
  type RunStatusFilter,
} from "@/lib/run-observability";
import {
  deriveRunCollection,
  getRunCollectionState,
  getRunProjectOptions,
  type RunCollectionFilters,
  type RunSortOrder,
} from "@/lib/run-collection";
import { cn } from "@/lib/utils";
import {
  getRunMonitoringRuns,
} from "@/lib/workflows";

const POLL_INTERVAL_MS = 2_000;
const PAGE_SIZE = 10;

type PaginationToken =
  | number
  | "start-ellipsis"
  | "end-ellipsis";

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
 * Converts one persisted status value into a compact control label.
 */
function statusLabel(
  status: RunStatusFilter,
): string {
  if (status === "all") {
    return "All statuses";
  }

  return (
    status.charAt(0).toUpperCase() +
    status.slice(1)
  );
}

const runStatusFilterOptions =
  RUN_STATUS_FILTERS.map(
    (status) => ({
      value: status,
      label: statusLabel(status),
    }),
  );

const runViewModes = [
  {
    value: "list",
    label: "List",
    icon: <ListIcon aria-hidden="true" />,
  },
  {
    value: "details",
    label: "Detailed",
    icon: <TableIcon aria-hidden="true" />,
  },
  {
    value: "grid",
    label: "Grid",
    icon: <LayoutGridIcon aria-hidden="true" />,
  },
];

/**
 * Returns a compact pagination model that keeps the current page and boundary pages discoverable.
 */
function buildPaginationTokens(
  totalPages: number,
  currentPage: number,
): PaginationToken[] {
  if (totalPages <= 7) {
    return Array.from(
      {
        length: totalPages,
      },
      (_, index) =>
        index + 1,
    );
  }

  if (currentPage <= 4) {
    return [
      1,
      2,
      3,
      4,
      5,
      "end-ellipsis",
      totalPages,
    ];
  }

  if (
    currentPage >=
    totalPages - 3
  ) {
    return [
      1,
      "start-ellipsis",
      totalPages - 4,
      totalPages - 3,
      totalPages - 2,
      totalPages - 1,
      totalPages,
    ];
  }

  return [
    1,
    "start-ellipsis",
    currentPage - 1,
    currentPage,
    currentPage + 1,
    "end-ellipsis",
    totalPages,
  ];
}

/**
 * Owns the focused Runs collection, live summary polling, client-side controls, pagination, and presentation mode.
 */
export function RunsList() {
  const mountedRef = useRef(false);
  const requestInFlightRef =
    useRef(false);
  const abortRef =
    useRef<AbortController | null>(
      null,
    );

  const [
    runs,
    setRuns,
  ] = useState<RunMonitoringSummary[]>(
    [],
  );
  const [
    search,
    setSearch,
  ] = useState("");
  const [
    statusFilter,
    setStatusFilter,
  ] = useState<RunStatusFilter>(
    "all",
  );
  const [
    projectFilter,
    setProjectFilter,
  ] = useState("all");
  const [
    sortOrder,
    setSortOrder,
  ] = useState<RunSortOrder>(
    "newest",
  );
  const [
    viewMode,
    setViewMode,
  ] = useState<RunViewMode>(
    "list",
  );
  const [
    currentPage,
    setCurrentPage,
  ] = useState(1);
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
    lastSyncedAt,
    setLastSyncedAt,
  ] = useState<number | null>(
    null,
  );

  /**
   * Loads the authoritative monitoring-summary collection without issuing per-Run detail requests.
   */
  const loadRuns = useCallback(
    async ({
      initial = false,
      manual = false,
    }: {
      initial?: boolean;
      manual?: boolean;
    } = {}) => {
      if (
        requestInFlightRef.current
      ) {
        return;
      }

      requestInFlightRef.current =
        true;

      const controller =
        new AbortController();
      abortRef.current =
        controller;

      if (manual) {
        setRefreshing(true);
      }

      try {
        const value =
          await getRunMonitoringRuns(
            controller.signal,
          );

        if (
          controller.signal.aborted ||
          !mountedRef.current
        ) {
          return;
        }

        setRuns(value);
        setRunsError(null);
        setLastSyncedAt(
          Date.now(),
        );
      } catch (error) {
        if (
          !isAbortError(error) &&
          mountedRef.current
        ) {
          setRunsError(
            errorMessage(error),
          );
        }
      } finally {
        if (
          abortRef.current ===
          controller
        ) {
          requestInFlightRef.current =
            false;
          abortRef.current = null;

          if (
            mountedRef.current &&
            manual
          ) {
            setRefreshing(false);
          }

          if (
            mountedRef.current &&
            initial
          ) {
            setInitialLoading(false);
          }
        }
      }
    },
    [],
  );

  useEffect(() => {
    mountedRef.current = true;

    queueMicrotask(() => {
      void loadRuns({
        initial: true,
      });
    });

    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      requestInFlightRef.current =
        false;
    };
  }, [loadRuns]);

  useEffect(() => {
    /**
     * Refreshes the summary collection only while the operator can see the browser tab.
     */
    function tick(): void {
      if (
        document.visibilityState !==
        "visible"
      ) {
        return;
      }

      void loadRuns();
    }

    /**
     * Immediately catches Run summaries up when the operator returns to the tab.
     */
    function handleVisibility(): void {
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
      window.clearInterval(timer);
      document.removeEventListener(
        "visibilitychange",
        handleVisibility,
      );
    };
  }, [loadRuns]);

  const projectOptions = useMemo(
    () =>
      getRunProjectOptions(
        runs,
      ),
    [runs],
  );

  const effectiveProjectFilter =
    projectFilter === "all" ||
    projectOptions.some(
      (option) =>
        option.value ===
        projectFilter,
    )
      ? projectFilter
      : "all";

  const filters = useMemo<RunCollectionFilters>(
    () => ({
      search,
      status:
        statusFilter,
      projectPath:
        effectiveProjectFilter,
    }),
    [
      effectiveProjectFilter,
      search,
      statusFilter,
    ],
  );

  const visibleRuns = useMemo(
    () =>
      deriveRunCollection(
        runs,
        filters,
        sortOrder,
      ),
    [
      filters,
      runs,
      sortOrder,
    ],
  );

  const collectionState =
    getRunCollectionState(
      runs.length,
      visibleRuns.length,
      filters,
    );

  const totalPages = Math.max(
    1,
    Math.ceil(
      visibleRuns.length /
        PAGE_SIZE,
    ),
  );

  const effectiveCurrentPage =
    Math.min(
      currentPage,
      totalPages,
    );

  const pageStart =
    (effectiveCurrentPage - 1) *
    PAGE_SIZE;
  const pageRuns =
    visibleRuns.slice(
      pageStart,
      pageStart + PAGE_SIZE,
    );
  const pageEnd =
    Math.min(
      pageStart +
        pageRuns.length,
      visibleRuns.length,
    );
  const controlsDisabled =
    runs.length === 0;
  const paginationTokens =
    buildPaginationTokens(
      totalPages,
      effectiveCurrentPage,
    );

  /**
   * Clears only collection filters while preserving the operator's chosen view and sort order.
   */
  function clearFilters(): void {
    setSearch("");
    setStatusFilter("all");
    setProjectFilter("all");
    setCurrentPage(1);
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <header className="min-w-0">
        <h1 className="font-heading text-2xl font-semibold text-text-primary">
          Runs
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          Track and review recent workflow runs.
        </p>
      </header>

      <section
        className="min-w-0 overflow-hidden rounded-lg border border-border-default bg-surface-elevated shadow-xs"
        aria-label="Runs browser"
      >
        <div className="flex min-w-0 flex-col gap-2 border-b border-divider p-3 xl:flex-row xl:items-center">
          <SearchInput
            className="min-w-0 flex-1 xl:max-w-md"
            value={search}
            onChange={(value) => {
              setSearch(value);
              setCurrentPage(1);
            }}
            placeholder="Search runs..."
            aria-label="Search runs"
            disabled={controlsDisabled}
          />

          <FilterSelect
            className="w-full sm:w-40"
            options={runStatusFilterOptions}
            value={statusFilter}
            onChange={(value) => {
              setStatusFilter(
                value as RunStatusFilter,
              );
              setCurrentPage(1);
            }}
            aria-label="Filter runs by status"
            disabled={controlsDisabled}
          />

          <NativeSelect
            size="default"
            className="w-full sm:w-48"
            value={
              effectiveProjectFilter
            }
            onChange={(event) => {
              setProjectFilter(
                event.target.value,
              );
              setCurrentPage(1);
            }}
            aria-label="Filter runs by project"
            disabled={controlsDisabled}
          >
            <NativeSelectOption value="all">
              All projects
            </NativeSelectOption>

            {projectOptions.map(
              (option) => (
                <NativeSelectOption
                  key={option.value}
                  value={option.value}
                >
                  {option.label}
                </NativeSelectOption>
              ),
            )}
          </NativeSelect>

          <NativeSelect
            size="default"
            className="w-full sm:w-40"
            value={sortOrder}
            onChange={(event) => {
              setSortOrder(
                event.target
                  .value as RunSortOrder,
              );
              setCurrentPage(1);
            }}
            aria-label="Sort runs"
            disabled={controlsDisabled}
          >
            <NativeSelectOption value="newest">
              Newest first
            </NativeSelectOption>

            <NativeSelectOption value="oldest">
              Oldest first
            </NativeSelectOption>
          </NativeSelect>

          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() =>
              void loadRuns({
                manual: true,
              })
            }
            disabled={
              refreshing ||
              initialLoading
            }
            aria-label="Refresh runs"
            title="Refresh runs"
          >
            <RefreshCwIcon
              className={cn(
                refreshing &&
                  "animate-spin motion-reduce:animate-none",
              )}
              aria-hidden="true"
            />
          </Button>

          <ViewToggle
            className="w-full xl:ml-auto xl:w-auto"
            aria-label="Run view mode"
            value={viewMode}
            onChange={(value) =>
              setViewMode(
                value as RunViewMode,
              )
            }
            modes={runViewModes}
            disabled={controlsDisabled}
          />
        </div>

        {runsError &&
        runs.length > 0 ? (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-2 border-b border-divider bg-status-error/5 px-4 py-2 text-xs text-status-error"
          >
            <span>
              Failed to refresh runs.{" "}
              {runsError}
            </span>

            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() =>
                void loadRuns({
                  manual: true,
                })
              }
              disabled={refreshing}
            >
              Retry
            </Button>
          </div>
        ) : null}

        <div className="min-w-0 overflow-x-auto">
          {initialLoading &&
          runs.length === 0 ? (
            <ListEmptyState
              variant="loading"
              title="Loading runs..."
            />
          ) : null}

          {!initialLoading &&
          runsError &&
          runs.length === 0 ? (
            <ListEmptyState
              variant="error"
              icon={<AlertTriangleIcon />}
              title="Failed to load runs"
              description={runsError}
              onRetry={() =>
                void loadRuns({
                  manual: true,
                })
              }
            />
          ) : null}

          {!initialLoading &&
          !runsError &&
          collectionState ===
            "empty" ? (
            <ListEmptyState
              variant="empty"
              icon={<InboxIcon />}
              title="No runs yet"
              description="Workflow runs will appear here after they are created by the existing task and orchestration flows."
            />
          ) : null}

          {!initialLoading &&
          collectionState ===
            "filtered-empty" ? (
            <ListEmptyState
              variant="empty"
              icon={<SearchIcon />}
              title="No runs match these filters"
              description="Adjust the search, status, or project filter to broaden the collection."
              onRetry={clearFilters}
              retryLabel="Clear filters"
            />
          ) : null}

          {collectionState ===
          "ready" ? (
            <RunCollectionViews
              runs={pageRuns}
              viewMode={viewMode}
            />
          ) : null}
        </div>

        {collectionState ===
        "ready" ? (
          <footer className="flex flex-col gap-3 border-t border-divider px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-text-muted">
              Showing{" "}
              {visibleRuns.length > 0
                ? pageStart + 1
                : 0}
              -{pageEnd} of{" "}
              {visibleRuns.length} runs
              {runs.length !==
              visibleRuns.length
                ? ` (${runs.length} total)`
                : ""}
              {" · "}
              Sorted{" "}
              {sortOrder ===
              "newest"
                ? "newest first"
                : "oldest first"}
              {lastSyncedAt
                ? ` · Synced ${formatRelativeTime(
                    new Date(
                      lastSyncedAt,
                    ).toISOString(),
                  )}`
                : ""}
            </p>

            {totalPages > 1 ? (
              <Pagination className="mx-0 w-auto justify-start sm:justify-end">
                <PaginationContent>
                  <PaginationItem>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Go to previous page"
                      disabled={
                        effectiveCurrentPage ===
                        1
                      }
                      onClick={() =>
                        setCurrentPage(
                          Math.max(
                            1,
                            effectiveCurrentPage -
                              1,
                          ),
                        )
                      }
                    >
                      <span aria-hidden="true">
                        ‹
                      </span>
                    </Button>
                  </PaginationItem>

                  {paginationTokens.map(
                    (token) => {
                      if (
                        token ===
                          "start-ellipsis" ||
                        token ===
                          "end-ellipsis"
                      ) {
                        return (
                          <PaginationItem
                            key={token}
                          >
                            <PaginationEllipsis />
                          </PaginationItem>
                        );
                      }

                      return (
                        <PaginationItem
                          key={token}
                        >
                          <Button
                            type="button"
                            variant={
                              token ===
                              effectiveCurrentPage
                                ? "outline"
                                : "ghost"
                            }
                            size="icon-sm"
                            aria-label={`Go to page ${token}`}
                            aria-current={
                              token ===
                              effectiveCurrentPage
                                ? "page"
                                : undefined
                            }
                            onClick={() =>
                              setCurrentPage(
                                token,
                              )
                            }
                          >
                            {token}
                          </Button>
                        </PaginationItem>
                      );
                    },
                  )}

                  <PaginationItem>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Go to next page"
                      disabled={
                        effectiveCurrentPage ===
                        totalPages
                      }
                      onClick={() =>
                        setCurrentPage(
                          Math.min(
                            totalPages,
                            effectiveCurrentPage +
                              1,
                          ),
                        )
                      }
                    >
                      <span aria-hidden="true">
                        ›
                      </span>
                    </Button>
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            ) : null}
          </footer>
        ) : null}
      </section>
    </div>
  );
}
