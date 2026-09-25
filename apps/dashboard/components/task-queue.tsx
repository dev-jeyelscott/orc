"use client";

import { useRouter } from "next/navigation";
import {
  BanIcon,
  ExternalLinkIcon,
  EyeIcon,
  ForwardIcon,
  LayoutGridIcon,
  ListChecksIcon,
  ListIcon,
  RefreshCwIcon,
  Table2Icon,
} from "lucide-react";
import {
  useMemo,
  useState,
} from "react";
import type {
  Run,
  Task,
  Team,
} from "@orc/shared";

import {
  ListEmptyState,
} from "@/components/patterns/empty-state";
import {
  DataTable,
  type DataTableColumn,
} from "@/components/patterns/data-table";
import {
  RowActionsMenu,
  type RowActionsMenuItem,
} from "@/components/patterns/row-actions-menu";
import {
  SearchInput,
} from "@/components/patterns/search-input";
import {
  StatusBadge,
} from "@/components/patterns/status-badge";
import {
  Button,
} from "@/components/ui/button";
import {
  ButtonGroup,
} from "@/components/ui/button-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import {
  DEFAULT_TASK_SORT_ORDER,
  DEFAULT_TASK_VIEW_MODE,
  buildLatestRunByTaskId,
  canCancelRun,
  canRetryRun,
  canSkipRun,
  getVisibleTasks,
  normalizeTaskInstruction,
  type TaskSortOrder,
  type TaskViewMode,
} from "@/lib/task-collection-state";
import {
  formatRelativeTimestamp,
  formatStatusLabel,
  getLifecycleBadgeVariant,
  projectNameFromPath,
  shortId,
} from "@/lib/task-presentation";

type TaskQueueProps = {
  tasks: Task[];
  runs: Run[];
  teams: Team[];
  query: string;
  busyRunId:
    string | null;
  onQueryChange:
    (query: string) => void;
  onViewTask:
    (taskId: string) => void;
  onCancelRun:
    (
      runId: string,
    ) => Promise<void> | void;
  onSkipRun:
    (
      runId: string,
    ) => Promise<void> | void;
  onRetryRun:
    (
      runId: string,
    ) => Promise<void> | void;
};

type TaskActionHandlers = {
  busyRunId:
    string | null;
  onViewTask:
    (taskId: string) => void;
  onCancelRun:
    (
      runId: string,
    ) => Promise<void> | void;
  onSkipRun:
    (
      runId: string,
    ) => Promise<void> | void;
  onRetryRun:
    (
      runId: string,
    ) => Promise<void> | void;
};

type CollectionViewProps = {
  tasks: Task[];
  teamNameById:
    ReadonlyMap<
      string,
      string
    >;
  latestRunByTaskId:
    ReadonlyMap<
      string,
      Run
    >;
  actions:
    TaskActionHandlers;
};

const viewOptions: Array<{
  value:
    TaskViewMode;
  label: string;
  icon:
    typeof Table2Icon;
}> = [
  {
    value:
      "table",
    label:
      "Table",
    icon:
      Table2Icon,
  },
  {
    value:
      "list",
    label:
      "List",
    icon:
      ListIcon,
  },
  {
    value:
      "detailed",
    label:
      "Detailed",
    icon:
      ListChecksIcon,
  },
  {
    value:
      "grid",
    label:
      "Grid",
    icon:
      LayoutGridIcon,
  },
];

/**
 * Renders the shared searchable and sortable Tasks collection while keeping all
 * four presentation modes on one authoritative Task dataset.
 */
