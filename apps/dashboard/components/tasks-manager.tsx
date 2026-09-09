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
  TaskDetailPanel,
} from "@/components/task-detail-panel";
import {
  TaskObservabilityPanel,
} from "@/components/task-observability-panel";
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
  Spinner,
} from "@/components/ui/spinner";
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
  retryRun,
  getTeamAutomationStatuses,
} from "@/lib/workflows";

const activeRunStatuses =
  new Set<
    Run["status"]
  >([
    "pending",
    "running",
  ]);

type RunDetailErrorState = {
  runId:
    string;
  message:
    string;
};

/**
 * Converts an unknown request failure into a stable Tasks-page message.
 */
function getErrorMessage(
  error:
    unknown,
  fallback:
    string,
): string {
  return error instanceof Error
    ? error.message
    : fallback;
}

/**
 * Orders related runs newest first even if a future API stops returning them in creation order.
 */
function compareRunsNewestFirst(
  left:
    Run,
  right:
    Run,
): number {
  return (
    new Date(
      right.createdAt,
    ).getTime() -
    new Date(
      left.createdAt,
    ).getTime()
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
 * Converts a server-owned Team configuration failure into concise operator text.
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
 * Maps backend automation state onto the existing semantic badge variants.
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
    state === "cooldown" ||
    state === "unavailable"
  ) {
    return "warning";
  }

  return "neutral";
}

