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
  TeamAutomationStatus,
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
  Switch,
} from "@/components/ui/switch";
import {
  getProjects,
} from "@/lib/projects";
import {
  getTeams,
  updateTeam,
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
  getTeamAutomationStatuses,
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
 * Converts backend automation state into the compact operator-facing label.
 */
function formatAutomationState(
  state:
    TeamAutomationStatus["state"],
): string {
  if (
    state ===
    "waiting_approval"
  ) {
    return "Waiting approval";
  }

  if (
    state ===
    "cooldown"
  ) {
    return "Cooldown";
  }

  if (
    state ===
    "running"
  ) {
    return "Running";
  }

  if (
    state ===
    "ready"
  ) {
    return "Ready";
  }

  if (
    state ===
    "unavailable"
  ) {
    return "Unavailable";
  }

  return "Off";
}

/**
 * Converts a server-owned Team configuration failure into concise operator
 * text.
 */
function formatAutomationUnavailableReason(
  reason:
    TeamAutomationStatus["unavailableReason"],
): string | null {
  if (
    reason ===
    "team_disabled"
  ) {
    return "Team disabled";
  }

  if (
    reason ===
    "missing_notion_data_source"
  ) {
    return "Missing Notion database";
  }

  if (
    reason ===
    "missing_notion_api_key"
  ) {
    return "Notion integration unavailable";
  }

  if (
    reason ===
    "no_enabled_agents"
  ) {
    return "No enabled Agents";
  }

  return null;
}

/**
 * Maps backend automation state onto existing semantic Badge variants.
 */
function getAutomationBadgeVariant(
  state:
    TeamAutomationStatus["state"],
):
  | "running"
  | "success"
  | "warning"
  | "neutral" {
  if (
    state ===
    "running"
  ) {
    return "running";
  }

  if (
    state ===
    "ready"
  ) {
    return "success";
  }

  if (
    state ===
      "waiting_approval" ||
    state ===
      "cooldown" ||
    state ===
      "unavailable"
  ) {
    return "warning";
  }

  return "neutral";
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

  const [
    automationStatuses,
    setAutomationStatuses,
  ] =
    useState<
      TeamAutomationStatus[]
    >([]);

  const [
    automationLoading,
    setAutomationLoading,
  ] =
    useState(true);

  const [
    automationUpdatingTeamId,
    setAutomationUpdatingTeamId,
  ] =
    useState<
      string | null
    >(null);

  const [
    automationError,
    setAutomationError,
  ] =
    useState<
      string | null
    >(null);

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

  /**
   * Loads Team configuration and server-derived automation state without
   * duplicating scheduler eligibility rules in the browser.
   */
  const loadAutomation =
    useCallback(
      async () => {
        try {
          const [
            teams,
            statuses,
          ] =
            await Promise.all(
              [
                getTeams(),
                getTeamAutomationStatuses(),
              ],
            );

          setAutomationTeams(
            teams,
          );

          setAutomationStatuses(
            statuses,
          );

          setAutomationError(
            null,
          );
        } catch (
          error
        ) {
          setAutomationError(
            getErrorMessage(
              error,
              "Unable to load Auto Mode status",
            ),
          );
        } finally {
          setAutomationLoading(
            false,
          );
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

  useEffect(
    () => {
      const timer =
        window.setInterval(
          () => {
            void loadAutomation();
          },
          5_000,
        );

      return () => {
        window.clearInterval(
          timer,
        );
      };
    },
    [
      loadAutomation,
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

  const automationStatusByTeamId =
    useMemo(
      () =>
        new Map(
          automationStatuses.map(
            (
              status,
            ) => [
              status.teamId,
              status,
            ],
          ),
        ),
      [
        automationStatuses,
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
   * Persists one Team's Auto Mode intent and reloads server-owned automation
   * gates and workflow state.
   */
  async function handleAutoModeChange(
    team: Team,
    checked: boolean,
  ): Promise<void> {
    setAutomationUpdatingTeamId(
      team.id,
    );

    setAutomationError(
      null,
    );

    try {
      const updatedTeam =
        await updateTeam(
          team.id,
          {
            autoModeEnabled:
              checked,
          },
        );

      setAutomationTeams(
        (
          current,
        ) =>
          current.map(
            (
              currentTeam,
            ) =>
              currentTeam.id ===
              updatedTeam.id
                ? updatedTeam
                : currentTeam,
          ),
      );

      await Promise.all(
        [
          loadAutomation(),
          loadWork(),
        ],
      );
    } catch (
      error
    ) {
      setAutomationError(
        getErrorMessage(
          error,
          "Unable to update Auto Mode",
        ),
      );
    } finally {
      setAutomationUpdatingTeamId(
        null,
      );
    }
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

      <section
        className="neon-surface flex flex-wrap items-center gap-2 rounded-lg border border-border-default bg-surface-elevated px-3 py-2 shadow-xs"
        aria-label="Team Auto Mode"
      >
        <span className="me-1 text-sm font-medium text-text-primary">
          Auto Mode
        </span>

        {automationTeams.map(
          (
            team,
          ) => {
            const status =
              automationStatusByTeamId.get(
                team.id,
              );

            const detail =
              status
                ?.blockedByActiveRun
                ? "Waiting for active run"
                : formatAutomationUnavailableReason(
                    status
                      ?.unavailableReason ??
                      null,
                  );

            return (
              <div
                key={
                  team.id
                }
                className="flex min-w-0 items-center gap-1.5 border-l border-divider pl-2 first:border-l-0 first:pl-0"
              >
                <span className="max-w-32 truncate text-xs font-medium text-text-secondary">
                  {
                    team.name
                  }
                </span>

                <Badge
                  variant={getAutomationBadgeVariant(
                    status
                      ?.state ??
                      "off",
                  )}
                >
                  {formatAutomationState(
                    status
                      ?.state ??
                      "off",
                  )}
                </Badge>

                {detail ? (
                  <span
                    className="hidden max-w-44 truncate text-xs text-text-muted xl:inline"
                    title={
                      detail
                    }
                  >
                    {
                      detail
                    }
                  </span>
                ) : null}

                <Switch
                  size="sm"
                  checked={
                    team.autoModeEnabled
                  }
                  onCheckedChange={(
                    checked,
                  ) => {
                    void handleAutoModeChange(
                      team,
                      checked,
                    );
                  }}
                  disabled={
                    automationLoading ||
                    automationUpdatingTeamId ===
                      team.id
                  }
                  aria-label={`Toggle ${team.name} Auto Mode`}
                />
              </div>
            );
          },
        )}

        {automationLoading &&
        automationTeams.length ===
          0 ? (
          <span className="text-xs text-text-muted">
            Loading Team automation...
          </span>
        ) : null}
      </section>

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

      {automationError ? (
        <div
          role="alert"
          className="rounded-lg border border-status-error/30 bg-status-error/10 px-3 py-2 text-sm text-status-error"
        >
          {
            automationError
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