export function TaskQueue({
  tasks,
  runs,
  teams,
  query,
  busyRunId,
  onQueryChange,
  onViewTask,
  onCancelRun,
  onSkipRun,
  onRetryRun,
}: TaskQueueProps) {
  const [
    viewMode,
    setViewMode,
  ] =
    useState<TaskViewMode>(
      DEFAULT_TASK_VIEW_MODE,
    );

  const [
    sortOrder,
    setSortOrder,
  ] =
    useState<TaskSortOrder>(
      DEFAULT_TASK_SORT_ORDER,
    );

  const teamNameById =
    useMemo(
      () =>
        new Map(
          teams.map(
            (team) => [
              team.id,
              team.name,
            ],
          ),
        ),
      [
        teams,
      ],
    );

  const latestRunByTaskId =
    useMemo(
      () =>
        buildLatestRunByTaskId(
          runs,
        ),
      [
        runs,
      ],
    );

  const visibleTasks =
    useMemo(
      () =>
        getVisibleTasks(
          tasks,
          query,
          teamNameById,
          sortOrder,
        ),
      [
        tasks,
        query,
        teamNameById,
        sortOrder,
      ],
    );

  const actions:
    TaskActionHandlers = {
    busyRunId,
    onViewTask,
    onCancelRun,
    onSkipRun,
    onRetryRun,
  };

  return (
    <section
      className="min-w-0 space-y-3"
      aria-label="Tasks"
    >
      <div className="neon-surface flex flex-col gap-3 rounded-lg border border-border-default bg-surface-elevated p-3 shadow-xs lg:flex-row lg:items-center lg:justify-between">
        <SearchInput
          className="w-full lg:max-w-md"
          value={query}
          onChange={onQueryChange}
          placeholder="Search tasks..."
          aria-label="Search tasks by title, description, project, Team, ID, source, or status"
        />

        <div className="flex flex-wrap items-center gap-2">
          <ButtonGroup
            aria-label="Task view"
          >
            {viewOptions.map(
              (
                option,
              ) => {
                const Icon =
                  option.icon;

                const active =
                  viewMode ===
                  option.value;

                return (
                  <Button
                    key={
                      option.value
                    }
                    type="button"
                    variant={
                      active
                        ? "secondary"
                        : "outline"
                    }
                    size="sm"
                    aria-pressed={
                      active
                    }
                    aria-label={`${option.label} view`}
                    onClick={() =>
                      setViewMode(
                        option.value,
                      )
                    }
                  >
                    <Icon
                      aria-hidden="true"
                    />

                    <span className="hidden xl:inline">
                      {
                        option.label
                      }
                    </span>
                  </Button>
                );
              },
            )}
          </ButtonGroup>

          <Select
            value={
              sortOrder
            }
            onValueChange={(
              value,
            ) => {
              if (
                value ===
                  "newest" ||
                value ===
                  "oldest"
              ) {
                setSortOrder(
                  value,
                );
              }
            }}
          >
            <SelectTrigger
              size="sm"
              aria-label="Sort tasks"
            >
              {sortOrder ===
              "newest"
                ? "Newest first"
                : "Oldest first"}
            </SelectTrigger>

            <SelectContent
              align="end"
              alignItemWithTrigger={
                false
              }
            >
              <SelectItem value="newest">
                Newest first
              </SelectItem>

              <SelectItem value="oldest">
                Oldest first
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <p className="text-xs text-text-muted">
          {
            visibleTasks.length
          }{" "}
          task
          {visibleTasks.length ===
          1
            ? ""
            : "s"}
        </p>

        {query.trim()
          .length >
        0 ? (
          <p className="text-xs text-text-muted">
            Filtered from{" "}
            {
              tasks.length
            }{" "}
            total
          </p>
        ) : null}
      </div>

      {visibleTasks.length ===
      0 ? (
        <ListEmptyState
          variant="empty"
          className="neon-surface min-h-72 border border-border-default bg-surface-elevated shadow-xs"
          icon={
            <ListChecksIcon
              aria-hidden="true"
            />
          }
          title={
            query.trim()
              .length >
            0
              ? "No matching tasks"
              : "No tasks yet"
          }
          description={
            query.trim()
              .length >
            0
              ? "Change the search query to see other task history."
              : "Create a task to start orchestrated work."
          }
        />
      ) : null}

      {visibleTasks.length >
        0 &&
      viewMode ===
        "table" ? (
        <TaskTable
          tasks={
            visibleTasks
          }
          teamNameById={
            teamNameById
          }
          latestRunByTaskId={
            latestRunByTaskId
          }
          actions={
            actions
          }
        />
      ) : null}

      {visibleTasks.length >
        0 &&
      viewMode ===
        "list" ? (
        <TaskList
          tasks={
            visibleTasks
          }
          teamNameById={
            teamNameById
          }
          latestRunByTaskId={
            latestRunByTaskId
          }
          actions={
            actions
          }
        />
      ) : null}

      {visibleTasks.length >
        0 &&
      viewMode ===
        "detailed" ? (
        <TaskDetailedList
          tasks={
            visibleTasks
          }
          teamNameById={
            teamNameById
          }
          latestRunByTaskId={
            latestRunByTaskId
          }
          actions={
            actions
          }
        />
      ) : null}

      {visibleTasks.length >
        0 &&
      viewMode ===
        "grid" ? (
        <TaskGrid
          tasks={
            visibleTasks
          }
          teamNameById={
            teamNameById
          }
          latestRunByTaskId={
            latestRunByTaskId
          }
          actions={
            actions
          }
        />
      ) : null}
    </section>
  );
}

