"use client";

import {
  AlertTriangleIcon,
  PlayIcon,
  RotateCcwIcon,
  XIcon,
} from "lucide-react";
import {
  useEffect,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import type {
  Project,
  Run,
  TaskWithRun,
  Team,
} from "@orc/shared";

import {
  Button,
  buttonVariants,
} from "@/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
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
import {
  Textarea,
} from "@/components/ui/textarea";
import {
  compactPath,
  shortId,
} from "@/lib/task-presentation";
import {
  getTeams,
} from "@/lib/teams";
import {
  createTask,
} from "@/lib/workflows";

const drawerStyle = {
  "--drawer-content-width":
    "min(34rem, 94vw)",
} as CSSProperties;

type TaskCreateDrawerProps = {
  open:
    boolean;
  onOpenChange:
    (open: boolean) => void;
  projects:
    Project[];
  projectError:
    string | null;
  activeRun:
    Run | null;
  onCreated:
    (
      created:
        TaskWithRun,
    ) => Promise<void> | void;
};

/**
 * Converts an unknown Task creation failure into a concise operator-facing message.
 */
function getErrorMessage(
  error:
    unknown,
): string {
  return error instanceof Error
    ? error.message
    : "Unable to start task";
}

/**
 * Renders the controlled non-modal Task creation drawer and requires an explicit runnable Team.
 */
export function TaskCreateDrawer({
  open,
  onOpenChange,
  projects,
  projectError,
  activeRun,
  onCreated,
}: TaskCreateDrawerProps) {
  const [
    projectId,
    setProjectId,
  ] =
    useState("");

  const [
    teams,
    setTeams,
  ] =
    useState<Team[]>(
      [],
    );

  const [
    teamId,
    setTeamId,
  ] =
    useState("");

  const [
    teamsLoading,
    setTeamsLoading,
  ] =
    useState(false);

  const [
    teamError,
    setTeamError,
  ] =
    useState<
      string | null
    >(null);

  const [
    title,
    setTitle,
  ] =
    useState("");

  const [
    instruction,
    setInstruction,
  ] =
    useState("");

  const [
    error,
    setError,
  ] =
    useState<
      string | null
    >(null);

  const [
    submitting,
    setSubmitting,
  ] =
    useState(false);

  useEffect(
    () => {
      if (!open) {
        return;
      }

      let disposed =
        false;

      /**
       * Reloads Team configuration whenever the Task drawer opens so disabled state is not stale.
       */
      async function loadTeams(): Promise<void> {
        setTeamsLoading(
          true,
        );

        setTeamError(
          null,
        );

        try {
          const nextTeams =
            await getTeams();

          if (disposed) {
            return;
          }

          setTeams(
            nextTeams,
          );

          setTeamId(
            (current) =>
              nextTeams.some(
                (team) =>
                  team.id ===
                    current &&
                  team.enabled,
              )
                ? current
                : "",
          );
        } catch (
          caught
        ) {
          if (disposed) {
            return;
          }

          setTeams([]);

          setTeamId("");

          setTeamError(
            getErrorMessage(
              caught,
            ),
          );
        } finally {
          if (!disposed) {
            setTeamsLoading(
              false,
            );
          }
        }
      }

      void loadTeams();

      return () => {
        disposed =
          true;
      };
    },
    [
      open,
    ],
  );

  const selectedProjectId =
    projects.some(
      (project) =>
        project.id ===
        projectId,
    )
      ? projectId
      : projects[0]?.id ??
        "";

  const selectedProject =
    projects.find(
      (project) =>
        project.id ===
        selectedProjectId,
    );

  const selectedTeam =
    teams.find(
      (team) =>
        team.id ===
        teamId,
    ) ?? null;

  const formComplete =
    selectedProjectId.length >
      0 &&
    Boolean(
      selectedTeam
        ?.enabled,
    ) &&
    title.trim().length >
      0 &&
    instruction
      .trim()
      .length >
      0;

  const startDisabled =
    submitting ||
    teamsLoading ||
    Boolean(
      activeRun,
    ) ||
    projects.length ===
      0 ||
    !formComplete;

  /**
   * Clears editable Task content while retaining valid Project and Team selections.
   */
  function clearDraft() {
    setTitle("");
    setInstruction("");
    setError(null);
  }

  /**
   * Validates Project and Team scope, creates the immediate-start Task, and returns the new Task and Run.
   */
  async function submit(
    event:
      FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (activeRun) {
      setError(
        "Another workflow is already active. Finish or cancel it before starting a new task.",
      );

      return;
    }

    if (!formComplete) {
      setError(
        "Project, Team, title, and instructions are required.",
      );

      return;
    }

    setSubmitting(
      true,
    );

    setError(
      null,
    );

    try {
      const created =
        await createTask({
          projectId:
            selectedProjectId,
          teamId:
            selectedTeam!.id,
          title:
            title.trim(),
          instruction:
            instruction.trim(),
        });

      await onCreated(
        created,
      );

      clearDraft();

      onOpenChange(
        false,
      );
    } catch (
      caught
    ) {
      setError(
        getErrorMessage(
          caught,
        ),
      );
    } finally {
      setSubmitting(
        false,
      );
    }
  }

  return (
    <Drawer
      open={open}
      onOpenChange={
        onOpenChange
      }
      modal={false}
      disablePointerDismissal
      swipeDirection="right"
    >
      <DrawerContent
        style={
          drawerStyle
        }
      >
        <form
          onSubmit={
            submit
          }
          className="flex min-h-0 flex-1 flex-col"
        >
          <DrawerHeader className="border-b border-divider p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <DrawerTitle>
                  Create Task
                </DrawerTitle>

                <DrawerDescription>
                  Tasks start immediately against the selected repository using only enabled agents from the selected Team.
                </DrawerDescription>
              </div>

              <DrawerClose
                type="button"
                className={buttonVariants(
                  {
                    variant:
                      "ghost",
                    size:
                      "icon-sm",
                  },
                )}
                disabled={
                  submitting
                }
                aria-label="Close create task drawer"
              >
                <XIcon />
              </DrawerClose>
            </div>
          </DrawerHeader>

          <div className="flex-1 overflow-y-auto p-4">
            <div className="grid gap-5">
              {activeRun ? (
                <div
                  role="status"
                  className="rounded-lg border border-status-warning/30 bg-status-warning/5 p-3 text-sm text-status-warning"
                >
                  <div className="flex gap-2">
                    <AlertTriangleIcon
                      className="mt-0.5 size-4 shrink-0"
                      aria-hidden="true"
                    />

                    <div>
                      <p className="font-medium">
                        Another workflow is active
                      </p>

                      <p className="mt-1 text-xs leading-relaxed text-text-muted">
                        Run{" "}
                        <span className="font-mono text-text-secondary">
                          {shortId(
                            activeRun.id,
                          )}
                        </span>{" "}
                        is active in{" "}
                        {compactPath(
                          activeRun.projectPath,
                        )}
                        . The global one-active-run limit applies across all Teams.
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}

              {projectError ? (
                <div
                  role="alert"
                  className="rounded-lg border border-status-warning/30 bg-status-warning/5 p-3 text-sm text-status-warning"
                >
                  {projectError}
                </div>
              ) : null}

              {teamError ? (
                <div
                  role="alert"
                  className="rounded-lg border border-status-warning/30 bg-status-warning/5 p-3 text-sm text-status-warning"
                >
                  {teamError}
                </div>
              ) : null}

              <label
                className="grid gap-1.5 text-sm"
                htmlFor="task-project"
              >
                <span className="font-medium text-text-secondary">
                  Project
                </span>

                <Select
                  value={
                    selectedProjectId ||
                    null
                  }
                  onValueChange={(
                    value,
                  ) =>
                    setProjectId(
                      value ?? "",
                    )
                  }
                >
                  <SelectTrigger
                    id="task-project"
                    className="w-full"
                    disabled={
                      projects.length ===
                        0 ||
                      submitting
                    }
                  >
                    {selectedProject ? (
                      selectedProject.name
                    ) : (
                      <SelectValue placeholder="Select a discovered repository" />
                    )}
                  </SelectTrigger>

                  <SelectContent
                    align="start"
                    alignItemWithTrigger={
                      false
                    }
                  >
                    {projects.map(
                      (
                        project,
                      ) => (
                        <SelectItem
                          key={
                            project.id
                          }
                          value={
                            project.id
                          }
                        >
                          <span className="flex min-w-0 flex-col">
                            <span>
                              {project.name}
                            </span>

                            <span className="truncate font-mono text-[11px] text-text-muted">
                              {compactPath(
                                project.path,
                              )}
                            </span>
                          </span>
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
              </label>

              <label
                className="grid gap-1.5 text-sm"
                htmlFor="task-team"
              >
                <span className="font-medium text-text-secondary">
                  Team
                </span>

                <Select
                  value={
                    teamId ||
                    null
                  }
                  onValueChange={(
                    value,
                  ) =>
                    setTeamId(
                      value ?? "",
                    )
                  }
                >
                  <SelectTrigger
                    id="task-team"
                    className="w-full"
                    disabled={
                      teamsLoading ||
                      teams.length ===
                        0 ||
                      submitting
                    }
                  >
                    {selectedTeam ? (
                      selectedTeam.name
                    ) : (
                      <SelectValue placeholder="Select a Team" />
                    )}
                  </SelectTrigger>

                  <SelectContent
                    align="start"
                    alignItemWithTrigger={
                      false
                    }
                  >
                    {teams.map(
                      (
                        team,
                      ) => (
                        <SelectItem
                          key={
                            team.id
                          }
                          value={
                            team.id
                          }
                          disabled={
                            !team.enabled
                          }
                        >
                          {team.name}
                          {!team.enabled
                            ? " (disabled)"
                            : ""}
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>

                {teamsLoading ? (
                  <span className="text-xs text-text-muted">
                    Loading Teams...
                  </span>
                ) : null}

                {!teamsLoading &&
                teams.length ===
                  0 &&
                !teamError ? (
                  <span className="text-xs text-text-muted">
                    No Teams are configured.
                  </span>
                ) : null}
              </label>

              <label
                className="grid gap-1.5 text-sm"
                htmlFor="task-title"
              >
                <span className="font-medium text-text-secondary">
                  Title
                </span>

                <Input
                  id="task-title"
                  value={title}
                  onChange={(
                    event,
                  ) =>
                    setTitle(
                      event.target
                        .value,
                    )
                  }
                  required
                  maxLength={200}
                  disabled={
                    submitting
                  }
                  placeholder="Implement checkout retry flow"
                  autoComplete="off"
                />

                <span className="text-xs text-text-muted">
                  {title.length}/200
                </span>
              </label>

              <label
                className="grid gap-1.5 text-sm"
                htmlFor="task-instruction"
              >
                <span className="font-medium text-text-secondary">
                  Instructions
                </span>

                <Textarea
                  id="task-instruction"
                  value={
                    instruction
                  }
                  onChange={(
                    event,
                  ) =>
                    setInstruction(
                      event.target
                        .value,
                    )
                  }
                  required
                  maxLength={
                    20_000
                  }
                  disabled={
                    submitting
                  }
                  className="min-h-52 resize-y font-mono text-xs leading-relaxed"
                  placeholder="Describe the engineering task, constraints, and expected validation."
                />

                <span className="text-xs text-text-muted">
                  {instruction.length.toLocaleString()}
                  /20,000
                </span>
              </label>

              {error ? (
                <p
                  role="alert"
                  className="rounded-lg border border-status-error/30 bg-status-error/10 p-3 text-sm text-status-error"
                >
                  {error}
                </p>
              ) : null}
            </div>
          </div>

          <DrawerFooter className="border-t border-divider p-4 sm:flex-row sm:items-center sm:justify-end">
            <Button
              type="button"
              variant="ghost"
              onClick={
                clearDraft
              }
              disabled={
                submitting ||
                (
                  title.length ===
                    0 &&
                  instruction.length ===
                    0
                )
              }
            >
              <RotateCcwIcon />
              Clear
            </Button>

            <DrawerClose
              type="button"
              className={buttonVariants(
                {
                  variant:
                    "outline",
                },
              )}
              disabled={
                submitting
              }
            >
              Cancel
            </DrawerClose>

            <Button
              type="submit"
              disabled={
                startDisabled
              }
            >
              <PlayIcon />
              {submitting
                ? "Starting..."
                : "Start Task"}
            </Button>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
