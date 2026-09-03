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
  createTask,
} from "@/lib/workflows";

const drawerStyle = {
  "--drawer-content-width":
    "min(34rem, 94vw)",
} as CSSProperties;

type TaskCreateDrawerProps = {
  open: boolean;
  onOpenChange:
    (open: boolean) => void;
  projects: Project[];
  projectError:
    string | null;
  activeRun: Run | null;
  onCreated:
    (
      created: TaskWithRun,
    ) => Promise<void> | void;
};

/** Converts an unknown task-creation failure into a concise operator-facing message. */
function getErrorMessage(
  error: unknown,
): string {
  return error instanceof Error
    ? error.message
    : "Unable to start task";
}

/** Renders the controlled non-modal task creation drawer using the existing Base UI-backed shadcn primitive. */
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
  ] = useState("");

  const [
    title,
    setTitle,
  ] = useState("");

  const [
    instruction,
    setInstruction,
  ] = useState("");

  const [
    error,
    setError,
  ] =
    useState<string | null>(
      null,
    );

  const [
    submitting,
    setSubmitting,
  ] = useState(false);

  useEffect(() => {
    setProjectId(
      (current) => {
        if (
          projects.some(
            (project) =>
              project.id ===
              current,
          )
        ) {
          return current;
        }

        return (
          projects[0]?.id ?? ""
        );
      },
    );
  }, [projects]);

  const formComplete =
    projectId.length > 0 &&
    title.trim().length > 0 &&
    instruction
      .trim()
      .length > 0;

  const startDisabled =
    submitting ||
    Boolean(activeRun) ||
    projects.length === 0 ||
    !formComplete;

  /** Clears editable task content while retaining the valid selected repository. */
  function clearDraft() {
    setTitle("");
    setInstruction("");
    setError(null);
  }

  /** Validates the draft, creates the immediate-start task, and returns the new task/run to the page owner. */
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
        "Project, title, and instructions are required.",
      );
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const created =
        await createTask({
          projectId,
          title:
            title.trim(),
          instruction:
            instruction.trim(),
        });

      await onCreated(
        created,
      );

      clearDraft();
      onOpenChange(false);
    } catch (caught) {
      setError(
        getErrorMessage(
          caught,
        ),
      );
    } finally {
      setSubmitting(false);
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
        style={drawerStyle}
      >
        <form
          onSubmit={submit}
          className="flex min-h-0 flex-1 flex-col"
        >
          <DrawerHeader className="border-b border-divider p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <DrawerTitle>
                  Create Task
                </DrawerTitle>

                <DrawerDescription>
                  Tasks start
                  immediately against
                  the selected
                  discovered
                  repository using the
                  current enabled-agent
                  workflow.
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
                        Another
                        workflow is
                        active
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
                        . Keep this
                        draft open and
                        refresh after
                        that run
                        finishes, or
                        cancel the
                        active run
                        first.
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

              <label
                className="grid gap-1.5 text-sm"
                htmlFor="task-project"
              >
                <span className="font-medium text-text-secondary">
                  Project
                </span>

                <Select
                  value={
                    projectId ||
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
                    aria-invalid={
                      projectId.length ===
                        0 &&
                      projects.length >
                        0
                    }
                  >
                    <SelectValue placeholder="Select a discovered repository" />
                  </SelectTrigger>

                  <SelectContent
                    align="start"
                    alignItemWithTrigger={
                      false
                    }
                  >
                    {projects.map(
                      (project) => (
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
                              {
                                project.name
                              }
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

                {projects.length ===
                0 ? (
                  <span className="text-xs text-text-muted">
                    No discovered Git
                    repositories are
                    currently
                    available.
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
                (title.length ===
                  0 &&
                  instruction.length ===
                    0)
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
