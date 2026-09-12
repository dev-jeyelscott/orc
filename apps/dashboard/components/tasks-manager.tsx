"use client";

import Link from "next/link";
import {
  PlayIcon,
  PlusIcon,
  RefreshCwIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import type {
  Project,
  Run,
  RunDetail,
  Task,
  TaskWithRun,
  Team,
} from "@orc/shared";

import {
  TaskCreateDrawer,
} from "@/components/task-create-drawer";
import {
  TaskDetailDrawer,
} from "@/components/task-detail-drawer";
import {
  TaskQueue,
} from "@/components/task-queue";
import {
  Badge,
} from "@/components/ui/badge";
import {
  Button,
} from "@/components/ui/button";
import {
  Skeleton,
} from "@/components/ui/skeleton";
import {
  getProjects,
} from "@/lib/projects";
import {
  getTeams,
} from "@/lib/teams";
import {
  formatStatusLabel,
  getLifecycleBadgeVariant,
  shortId,
} from "@/lib/task-presentation";
import {
  cancelRun,
  getRun,
  getRuns,
  getTasks,
  retryRun,
  skipRun,
} from "@/lib/workflows";

const activeRunStatuses =
  new Set<
    Run["status"]
  >([
    "pending",
    "running",
  ]);

type RunDetailErrorState = {
  runId: string;
  message: string;
};

/**
 * Converts an unknown request failure into a stable Tasks-page message.
 */
function getErrorMessage(
  error: unknown,
  fallback: string,
): string {
  return error instanceof
    Error
    ? error.message
    : fallback;
}

/**
 * Orders related Runs newest first independently of API list ordering.
 */
function compareRunsNewestFirst(
  left: Run,
  right: Run,
): number {
  const difference =
    new Date(
      right.createdAt,
    ).getTime() -
    new Date(
      left.createdAt,
    ).getTime();

  if (
    difference !==
    0
  ) {
    return difference;
  }

  return right.id.localeCompare(
    left.id,
  );
}

/**
 * Owns Tasks page data and workflow actions while delegating collection and
 * detail presentation to focused components.
 */
export function TasksManager() {
  const [
    projects,
    setProjects,
  ] =
    useState<Project[]>(
      [],
    );

  const [
    tasks,
    setTasks,
  ] =
    useState<Task[]>(
      [],
    );

  const [
    runs,
    setRuns,
  ] =
    useState<Run[]>(
      [],
    );

  const [
    selectedTaskId,
    setSelectedTaskId,
  ] =
    useState<
      string | null
    >(null);

  const [
    detailOpen,
    setDetailOpen,
  ] =
    useState(false);

  const [
    query,
    setQuery,
  ] =
    useState("");

  const [
    createOpen,
    setCreateOpen,
  ] =
    useState(false);

  const [
    loading,
    setLoading,
  ] =
    useState(true);

  const [
    isRefreshing,
    setIsRefreshing,
  ] =
    useState(false);

  const [
    workError,
    setWorkError,
  ] =
    useState<
      string | null
    >(null);

  const [
    projectError,
    setProjectError,
  ] =
    useState<
      string | null
    >(null);

  const [
    busyRunId,
    setBusyRunId,
  ] =
    useState<
      string | null
    >(null);

  const [
    latestRunDetail,
    setLatestRunDetail,
  ] =
    useState<
      RunDetail | null
    >(null);

  const [
    runDetailErrorState,
    setRunDetailErrorState,
  ] =
    useState<
      RunDetailErrorState | null
    >(null);

  const [
    automationTeams,
    setAutomationTeams,
  ] =
    useState<Team[]>(
      [],
    );

  /**
   * Loads filesystem-backed Project metadata without allowing discovery failure
   * to hide persisted Task history.
   */
  const loadProjects =
    useCallback(
      async () => {
        try {
          const result =
            await getProjects();

          setProjects(
            result.projects,
          );

          setProjectError(
            result.error,
          );
        } catch (
          error
        ) {
          setProjectError(
            getErrorMessage(
              error,
              "Unable to load discovered projects",
            ),
          );
        }
      },
      [],
    );

  /**
   * Loads authoritative Task and Run history and preserves an existing detail
   * selection only while that Task still exists.
   */
  const loadWork =
    useCallback(
      async () => {
        try {
          const [
            nextTasks,
            nextRuns,
          ] =
            await Promise.all(
              [
                getTasks(),
                getRuns(),
              ],
            );

          setTasks(
            nextTasks,
          );

          setRuns(
            nextRuns,
          );

          setWorkError(
            null,
          );

          setSelectedTaskId(
            (
              current,
            ) => {
              if (
                current &&
                nextTasks.some(
                  (
                    task,
                  ) =>
                    task.id ===
                    current,
                )
              ) {
                return current;
              }

              return null;
            },
          );
        } catch (
          error
        ) {
          setWorkError(
            getErrorMessage(
              error,
              "Unable to load tasks and runs",
            ),
          );
        }
      },
      [],
    );

  /** Loads Teams for Task ownership presentation and manual selection. */
  const loadAutomation =
    useCallback(
      async () => {
        try {
          const teams = await getTeams();

          setAutomationTeams(
            teams,
          );

        } catch {
          setAutomationTeams([]);
        }
      },
      [],
    );

  useEffect(
    () => {
      let cancelled =
        false;

      /**
       * Loads all initial Tasks page data before clearing the page-level loading
       * state.
       */
      async function initialize(): Promise<void> {
        await Promise.all(
          [
            loadProjects(),
            loadWork(),
            loadAutomation(),
          ],
        );

        if (
          !cancelled
        ) {
          setLoading(
            false,
          );
        }
      }

      void initialize();

      return () => {
        cancelled =
          true;
      };
    },
    [
      loadAutomation,
      loadProjects,
      loadWork,
    ],
  );

  const activeRun =
    useMemo(
      () =>
        runs.find(
          (
            run,
          ) =>
            activeRunStatuses.has(
              run.status,
            ),
        ) ??
        null,
      [
        runs,
      ],
    );

  const selectedTask =
    useMemo(
      () =>
        tasks.find(
          (
            task,
          ) =>
            task.id ===
            selectedTaskId,
        ) ??
        null,
      [
        tasks,
        selectedTaskId,
      ],
    );

  const selectedProject =
    useMemo(
      () =>
        selectedTask
          ? projects.find(
              (
                project,
              ) =>
                project.path ===
                selectedTask.projectPath,
            ) ??
            null
          : null,
      [
        projects,
        selectedTask,
      ],
    );

  const selectedRuns =
    useMemo(
      () =>
        selectedTask
          ? runs
              .filter(
                (
                  run,
                ) =>
                  run.taskId ===
                  selectedTask.id,
              )
              .slice()
              .sort(
                compareRunsNewestFirst,
              )
          : [],
      [
        runs,
        selectedTask,
      ],
    );

  const latestRun =
    selectedRuns[0] ??
    null;

  const latestRunId =
    latestRun?.id ??
    null;

  const latestRunStatus =
    latestRun?.status ??
    null;

  const visibleRunDetail =
    latestRunDetail
      ?.run.id ===
    latestRunId
      ? latestRunDetail
      : null;

  const runDetailError =
    runDetailErrorState
      ?.runId ===
    latestRunId
      ? runDetailErrorState.message
      : null;

  const runDetailLoading =
    detailOpen &&
    Boolean(
      latestRunId,
    ) &&
    !visibleRunDetail &&
    !runDetailError;

  useEffect(
    () => {
      if (
        !detailOpen ||
        !latestRunId ||
        !latestRunStatus
      ) {
        return;
      }

      let cancelled =
        false;

      /**
       * Loads and polls deep Run detail only while the selected Task drawer is
       * open, then merges authoritative state back into page summaries.
       */
      async function loadSelectedRunDetail(): Promise<void> {
        try {
          const detail =
            await getRun(
              latestRunId,
            );

          if (
            cancelled
          ) {
            return;
          }

          setLatestRunDetail(
            detail,
          );

          setRunDetailErrorState(
            null,
          );

          setRuns(
            (
              current,
            ) =>
              current.map(
                (
                  run,
                ) =>
                  run.id ===
                  detail.run.id
                    ? detail.run
                    : run,
              ),
          );

          if (
            detail.task
          ) {
            setTasks(
              (
                current,
              ) =>
                current.map(
                  (
                    task,
                  ) =>
                    task.id ===
                    detail.task!.id
                      ? detail.task!
                      : task,
                ),
            );
          }
        } catch (
          error
        ) {
          if (
            !cancelled
          ) {
            setRunDetailErrorState(
              {
                runId:
                  latestRunId,
                message:
                  getErrorMessage(
                    error,
                    "Unable to load the latest run",
                  ),
              },
            );
          }
        }
      }

      void loadSelectedRunDetail();

      if (
        !activeRunStatuses.has(
          latestRunStatus,
        )
      ) {
        return () => {
          cancelled =
            true;
        };
      }

      const timer =
        window.setInterval(
          () => {
            void loadSelectedRunDetail();
          },
          2_000,
        );

      return () => {
        cancelled =
          true;

        window.clearInterval(
          timer,
        );
      };
    },
    [
      detailOpen,
      latestRunId,
      latestRunStatus,
    ],
  );

  /**
   * Refreshes all page-level Project, Task, Run, and Auto Mode data.
   */
  async function refreshAll(): Promise<void> {
    setIsRefreshing(
      true,
    );

    try {
      await Promise.all(
        [
          loadProjects(),
          loadWork(),
          loadAutomation(),
        ],
      );
    } finally {
      setIsRefreshing(
        false,
      );
    }
  }

  /**
   * Inserts a newly created immediate-start Task and Run into local state and
   * opens its detail drawer before normal reconciliation.
   */
  function handleCreated(
    created:
      TaskWithRun,
  ): void {
    setTasks(
      (
        current,
      ) => [
        created.task,
        ...current.filter(
          (
            task,
          ) =>
            task.id !==
            created.task.id,
        ),
      ],
    );

    setRuns(
      (
        current,
      ) => [
        created.run,
        ...current.filter(
          (
            run,
          ) =>
            run.id !==
            created.run.id,
        ),
      ],
    );

    setSelectedTaskId(
      created.task.id,
    );

    setDetailOpen(
      true,
    );

    setWorkError(
      null,
    );

    void loadWork();
  }

  /**
   * Opens the existing Task detail and observability experience for one
   * collection item.
   */
  function handleViewTask(
    taskId: string,
  ): void {
    setSelectedTaskId(
      taskId,
    );

    setLatestRunDetail(
      null,
    );

    setRunDetailErrorState(
      null,
    );

    setDetailOpen(
      true,
    );
  }

  /**
   * Cancels an active related Run after explicit operator confirmation and
   * reloads authoritative workflow state.
   */
  async function cancelRelatedRun(
    runId: string,
  ): Promise<void> {
    if (
      !window.confirm(
        "Cancel this active workflow?",
      )
    ) {
      return;
    }

    setBusyRunId(
      runId,
    );

    try {
      await cancelRun(
        runId,
      );

      await loadWork();
    } catch (
      error
    ) {
      setWorkError(
        getErrorMessage(
          error,
          "Unable to cancel run",
        ),
      );
    } finally {
      setBusyRunId(
        null,
      );
    }
  }

  /**
   * Skips one active Notion Auto Mode Run and reloads workflow state after the
   * scheduler is signalled.
   */
  async function skipRelatedRun(
    runId: string,
  ): Promise<void> {
    if (
      !window.confirm(
        "Skip this Notion task and continue to the next Ready task?",
      )
    ) {
      return;
    }

    setBusyRunId(
      runId,
    );

    try {
      await skipRun(
        runId,
      );

      await loadWork();
    } catch (
      error
    ) {
      setWorkError(
        getErrorMessage(
          error,
          "Unable to skip run",
        ),
      );
    } finally {
      setBusyRunId(
        null,
      );
    }
  }

  /**
   * Retries the final execution only for backend-supported failed or blocked
   * Runs and reloads authoritative workflow state.
   */
  async function retryRelatedRun(
    runId: string,
  ): Promise<void> {
    setBusyRunId(
      runId,
    );

    try {
      await retryRun(
        runId,
      );

      await loadWork();
    } catch (
      error
    ) {
      setWorkError(
        getErrorMessage(
          error,
          "Unable to retry run",
        ),
      );
    } finally {
      setBusyRunId(
        null,
      );
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-text-primary">
            Tasks
          </h1>

          <p className="mt-1 text-sm text-text-muted">
            Track and manage recent orchestrated work.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {activeRun ? (
            <Button
              variant="outline"
              size="sm"
              render={
                <Link
                  href={`/runs/${activeRun.id}`}
                />
              }
            >
              <PlayIcon
                aria-hidden="true"
              />

              <span className="font-mono">
                Run{" "}
                {shortId(
                  activeRun.id,
                )}
              </span>

              <Badge
                variant={getLifecycleBadgeVariant(
                  activeRun.status,
                )}
              >
                {formatStatusLabel(
                  activeRun.status,
                )}
              </Badge>
            </Button>
          ) : null}

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              void refreshAll()
            }
            disabled={
              loading ||
              isRefreshing
            }
          >
            <RefreshCwIcon
              className={
                isRefreshing
                  ? "animate-spin motion-reduce:animate-none"
                  : undefined
              }
              aria-hidden="true"
            />

            Refresh
          </Button>

          <Button
            type="button"
            size="sm"
            onClick={() =>
              setCreateOpen(
                true,
              )
            }
          >
            <PlusIcon
              aria-hidden="true"
            />

            New Task
          </Button>
        </div>
      </header>

      {workError ? (
        <div
          role="alert"
          className="rounded-lg border border-status-error/30 bg-status-error/10 px-3 py-2 text-sm text-status-error"
        >
          {
            workError
          }
        </div>
      ) : null}

      {loading &&
      tasks.length ===
        0 ? (
        <section
          className="space-y-3"
          aria-label="Loading tasks"
        >
          <div className="neon-surface flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border-default bg-surface-elevated p-3 shadow-xs">
            <Skeleton className="h-8 w-full max-w-md" />

            <div className="flex gap-2">
              <Skeleton className="h-8 w-48" />

              <Skeleton className="h-8 w-28" />
            </div>
          </div>

          <div className="neon-table-surface overflow-hidden rounded-lg border bg-surface-elevated">
            {Array.from(
              {
                length:
                  7,
              },
            ).map(
              (
                _,
                index,
              ) => (
                <div
                  key={
                    index
                  }
                  className="grid grid-cols-[2fr_2.5fr_0.8fr_0.5fr] gap-4 border-b border-divider p-4 last:border-b-0"
                >
                  <Skeleton className="h-9 w-full" />
                  <Skeleton className="h-5 w-full" />
                  <Skeleton className="h-5 w-20" />
                  <Skeleton className="ms-auto h-7 w-16" />
                </div>
              ),
            )}
          </div>
        </section>
      ) : (
        <TaskQueue
          tasks={
            tasks
          }
          runs={
            runs
          }
          teams={
            automationTeams
          }
          query={
            query
          }
          busyRunId={
            busyRunId
          }
          onQueryChange={
            setQuery
          }
          onViewTask={
            handleViewTask
          }
          onCancelRun={
            cancelRelatedRun
          }
          onSkipRun={
            skipRelatedRun
          }
          onRetryRun={
            retryRelatedRun
          }
        />
      )}

      <TaskDetailDrawer
        open={
          detailOpen &&
          selectedTask !==
            null
        }
        onOpenChange={
          setDetailOpen
        }
        task={
          selectedTask
        }
        project={
          selectedProject
        }
        runs={
          selectedRuns
        }
        latestRunDetail={
          visibleRunDetail
        }
        runDetailLoading={
          runDetailLoading
        }
        runDetailError={
          runDetailError
        }
        busyRunId={
          busyRunId
        }
        onCancelRun={
          cancelRelatedRun
        }
        onSkipRun={
          skipRelatedRun
        }
        onRetryRun={
          retryRelatedRun
        }
      />

      <TaskCreateDrawer
        open={
          createOpen
        }
        onOpenChange={
          setCreateOpen
        }
        projects={
          projects
        }
        projectError={
          projectError
        }
        activeRun={
          activeRun
        }
        onCreated={
          handleCreated
        }
      />
    </div>
  );
}
