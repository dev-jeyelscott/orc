import type {
  Run,
  Task,
} from "@orc/shared";

export const DEFAULT_TASK_VIEW_MODE =
  "table" as const;

export const DEFAULT_TASK_SORT_ORDER =
  "newest" as const;

export type TaskViewMode =
  | "table"
  | "list"
  | "detailed"
  | "grid";

export type TaskSortOrder =
  | "newest"
  | "oldest";

/**
 * Converts an ISO timestamp into a sortable numeric value while keeping invalid
 * values deterministic instead of throwing during presentation.
 */
function toTimestamp(
  value: string,
): number {
  const timestamp =
    new Date(value).getTime();

  return Number.isNaN(timestamp)
    ? 0
    : timestamp;
}

/**
 * Produces a compact one-line instruction preview from the existing Task
 * instruction field without adding a duplicate description contract.
 */
export function normalizeTaskInstruction(
  instruction: string,
  maxLength = 180,
): string {
  const normalized =
    instruction
      .replace(/\s+/g, " ")
      .trim();

  if (
    normalized.length <=
    maxLength
  ) {
    return normalized;
  }

  if (maxLength <= 3) {
    return normalized.slice(
      0,
      maxLength,
    );
  }

  return `${normalized
    .slice(
      0,
      maxLength - 3,
    )
    .trimEnd()}...`;
}

/**
 * Matches one Task against the collection search query using fields already
 * available through the current frontend contracts.
 */
export function matchesTaskQuery(
  task: Task,
  query: string,
  teamName:
    string | undefined,
): boolean {
  const normalizedQuery =
    query
      .trim()
      .toLowerCase();

  if (
    normalizedQuery.length ===
    0
  ) {
    return true;
  }

  const searchableValues = [
    task.id,
    task.title,
    task.instruction,
    task.projectPath,
    task.status,
    task.source,
    task.externalId ?? "",
    String(task.priority),
    teamName ?? "",
  ];

  return searchableValues.some(
    (value) =>
      value
        .toLowerCase()
        .includes(
          normalizedQuery,
        ),
  );
}

/**
 * Returns a copied Task array ordered by creation time with a stable ID
 * fallback so presentation does not depend on API ordering.
 */
export function sortTasks(
  tasks: Task[],
  order:
    TaskSortOrder,
): Task[] {
  const direction =
    order === "newest"
      ? -1
      : 1;

  return tasks
    .slice()
    .sort(
      (
        left,
        right,
      ) => {
        const timestampComparison =
          toTimestamp(
            left.createdAt,
          ) -
          toTimestamp(
            right.createdAt,
          );

        if (
          timestampComparison !==
          0
        ) {
          return (
            timestampComparison *
            direction
          );
        }

        return (
          left.id.localeCompare(
            right.id,
          ) * direction
        );
      },
    );
}

/**
 * Applies the shared collection search and sorting rules used by every Tasks
 * presentation mode.
 */
export function getVisibleTasks(
  tasks: Task[],
  query: string,
  teamNameById:
    ReadonlyMap<
      string,
      string
    >,
  sortOrder:
    TaskSortOrder,
): Task[] {
  const filtered =
    tasks.filter(
      (task) =>
        matchesTaskQuery(
          task,
          query,
          teamNameById.get(
            task.teamId,
          ),
        ),
    );

  return sortTasks(
    filtered,
    sortOrder,
  );
}

/**
 * Builds the latest Run lookup for Tasks independently of backend list order.
 */
export function buildLatestRunByTaskId(
  runs: Run[],
): Map<
  string,
  Run
> {
  const index =
    new Map<
      string,
      Run
    >();

  for (const run of runs) {
    if (!run.taskId) {
      continue;
    }

    const current =
      index.get(
        run.taskId,
      );

    if (!current) {
      index.set(
        run.taskId,
        run,
      );

      continue;
    }

    const runTimestamp =
      toTimestamp(
        run.createdAt,
      );

    const currentTimestamp =
      toTimestamp(
        current.createdAt,
      );

    if (
      runTimestamp >
        currentTimestamp ||
      (
        runTimestamp ===
          currentTimestamp &&
        run.id.localeCompare(
          current.id,
        ) > 0
      )
    ) {
      index.set(
        run.taskId,
        run,
      );
    }
  }

  return index;
}

/**
 * Reports whether a Run is currently using the global active workflow slot.
 */
export function isRunActive(
  run:
    Run | null,
): boolean {
  return (
    run?.status ===
      "pending" ||
    run?.status ===
      "running"
  );
}

/**
 * Reports whether the current backend supports retrying the Run from the UI.
 */
export function canRetryRun(
  run:
    Run | null,
): boolean {
  return (
    run?.status ===
      "failed" ||
    run?.status ===
      "blocked"
  );
}

/**
 * Reports whether the current backend supports cancellation of the Run.
 */
export function canCancelRun(
  run:
    Run | null,
): boolean {
  return isRunActive(
    run,
  );
}

/**
 * Reports whether an active Notion-backed Task can use the existing skip
 * workflow action.
 */
export function canSkipRun(
  task: Task,
  run:
    Run | null,
): boolean {
  return (
    task.source ===
      "notion" &&
    isRunActive(
      run,
    )
  );
}