/**
 * Renders the primary full-width four-column Tasks table.
 */
function TaskTable({
  tasks,
  teamNameById,
  latestRunByTaskId,
  actions,
}: CollectionViewProps) {
  const columns: DataTableColumn<Task>[] = [
    {
      key: "title",
      header: "Title",
      className: "w-[34%] px-4 align-middle",
      render: (task) => (
        <TaskTitleBlock
          task={task}
          teamName={teamNameById.get(
            task.teamId,
          )}
        />
      ),
    },
    {
      key: "description",
      header: "Description",
      className: "w-[44%] min-w-0 align-middle",
      render: (task) => (
        <p className="truncate text-sm text-text-secondary">
          {normalizeTaskInstruction(
            task.instruction,
            200,
          )}
        </p>
      ),
    },
    {
      key: "status",
      header: "Status",
      className: "w-[12%] align-middle",
      render: (task) => (
        <StatusBadge
          variant={getLifecycleBadgeVariant(
            task.status,
          )}
          label={formatStatusLabel(
            task.status,
          )}
          entityLabel="Task"
        />
      ),
    },
    {
      key: "actions",
      header: "Actions",
      className: "w-[10%] pe-4 text-end align-middle",
      render: (task) => (
        <TaskActions
          task={task}
          run={
            latestRunByTaskId.get(
              task.id,
            ) ?? null
          }
          actions={actions}
        />
      ),
    },
  ];

  return (
    <DataTable
      className="min-w-[64rem] table-fixed"
      columns={columns}
      rows={tasks}
      getRowKey={(task) => task.id}
      rowClassName="bg-surface-card"
    />
  );
}

/**
 * Renders a compact stacked-row view using the same Tasks collection and action
 * rules as the primary table.
 */
function TaskList({
  tasks,
  teamNameById,
  latestRunByTaskId,
  actions,
}: CollectionViewProps) {
  return (
    <div className="neon-table-surface overflow-hidden rounded-lg border bg-surface-elevated">
      {tasks.map(
        (task) => {
          const run =
            latestRunByTaskId.get(
              task.id,
            ) ?? null;

          return (
            <article
              key={
                task.id
              }
              className="flex flex-col gap-3 border-b border-divider bg-surface-card p-3 last:border-b-0 hover:bg-surface-interactive sm:flex-row sm:items-center"
            >
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <h2 className="truncate text-sm font-semibold text-text-primary">
                    {
                      task.title
                    }
                  </h2>

                  <StatusBadge
                    variant={getLifecycleBadgeVariant(
                      task.status,
                    )}
                    label={formatStatusLabel(
                      task.status,
                    )}
                    entityLabel="Task"
                  />
                </div>

                <p className="mt-1 truncate text-xs text-text-secondary">
                  {normalizeTaskInstruction(
                    task.instruction,
                    220,
                  )}
                </p>

                <TaskMetadata
                  task={
                    task
                  }
                  teamName={
                    teamNameById.get(
                      task.teamId,
                    )
                  }
                />
              </div>

              <TaskActions
                task={
                  task
                }
                run={
                  run
                }
                actions={
                  actions
                }
              />
            </article>
          );
        },
      )}
    </div>
  );
}

