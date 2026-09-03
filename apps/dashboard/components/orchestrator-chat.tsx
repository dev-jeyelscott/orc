"use client";

import Link from "next/link";
import type {
  Conversation,
  ConversationMessage,
  OrchestratorSettings,
  Project,
  RunDetail,
} from "@orc/shared";
import {
  RefreshCcwIcon,
  SquareIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";

import { OrchestratorConversation } from "@/components/orchestrator-conversation";
import {
  OrchestratorObservability,
  OrchestratorResultPreview,
  OrchestratorTerminalPanel,
} from "@/components/orchestrator-observability";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import {
  getConversation,
  getOrchestratorSettings,
  openConversation,
  postMessage,
} from "@/lib/conversations";
import {
  formatElapsedTime,
  isRunActive,
  isRunRetryable,
  selectActiveExecution,
  selectLatestResultExecution,
  selectTerminalExecution,
} from "@/lib/orchestrator-presentation";
import { getProjects } from "@/lib/projects";
import {
  compactPath,
  formatStatusLabel,
  getLifecycleBadgeVariant,
  projectNameFromPath,
  shortId,
} from "@/lib/task-presentation";
import {
  cancelRun,
  getRun,
  retryRun,
} from "@/lib/workflows";

type BusyAction =
  | "open"
  | "send"
  | "explain"
  | "stop"
  | "retry"
  | null;

interface ContextItemProps {
  label: string;
  children: React.ReactNode;
}

/** Renders one compact run-context field used by the Orchestrator command header. */
function ContextItem({
  label,
  children,
}: ContextItemProps) {
  return (
    <div className="min-w-0 border-e border-divider pe-3 last:border-e-0">
      <p className="text-[10px] text-text-muted">
        {label}
      </p>

      <div className="mt-1 min-w-0 truncate text-xs font-medium text-text-primary">
        {children}
      </div>
    </div>
  );
}

/** Renders project selection before a persistent conversation has been opened. */
function ProjectPicker({
  projects,
  projectPath,
  loading,
  busy,
  error,
  onProjectPathChange,
  onOpen,
}: {
  projects: Project[];
  projectPath: string;
  loading: boolean;
  busy: boolean;
  error: string | null;
  onProjectPathChange: (
    path: string,
  ) => void;
  onOpen: () => void;
}) {
  return (
    <Card>
      <CardContent className="flex min-h-40 items-center justify-center p-5">
        <div className="w-full max-w-xl">
          <h2 className="text-sm font-semibold text-text-primary">
            Open a project conversation
          </h2>

          <p className="mt-1 text-xs text-text-muted">
            Select a discovered Git repository to load its latest persisted Orchestrator conversation.
          </p>

          <div className="mt-4 flex gap-2">
            <select
              value={
                projectPath
              }
              disabled={
                loading ||
                busy
              }
              onChange={(event) =>
                onProjectPathChange(
                  event.target
                    .value,
                )
              }
              className="h-9 min-w-0 flex-1 rounded-md border border-border-default bg-surface-interactive px-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              <option value="">
                Select project
              </option>

              {projects.map(
                (project) => (
                  <option
                    key={
                      project.id
                    }
                    value={
                      project.path
                    }
                  >
                    {
                      project.name
                    }
                  </option>
                ),
              )}
            </select>

            <Button
              type="button"
              disabled={
                busy ||
                !projectPath
              }
              onClick={onOpen}
            >
              {busy
                ? "Opening..."
                : "Open conversation"}
            </Button>
          </div>

          {error ? (
            <p
              role="alert"
              className="mt-3 text-xs text-status-error"
            >
              {error}
            </p>
          ) : null}

          {!loading &&
          !error &&
          projects.length ===
            0 ? (
            <p className="mt-3 text-xs text-text-muted">
              No discovered Git repositories are currently available.
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

/** Renders the selected project, task, run, conversation, status, current worker, and controls. */
function ContextStrip({
  projects,
  projectPath,
  conversation,
  runDetail,
  now,
  busyAction,
  onProjectChange,
  onStop,
  onRetry,
}: {
  projects: Project[];
  projectPath: string;
  conversation: Conversation;
  runDetail: RunDetail | null;
  now: number;
  busyAction: BusyAction;
  onProjectChange: (
    path: string,
  ) => Promise<void>;
  onStop: () => void;
  onRetry: () => void;
}) {
  const activeExecution =
    selectActiveExecution(
      runDetail,
    );

  const run =
    runDetail?.run ?? null;

  const projectExists =
    projects.some(
      (project) =>
        project.path ===
        projectPath,
    );

  const elapsed =
    run
      ? formatElapsedTime(
          run.createdAt,
          isRunActive(
            run.status,
          )
            ? null
            : run.updatedAt,
          now,
        )
      : "-";

  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-lg border border-border-default bg-surface-elevated px-3 py-2 xl:flex-row xl:items-center">
      <div className="grid min-w-0 flex-1 grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-7">
        <ContextItem label="Project">
          <select
            value={
              projectPath
            }
            disabled={
              busyAction !==
              null
            }
            onChange={(event) => {
              void onProjectChange(
                event.target
                  .value,
              );
            }}
            className="w-full bg-transparent text-xs font-medium text-text-primary focus-visible:outline-none"
          >
            {!projectExists ? (
              <option
                value={
                  projectPath
                }
              >
                {projectNameFromPath(
                  projectPath,
                )}{" "}
                (unavailable)
              </option>
            ) : null}

            {projects.map(
              (project) => (
                <option
                  key={
                    project.id
                  }
                  value={
                    project.path
                  }
                >
                  {
                    project.name
                  }
                </option>
              ),
            )}
          </select>
        </ContextItem>

        <ContextItem label="Task">
          {runDetail?.task
            ?.title ??
            "-"}
        </ContextItem>

        <ContextItem label="Run ID">
          {run ? (
            <Link
              href={`/runs/${run.id}`}
              title={run.id}
              className="font-mono text-link hover:underline"
            >
              {shortId(
                run.id,
              )}
            </Link>
          ) : (
            "-"
          )}
        </ContextItem>

        <ContextItem label="Conversation ID">
          <span
            title={
              conversation.id
            }
            className="font-mono"
          >
            {shortId(
              conversation.id,
            )}
          </span>
        </ContextItem>

        <ContextItem label="Status">
          {run ? (
            <Badge
              variant={getLifecycleBadgeVariant(
                run.status,
              )}
            >
              {formatStatusLabel(
                run.status,
              )}
            </Badge>
          ) : (
            "No run"
          )}
        </ContextItem>

        <ContextItem label="Current Agent">
          {activeExecution
            ?.agentName ??
            "-"}
        </ContextItem>

        <ContextItem label="Elapsed">
          {elapsed}
        </ContextItem>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {run &&
        isRunActive(
          run.status,
        ) ? (
          <Button
            type="button"
            size="sm"
            variant="destructive"
            disabled={
              busyAction !==
              null
            }
            onClick={onStop}
          >
            <SquareIcon className="size-3.5" />
            Stop
          </Button>
        ) : null}

        {run &&
        isRunRetryable(
          run.status,
        ) ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={
              busyAction !==
              null
            }
            onClick={onRetry}
          >
            <RefreshCcwIcon className="size-3.5" />
            Retry
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** Owns persisted conversation selection, run polling, mutations, and the complete Orchestrator workspace composition. */
export function OrchestratorChat() {
  const [projects, setProjects] =
    useState<Project[]>([]);

  const [
    projectPath,
    setProjectPath,
  ] = useState("");

  const [
    projectsLoading,
    setProjectsLoading,
  ] = useState(true);

  const [
    projectError,
    setProjectError,
  ] = useState<
    string | null
  >(null);

  const [
    conversation,
    setConversation,
  ] = useState<
    Conversation | null
  >(null);

  const [
    messages,
    setMessages,
  ] = useState<
    ConversationMessage[]
  >([]);

  const [content, setContent] =
    useState("");

  const [
    conversationError,
    setConversationError,
  ] = useState<
    string | null
  >(null);

  const [
    runDetail,
    setRunDetail,
  ] = useState<
    RunDetail | null
  >(null);

  const [
    runError,
    setRunError,
  ] = useState<
    string | null
  >(null);

  const [
    settings,
    setSettings,
  ] = useState<
    OrchestratorSettings | null
  >(null);

  const [
    settingsError,
    setSettingsError,
  ] = useState<
    string | null
  >(null);

  const [
    busyAction,
    setBusyAction,
  ] = useState<BusyAction>(
    null,
  );

  const [now, setNow] =
    useState(() =>
      Date.now(),
    );

  useEffect(() => {
    let disposed = false;

    void getProjects()
      .then((value) => {
        if (disposed) {
          return;
        }

        setProjects(
          value.projects,
        );

        setProjectPath(
          (current) =>
            current ||
            value.projects[0]
              ?.path ||
            "",
        );

        setProjectError(
          value.error,
        );
      })
      .catch(
        (caught: unknown) => {
          if (disposed) {
            return;
          }

          setProjectError(
            caught instanceof
              Error
              ? caught.message
              : "Unable to load projects",
          );
        },
      )
      .finally(() => {
        if (!disposed) {
          setProjectsLoading(
            false,
          );
        }
      });

    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    let disposed = false;

    void getOrchestratorSettings()
      .then((value) => {
        if (!disposed) {
          setSettings(
            value,
          );

          setSettingsError(
            null,
          );
        }
      })
      .catch(
        (caught: unknown) => {
          if (!disposed) {
            setSettingsError(
              caught instanceof
                Error
                ? caught.message
                : "Unable to load orchestrator settings",
            );
          }
        },
      );

    return () => {
      disposed = true;
    };
  }, []);

  /** Reloads the complete authoritative run detail linked to the current conversation. */
  const refreshRun =
    useCallback(
      async (): Promise<void> => {
        const runId =
          conversation?.runId;

        if (!runId) {
          setRunDetail(
            null,
          );

          setRunError(
            null,
          );

          return;
        }

        try {
          const next =
            await getRun(
              runId,
            );

          setRunDetail(
            next,
          );

          setRunError(
            null,
          );
        } catch (caught) {
          setRunError(
            caught instanceof
              Error
              ? caught.message
              : "Unable to load run",
          );
        }
      },
      [
        conversation?.runId,
      ],
    );

  useEffect(() => {
    if (
      !conversation?.runId
    ) {
      setRunDetail(null);
      setRunError(null);
      return;
    }

    void refreshRun();

    if (
      runDetail &&
      !isRunActive(
        runDetail.run.status,
      )
    ) {
      return;
    }

    const timer =
      window.setInterval(
        () => {
          void refreshRun();
        },
        2_000,
      );

    return () => {
      window.clearInterval(
        timer,
      );
    };
  }, [
    conversation?.runId,
    refreshRun,
    runDetail?.run.status,
  ]);

  useEffect(() => {
    if (
      !runDetail ||
      !isRunActive(
        runDetail.run.status,
      )
    ) {
      return;
    }

    setNow(Date.now());

    const timer =
      window.setInterval(
        () => {
          setNow(
            Date.now(),
          );
        },
        1_000,
      );

    return () => {
      window.clearInterval(
        timer,
      );
    };
  }, [
    runDetail?.run.status,
  ]);

  /** Opens the most recent persisted conversation for one selected project. */
  async function openProjectConversation(
    path: string,
  ): Promise<void> {
    if (
      !path ||
      busyAction !== null
    ) {
      return;
    }

    setBusyAction(
      "open",
    );

    setConversationError(
      null,
    );

    setConversation(
      null,
    );

    setMessages([]);

    setRunDetail(null);
    setRunError(null);

    try {
      const opened =
        await openConversation(
          path,
        );

      const detail =
        await getConversation(
          opened.id,
        );

      setProjectPath(path);

      setConversation(
        detail.conversation,
      );

      setMessages(
        detail.messages,
      );
    } catch (caught) {
      setConversationError(
        caught instanceof Error
          ? caught.message
          : "Unable to open conversation",
      );
    } finally {
      setBusyAction(
        null,
      );
    }
  }

  /** Persists one supervisor message and reloads authoritative conversation linkage/history. */
  async function sendConversationMessage(
    message: string,
    action: "send" | "explain",
  ): Promise<boolean> {
    const trimmed =
      message.trim();

    if (
      !conversation ||
      !trimmed ||
      busyAction !== null
    ) {
      return false;
    }

    setBusyAction(
      action,
    );

    setConversationError(
      null,
    );

    try {
      await postMessage(
        conversation.id,
        trimmed,
      );

      const detail =
        await getConversation(
          conversation.id,
        );

      setConversation(
        detail.conversation,
      );

      setMessages(
        detail.messages,
      );

      return true;
    } catch (caught) {
      setConversationError(
        caught instanceof Error
          ? caught.message
          : "Unable to send message",
      );

      return false;
    } finally {
      setBusyAction(
        null,
      );
    }
  }

  /** Submits the current composer content as a normal persisted user message. */
  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();

    const sent =
      await sendConversationMessage(
        content,
        "send",
      );

    if (sent) {
      setContent("");
    }
  }

  /** Asks the supervisor to explain current status using the backend-provided persisted run context. */
  function handleExplainStatus(): void {
    void sendConversationMessage(
      "Explain the current run status using only the persisted and live system state available to you.",
      "explain",
    );
  }

  /** Cancels only a currently active run after explicit operator confirmation. */
  async function handleStop(): Promise<void> {
    const run =
      runDetail?.run;

    if (
      !run ||
      !isRunActive(
        run.status,
      ) ||
      busyAction !== null
    ) {
      return;
    }

    if (
      !window.confirm(
        "Stop this active run?",
      )
    ) {
      return;
    }

    setBusyAction(
      "stop",
    );

    try {
      await cancelRun(
        run.id,
      );

      await refreshRun();

      setConversationError(
        null,
      );
    } catch (caught) {
      setConversationError(
        caught instanceof Error
          ? caught.message
          : "Unable to stop run",
      );
    } finally {
      setBusyAction(
        null,
      );
    }
  }

  /** Retries the backend-supported final execution of a failed or blocked run. */
  async function handleRetry(): Promise<void> {
    const run =
      runDetail?.run;

    if (
      !run ||
      !isRunRetryable(
        run.status,
      ) ||
      busyAction !== null
    ) {
      return;
    }

    setBusyAction(
      "retry",
    );

    try {
      await retryRun(
        run.id,
      );

      await refreshRun();

      setConversationError(
        null,
      );
    } catch (caught) {
      setConversationError(
        caught instanceof Error
          ? caught.message
          : "Unable to retry run",
      );
    } finally {
      setBusyAction(
        null,
      );
    }
  }

  /** Switches project context and opens that project's most recent persisted conversation. */
  async function handleProjectChange(
    path: string,
  ): Promise<void> {
    if (
      !path ||
      path ===
        conversation
          ?.projectPath
    ) {
      return;
    }

    await openProjectConversation(
      path,
    );
  }

  const activeExecution =
    useMemo(
      () =>
        selectActiveExecution(
          runDetail,
        ),
      [runDetail],
    );

  const terminalExecution =
    useMemo(
      () =>
        selectTerminalExecution(
          runDetail,
        ),
      [runDetail],
    );

  const resultExecution =
    useMemo(
      () =>
        selectLatestResultExecution(
          runDetail,
        ),
      [runDetail],
    );

  if (!conversation) {
    return (
      <ProjectPicker
        projects={projects}
        projectPath={
          projectPath
        }
        loading={
          projectsLoading
        }
        busy={
          busyAction ===
          "open"
        }
        error={
          conversationError ??
          projectError
        }
        onProjectPathChange={
          setProjectPath
        }
        onOpen={() => {
          void openProjectConversation(
            projectPath,
          );
        }}
      />
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <ContextStrip
        projects={projects}
        projectPath={
          conversation.projectPath
        }
        conversation={
          conversation
        }
        runDetail={
          runDetail
        }
        now={now}
        busyAction={
          busyAction
        }
        onProjectChange={
          handleProjectChange
        }
        onStop={() => {
          void handleStop();
        }}
        onRetry={() => {
          void handleRetry();
        }}
      />

      {conversationError ? (
        <div
          role="alert"
          className="rounded-md border border-status-error/30 bg-status-error/5 px-3 py-2 text-xs text-status-error"
        >
          {
            conversationError
          }
        </div>
      ) : null}

      <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,0.86fr)_minmax(0,1.14fr)]">
        <OrchestratorConversation
          projects={projects}
          projectPath={
            conversation.projectPath
          }
          conversation={
            conversation
          }
          messages={
            messages
          }
          content={content}
          runStatus={
            runDetail?.run
              .status ??
            null
          }
          busyAction={
            busyAction
          }
          onProjectChange={
            handleProjectChange
          }
          onContentChange={
            setContent
          }
          onSubmit={(event) => {
            void handleSubmit(
              event,
            );
          }}
          onExplainStatus={
            handleExplainStatus
          }
          onStop={() => {
            void handleStop();
          }}
          onRetry={() => {
            void handleRetry();
          }}
        />

        <OrchestratorObservability
          runDetail={
            runDetail
          }
          runError={
            runError
          }
          activeExecution={
            activeExecution
          }
          settings={
            settings
          }
          settingsError={
            settingsError
          }
          now={now}
        />
      </div>

      <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,0.86fr)_minmax(0,1.14fr)]">
        <OrchestratorTerminalPanel
          execution={
            terminalExecution
          }
        />

        <OrchestratorResultPreview
          execution={
            resultExecution
          }
        />
      </div>

      <p className="sr-only">
        Active project:{" "}
        {projectNameFromPath(
          conversation.projectPath,
        )}. Path:{" "}
        {compactPath(
          conversation.projectPath,
        )}.
      </p>
    </div>
  );
}