/**
 * Owns Tasks command-center state while delegating queue, detail, drawer, and observability rendering.
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
    useState<string | null>(
      null,
    );

  const [
    query,
    setQuery,
  ] =
    useState(
      "",
    );

  const [
    createOpen,
    setCreateOpen,
  ] =
    useState(
      false,
    );

  const [
    loading,
    setLoading,
  ] =
    useState(
      true,
    );

  const [
    isRefreshing,
    setIsRefreshing,
  ] =
    useState(
      false,
    );

  const [
    workError,
    setWorkError,
  ] =
    useState<string | null>(
      null,
    );

  const [
    projectError,
    setProjectError,
  ] =
    useState<string | null>(
      null,
    );

  const [
    busyRunId,
    setBusyRunId,
  ] =
    useState<string | null>(
      null,
    );

  const [
    latestRunDetail,
    setLatestRunDetail,
  ] =
    useState<RunDetail | null>(
      null,
    );

  const [
    runDetailErrorState,
    setRunDetailErrorState,
  ] =
    useState<RunDetailErrorState | null>(
      null,
    );

  const [
    automationTeams,
    setAutomationTeams,
  ] =
    useState<Team[]>([]);

  const [
    automationStatuses,
    setAutomationStatuses,
  ] =
    useState<TeamAutomationStatus[]>([]);

  const [
    automationLoading,
    setAutomationLoading,
  ] =
    useState(
      true,
    );

  const [
    automationUpdatingTeamId,
    setAutomationUpdatingTeamId,
  ] =
    useState<string | null>(
      null,
    );

  const [
    automationError,
    setAutomationError,
  ] =
    useState<string | null>(
      null,
    );

  /**
   * Loads filesystem-backed project metadata without making project discovery failure hide task history.
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
        } catch (error) {
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
   * Loads task and run lists together because queue selection and related-run resolution depend on both collections.
   */
  const loadWork =
    useCallback(
      async () => {
        try {
          const [
            nextTasks,
            nextRuns,
          ] =
            await Promise.all([
              getTasks(),
              getRuns(),
            ]);

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
            (current) => {
              if (
                current &&
                nextTasks.some(
                  (task) =>
                    task.id ===
                    current,
                )
              ) {
                return current;
              }

              const activeRun =
                nextRuns.find(
                  (run) =>
                    activeRunStatuses.has(
                      run.status,
                    ),
                );

              const runningTask =
                nextTasks.find(
                  (task) =>
                    task.status ===
                    "running",
                );

              return (
                activeRun?.taskId ??
                runningTask?.id ??
                nextTasks[0]
                  ?.id ??
                null
              );
            },
          );
        } catch (error) {
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
   * Loads Team configuration and server-derived automation status without duplicating scheduler gates in the browser.
   */
  const loadAutomation =
    useCallback(
      async () => {
        try {
          const [
            teams,
            statuses,
          ] =
            await Promise.all([
              getTeams(),
              getTeamAutomationStatuses(),
            ]);

          setAutomationTeams(
            teams,
          );

          setAutomationStatuses(
            statuses,
          );

          setAutomationError(
            null,
          );
        } catch (error) {
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
       * Loads the initial project, task, run, and Auto Mode state before clearing page-level loading.
       */
      async function initialize() {
        await Promise.all([
          loadProjects(),
          loadWork(),
          loadAutomation(),
        ]);

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
          (run) =>
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
            (status) => [
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
          (task) =>
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
          ? (
              projects.find(
                (project) =>
                  project.path ===
                  selectedTask.projectPath,
              ) ??
              null
            )
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
                (run) =>
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
    latestRunDetail?.run
      .id === latestRunId
      ? latestRunDetail
      : null;

  const runDetailError =
    runDetailErrorState
      ?.runId ===
    latestRunId
      ? runDetailErrorState
          .message
      : null;

  const runDetailLoading =
    Boolean(
      latestRunId,
    ) &&
    !visibleRunDetail &&
    !runDetailError;

  useEffect(
    () => {
      if (
        !latestRunId ||
        !latestRunStatus
      ) {
        return;
      }

      let cancelled =
        false;

      /**
       * Refreshes only the selected task's latest run and merges authoritative state back into page-level summaries.
       */
      async function loadSelectedRunDetail() {
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
            (current) =>
              current.map(
                (run) =>
                  run.id ===
                  detail.run.id
                    ? detail.run
                    : run,
              ),
          );

          const refreshedTask =
            detail.task;

          if (
            refreshedTask
          ) {
            setTasks(
              (current) =>
                current.map(
                  (task) =>
                    task.id ===
                    refreshedTask.id
                      ? refreshedTask
                      : task,
                ),
            );
          }
        } catch (error) {
          if (
            !cancelled
          ) {
            setRunDetailErrorState({
              runId:
                latestRunId,
              message:
                getErrorMessage(
                  error,
                  "Unable to load the latest run",
                ),
            });
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
      latestRunId,
      latestRunStatus,
    ],
  );

  /**
   * Refreshes all page-level data while selected-run polling remains responsible for deep observability.
   */
  async function refreshAll() {
    setIsRefreshing(
      true,
    );

    try {
      await Promise.all([
        loadProjects(),
        loadWork(),
        loadAutomation(),
      ]);
    } finally {
      setIsRefreshing(
        false,
      );
    }
  }

  /**
   * Adds the newly created immediate-start manual task to local state before background reconciliation.
   */
  function handleCreated(
    created:
      TaskWithRun,
  ) {
    setTasks(
      (current) => [
        created.task,
        ...current.filter(
          (task) =>
            task.id !==
            created.task.id,
        ),
      ],
    );

    setRuns(
      (current) => [
        created.run,
        ...current.filter(
          (run) =>
            run.id !==
            created.run.id,
        ),
      ],
    );

    setSelectedTaskId(
      created.task.id,
    );

    setWorkError(
      null,
    );

    void loadWork();
  }

  /**
   * Persists one Team's automation intent through Team CRUD, then reloads the server-owned gates and workflow state.
   */
  async function handleAutoModeChange(
    team:
      Team,
    checked:
      boolean,
  ) {
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
        (current) =>
          current.map(
            (currentTeam) =>
              currentTeam.id ===
              updatedTeam.id
                ? updatedTeam
                : currentTeam,
          ),
      );

      await Promise.all([
        loadAutomation(),
        loadWork(),
      ]);
    } catch (error) {
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
   * Cancels an active related run after explicit operator confirmation and refreshes authoritative task and run state.
   */
  async function cancelRelatedRun(
    runId:
      string,
  ) {
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
    } catch (error) {
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
   * Retries the final execution only for backend-supported failed or blocked runs.
   */
  async function retryRelatedRun(
    runId:
      string,
  ) {
    setBusyRunId(
      runId,
    );

    try {
      await retryRun(
        runId,
      );

      await loadWork();
    } catch (error) {
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
            Start and monitor orchestrated work across discovered repositories.
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
              <PlayIcon />

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

          <div className="neon-surface flex flex-wrap items-center gap-2 rounded-lg border border-border-default bg-surface-elevated px-3 py-2 shadow-xs">
            <span className="text-sm font-medium text-text-primary">
              Auto Mode
            </span>

            {automationTeams.map(
              (team) => {
                const status =
                  automationStatusByTeamId.get(
                    team.id,
                  );

                const detail =
                  status?.blockedByActiveRun
                    ? "Waiting for active run"
                    : formatAutomationUnavailableReason(
                        status?.unavailableReason ??
                          null,
                      );

                return (
                  <div
                    key={team.id}
                    className="flex items-center gap-1.5 border-l border-divider pl-2 first:border-l-0 first:pl-0"
                  >
                    <span className="max-w-28 truncate text-xs font-medium text-text-secondary">
                      {team.name}
                    </span>

                    <Badge
                      variant={getAutomationBadgeVariant(
                        status?.state ??
                          "off",
                      )}
                    >
                      {formatAutomationState(
                        status?.state ??
                          "off",
                      )}
                    </Badge>

                    {detail ? (
                      <span className="max-w-40 truncate text-xs text-text-muted">
                        {detail}
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
          </div>

          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void refreshAll();
            }}
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
            onClick={() => {
              setCreateOpen(
                true,
              );
            }}
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
          {workError}
        </div>
      ) : null}

      {automationError ? (
        <div
          role="alert"
          className="rounded-lg border border-status-error/30 bg-status-error/10 px-3 py-2 text-sm text-status-error"
        >
          {automationError}
        </div>
      ) : null}

      {loading &&
      tasks.length ===
        0 ? (
        <section className="neon-surface flex min-h-[34rem] items-center justify-center rounded-lg border border-border-default bg-surface-elevated shadow-xs">
          <div className="flex items-center gap-2 text-sm text-text-muted">
            <Spinner className="size-4" />

            Loading tasks and runs...
          </div>
        </section>
      ) : (
        <div className="grid min-w-0 gap-3 lg:grid-cols-[18rem_minmax(0,1fr)] 2xl:grid-cols-[19rem_minmax(32rem,1.35fr)_minmax(30rem,1fr)]">
          <TaskQueue
            tasks={
              tasks
            }
            runs={
              runs
            }
            selectedTaskId={
              selectedTaskId
            }
            query={
              query
            }
            onQueryChange={
              setQuery
            }
            onSelect={
              setSelectedTaskId
            }
          />

          <TaskDetailPanel
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
            onRetryRun={
              retryRelatedRun
            }
          />

          <div className="min-w-0 lg:col-span-2 2xl:col-span-1">
            <TaskObservabilityPanel
              latestRunId={
                latestRunId
              }
              detail={
                visibleRunDetail
              }
              loading={
                runDetailLoading
              }
              error={
                runDetailError
              }
            />
          </div>
        </div>
      )}

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