/**
 * Renders an expanded list for operators who want additional Task metadata
 * without opening the complete observability drawer.
 */
function TaskDetailedList({
  tasks,
  teamNameById,
  latestRunByTaskId,
  actions,
}: CollectionViewProps) {
  return (
    <div className="space-y-3">
      {tasks.map(
        (task) => {
          const run =
            latestRunByTaskId.get(
              task.id,
            ) ?? null;

          return (
            <article
              key={
                task.id
              }
              className="neon-surface rounded-lg border border-border-default bg-surface-card p-4 shadow-xs"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <h2 className="font-heading text-base font-semibold text-text-primary">
                      {
                        task.title
                      }
                    </h2>

                    <StatusBadge
                      variant={getLifecycleBadgeVariant(
                        task.status,
                      )}
                      label={formatStatusLabel(
                        task.status,
                      )}
                      entityLabel="Task"
                    />
                  </div>

                  <TaskMetadata
                    task={
                      task
                    }
                    teamName={
                      teamNameById.get(
                        task.teamId,
                      )
                    }
                  />

                  <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-text-secondary">
                    {normalizeTaskInstruction(
                      task.instruction,
                      480,
                    )}
                  </p>

                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
                    <span>
                      Created{" "}
                      {formatRelativeTimestamp(
                        task.createdAt,
                      )}
                    </span>

                    <span>
                      Updated{" "}
                      {formatRelativeTimestamp(
                        task.updatedAt,
                      )}
                    </span>

                    <span>
                      Latest Run{" "}
                      <span className="font-mono text-text-secondary">
                        {run
                          ? `#${shortId(
                              run.id,
                            )}`
                          : "Not started"}
                      </span>
                    </span>
                  </div>
                </div>

                <TaskActions
                  task={
                    task
                  }
                  run={
                    run
                  }
                  actions={
                    actions
                  }
                />
              </div>
            </article>
          );
        },
      )}
    </div>
  );
}

/**
 * Renders a restrained responsive card grid without changing Task collection
 * behavior or introducing grid-specific actions.
 */
function TaskGrid({
  tasks,
  teamNameById,
  latestRunByTaskId,
  actions,
}: CollectionViewProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
      {tasks.map(
        (task) => {
          const run =
            latestRunByTaskId.get(
              task.id,
            ) ?? null;

          return (
            <article
              key={
                task.id
              }
              className="neon-surface flex min-h-52 min-w-0 flex-col rounded-lg border border-border-default bg-surface-card p-4 shadow-xs"
            >
              <div className="flex min-w-0 items-start justify-between gap-3">
                <h2 className="min-w-0 truncate font-heading text-sm font-semibold text-text-primary">
                  {
                    task.title
                  }
                </h2>

                <StatusBadge
                  variant={getLifecycleBadgeVariant(
                    task.status,
                  )}
                  label={formatStatusLabel(
                    task.status,
                  )}
                  entityLabel="Task"
                />
              </div>

              <TaskMetadata
                task={
                  task
                }
                teamName={
                  teamNameById.get(
                    task.teamId,
                  )
                }
              />

              <p className="mt-3 line-clamp-4 flex-1 text-sm leading-relaxed text-text-secondary">
                {normalizeTaskInstruction(
                  task.instruction,
                  280,
                )}
              </p>

              <div className="mt-4 flex items-center justify-between gap-3 border-t border-divider pt-3">
                <span className="text-xs text-text-muted">
                  Updated{" "}
                  {formatRelativeTimestamp(
                    task.updatedAt,
                  )}
                </span>

                <TaskActions
                  task={
                    task
                  }
                  run={
                    run
                  }
                  actions={
                    actions
                  }
                />
              </div>
            </article>
          );
        },
      )}
    </div>
  );
}

