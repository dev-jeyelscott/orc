import type {
  RunMonitoringSummary,
} from "@orc/shared";

import type {
  RunStatusFilter,
} from "./run-observability";

export type RunSortOrder =
  | "newest"
  | "oldest";

export type RunCollectionState =
  | "empty"
  | "filtered-empty"
  | "ready";

export type RunCollectionFilters = {
  search: string;
  status: RunStatusFilter;
  projectPath: string;
};

export type RunProjectOption = {
  value: string;
  label: string;
};

/**
 * Returns the final path segment for one persisted Run project path.
 */
export function getRunProjectName(
  projectPath: string,
): string {
  const normalized = projectPath
    .replace(/\\/g, "/")
    .replace(/\/+$/, "");

  const segments = normalized
    .split("/")
    .filter(Boolean);

  return (
    segments.at(-1) ??
    projectPath
  );
}

/**
 * Returns deterministic unique project options from the currently loaded Run summaries.
 */
export function getRunProjectOptions(
  runs: RunMonitoringSummary[],
): RunProjectOption[] {
  const uniquePaths =
    [...new Set(
      runs.map(
        (run) =>
          run.projectPath,
      ),
    )];

  return uniquePaths
    .map((value) => ({
      value,
      label:
        getRunProjectName(
          value,
        ),
    }))
    .sort((left, right) =>
      left.label.localeCompare(
        right.label,
        undefined,
        {
          numeric: true,
          sensitivity: "base",
        },
      ) ||
      left.value.localeCompare(
        right.value,
      ),
    );
}

/**
 * Filters one Run collection using only persisted summary data exposed by the current monitoring contract.
 */
export function filterRunCollection(
  runs: RunMonitoringSummary[],
  filters: RunCollectionFilters,
): RunMonitoringSummary[] {
  const query = filters.search
    .trim()
    .toLowerCase();

  return runs.filter((run) => {
    if (
      filters.status !== "all" &&
      run.status !== filters.status
    ) {
      return false;
    }

    if (
      filters.projectPath !== "all" &&
      run.projectPath !==
        filters.projectPath
    ) {
      return false;
    }

    if (!query) {
      return true;
    }

    return [
      run.id,
      run.taskId ?? "",
      run.taskTitle ?? "",
      run.projectPath,
      getRunProjectName(
        run.projectPath,
      ),
      run.status,
      run.terminalReason ?? "",
      run.currentAgent?.name ??
        "",
      run.currentAgent?.role ??
        "",
      run.currentAgent?.harness ??
        "",
      run.currentAgent?.model ??
        "",
    ].some((value) =>
      value
        .toLowerCase()
        .includes(query),
    );
  });
}

/**
 * Sorts Run summaries deterministically by persisted creation time without mutating the source collection.
 */
export function sortRunCollection(
  runs: RunMonitoringSummary[],
  sortOrder: RunSortOrder,
): RunMonitoringSummary[] {
  const direction =
    sortOrder === "newest"
      ? -1
      : 1;

  return [...runs].sort(
    (left, right) => {
      const leftTimestamp =
        Date.parse(
          left.createdAt,
        );
      const rightTimestamp =
        Date.parse(
          right.createdAt,
        );

      const safeLeft =
        Number.isFinite(
          leftTimestamp,
        )
          ? leftTimestamp
          : 0;
      const safeRight =
        Number.isFinite(
          rightTimestamp,
        )
          ? rightTimestamp
          : 0;

      const timestampComparison =
        (safeLeft -
          safeRight) *
        direction;

      if (
        timestampComparison !== 0
      ) {
        return timestampComparison;
      }

      return left.id.localeCompare(
        right.id,
      );
    },
  );
}

/**
 * Produces the single authoritative filtered and sorted Run dataset shared by every collection view.
 */
export function deriveRunCollection(
  runs: RunMonitoringSummary[],
  filters: RunCollectionFilters,
  sortOrder: RunSortOrder,
): RunMonitoringSummary[] {
  return sortRunCollection(
    filterRunCollection(
      runs,
      filters,
    ),
    sortOrder,
  );
}

/**
 * Resolves whether the collection should render data, a first-use empty state, or a filtered-empty state.
 */
export function getRunCollectionState(
  totalRuns: number,
  visibleRuns: number,
  filters: RunCollectionFilters,
): RunCollectionState {
  if (totalRuns === 0) {
    return "empty";
  }

  const hasActiveFilters =
    filters.search.trim().length >
      0 ||
    filters.status !== "all" ||
    filters.projectPath !== "all";

  if (
    visibleRuns === 0 &&
    hasActiveFilters
  ) {
    return "filtered-empty";
  }

  return "ready";
}