/**
 * Renders a Task title and its compact secondary metadata for the primary Table
 * view.
 */
function TaskTitleBlock({
  task,
  teamName,
}: {
  task: Task;
  teamName:
    string | undefined;
}) {
  return (
    <div className="min-w-0">
      <p className="truncate text-sm font-semibold text-text-primary">
        {
          task.title
        }
      </p>

      <TaskMetadata
        task={
          task
        }
        teamName={
          teamName
        }
      />
    </div>
  );
}

/**
 * Renders existing Task metadata beneath the title without introducing
 * additional table columns or backend fields.
 */
function TaskMetadata({
  task,
  teamName,
}: {
  task: Task;
  teamName:
    string | undefined;
}) {
  const metadata = [
    projectNameFromPath(
      task.projectPath,
    ),
    teamName ??
      "Team unavailable",
    formatStatusLabel(
      task.source,
    ),
    task.priority !==
    0
      ? `P${task.priority}`
      : null,
    `#${shortId(
      task.id,
    )}`,
    `Updated ${formatRelativeTimestamp(
      task.updatedAt,
    )}`,
  ].filter(
    (
      value,
    ): value is string =>
      Boolean(value),
  );

  return (
    <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-text-muted">
      {metadata.map(
        (
          value,
          index,
        ) => (
          <span
            key={`${value}-${index}`}
            className="flex min-w-0 items-center gap-1.5"
          >
            {index >
            0 ? (
              <span
                aria-hidden="true"
              >
                ·
              </span>
            ) : null}

            <span className="truncate">
              {
                value
              }
            </span>
          </span>
        ),
      )}
    </div>
  );
}

/**
 * Renders the always-available View action plus only the secondary Run actions
 * already supported by the current backend.
 */
function TaskActions({
  task,
  run,
  actions,
}: {
  task: Task;
  run:
    Run | null;
  actions:
    TaskActionHandlers;
}) {
  const busy =
    Boolean(
      run &&
        actions.busyRunId ===
          run.id,
    );

  const retryable =
    canRetryRun(
      run,
    );

  const cancellable =
    canCancelRun(
      run,
    );

  const skippable =
    canSkipRun(
      task,
      run,
    );

  const hasRunAction =
    Boolean(run);

  const router =
    useRouter();

  const menuItems: RowActionsMenuItem[] =
    run
      ? [
          {
            label: "Open Run",
            icon: (
              <ExternalLinkIcon
                aria-hidden="true"
              />
            ),
            onClick: () =>
              router.push(
                `/runs/${run.id}`,
              ),
          },
          ...(retryable
            ? [
                {
                  label: "Retry Run",
                  icon: (
                    <RefreshCwIcon
                      aria-hidden="true"
                    />
                  ),
                  onClick: () =>
                    void actions.onRetryRun(
                      run.id,
                    ),
                  disabled: busy,
                },
              ]
            : []),
          ...(skippable
            ? [
                {
                  label: "Skip Task",
                  icon: (
                    <ForwardIcon
                      aria-hidden="true"
                    />
                  ),
                  onClick: () =>
                    void actions.onSkipRun(
                      run.id,
                    ),
                  disabled: busy,
                },
              ]
            : []),
          ...(cancellable
            ? [
                {
                  label: "Cancel Run",
                  icon: (
                    <BanIcon
                      aria-hidden="true"
                    />
                  ),
                  onClick: () =>
                    void actions.onCancelRun(
                      run.id,
                    ),
                  destructive: true,
                  disabled: busy,
                },
              ]
            : []),
        ]
      : [];

  return (
    <div className="flex shrink-0 items-center justify-end gap-1">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={() =>
          actions.onViewTask(
            task.id,
          )
        }
        aria-label={`View ${task.title}`}
      >
        <EyeIcon
          aria-hidden="true"
        />
      </Button>

      {hasRunAction &&
      run ? (
        <RowActionsMenu
          label={`More actions for ${task.title}`}
          items={
            menuItems
          }
        />
      ) : null}
    </div>
  );
}
