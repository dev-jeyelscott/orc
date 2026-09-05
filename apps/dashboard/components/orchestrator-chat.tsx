"use client";

import type {
  Conversation,
  ConversationMessage,
  OrchestratorSettings,
  Project,
  RunDetail,
  Team,
} from "@orc/shared";
import {
  AlertTriangleIcon,
  BotIcon,
  LoaderCircleIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import type {
  FormEvent,
} from "react";

import { OrchestratorContextStrip } from "@/components/orchestrator-context-strip";
import { OrchestratorConversation } from "@/components/orchestrator-conversation";
import { OrchestratorInspector } from "@/components/orchestrator-inspector";
import { OrchestratorInspectorDrawer } from "@/components/orchestrator-inspector-drawer";
import { OrchestratorWorkbench } from "@/components/orchestrator-workbench";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
  createConversation,
  getConversation,
  getOrchestratorSettings,
  listConversations,
  postMessage,
  resetOrchestratorSettings,
  updateOrchestratorSettings,
} from "@/lib/conversations";
import {
  isRunActive,
  selectActiveExecution,
  selectLatestResultExecution,
  selectTerminalExecution,
} from "@/lib/orchestrator-presentation";
import {
  getProjects,
} from "@/lib/projects";
import {
  getTeams,
} from "@/lib/teams";
import {
  cancelRun,
  getRun,
  retryRun,
} from "@/lib/workflows";

type BusyAction =
  | "loading"
  | "project"
  | "team"
  | "conversation"
  | "new-conversation"
  | "send"
  | "start-task"
  | "explain-status"
  | "stop"
  | "retry"
  | null;

const DESKTOP_WORKSPACE_QUERY =
  "(min-width: 1280px)";

/**
 * Normalizes an unknown failure into a concise operator-facing error message.
 */
function errorMessage(
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
 * Subscribes to the responsive breakpoint used by the desktop inspector and workbench.
 */
function subscribeDesktopWorkspace(
  callback:
    () => void,
): () => void {
  const query =
    window.matchMedia(
      DESKTOP_WORKSPACE_QUERY,
    );

  query.addEventListener(
    "change",
    callback,
  );

  return () => {
    query.removeEventListener(
      "change",
      callback,
    );
  };
}

/**
 * Returns whether the current browser viewport uses the desktop operator workspace.
 */
function getDesktopWorkspaceSnapshot(): boolean {
  return window.matchMedia(
    DESKTOP_WORKSPACE_QUERY,
  ).matches;
}

/**
 * Provides a stable server snapshot until the client viewport becomes available.
 */
function getDesktopWorkspaceServerSnapshot(): boolean {
  return false;
}

/**
 * Returns the current responsive workspace mode without duplicating state in an effect.
 */
function useDesktopWorkspace(): boolean {
  return useSyncExternalStore(
    subscribeDesktopWorkspace,
    getDesktopWorkspaceSnapshot,
    getDesktopWorkspaceServerSnapshot,
  );
}

/**
 * Coordinates Team-scoped persisted Conversations, workflow actions, observability, and result selection.
 */
export function OrchestratorChat() {
  const [
    projects,
    setProjects,
  ] =
    useState<Project[]>(
      [],
    );

  const [
    teams,
    setTeams,
  ] =
    useState<Team[]>(
      [],
    );

  const [
    workspaceError,
    setWorkspaceError,
  ] =
    useState<
      string | null
    >(null);

  const [
    projectPath,
    setProjectPath,
  ] =
    useState("");

  const [
    teamId,
    setTeamId,
  ] =
    useState("");

  const [
    conversations,
    setConversations,
  ] =
    useState<
      Conversation[]
    >([]);

  const [
    conversation,
    setConversation,
  ] =
    useState<
      Conversation | null
    >(null);

  const [
    messages,
    setMessages,
  ] =
    useState<
      ConversationMessage[]
    >([]);

  const [
    content,
    setContent,
  ] =
    useState("");

  const [
    runDetail,
    setRunDetail,
  ] =
    useState<
      RunDetail | null
    >(null);

  const [
    runError,
    setRunError,
  ] =
    useState<
      string | null
    >(null);

  const [
    settings,
    setSettings,
  ] =
    useState<
      OrchestratorSettings | null
    >(null);

  const [
    settingsError,
    setSettingsError,
  ] =
    useState<
      string | null
    >(null);

  const [
    settingsSaving,
    setSettingsSaving,
  ] =
    useState(
      false,
    );

  const [
    error,
    setError,
  ] =
    useState<
      string | null
    >(null);

  const [
    busyAction,
    setBusyAction,
  ] =
    useState<BusyAction>(
      "loading",
    );

  const [
    pendingMessage,
    setPendingMessage,
  ] =
    useState<{
      content:
        string;
      createdAt:
        string;
    } | null>(
      null,
    );

  const [
    now,
    setNow,
  ] =
    useState(
      () =>
        Date.now(),
    );

  const desktopWorkspace =
    useDesktopWorkspace();

  const linkedRunId =
    conversation?.runId ??
    null;

  const linkedRunStatus =
    linkedRunId &&
    runDetail?.run.id ===
      linkedRunId
      ? runDetail.run.status
      : null;

  /**
   * Clears the active Conversation and Run workspace before another Project and Team scope is loaded.
   */
  const clearConversationWorkspace =
    useCallback(
      (): void => {
        setConversations([]);
        setConversation(null);
        setMessages([]);
        setRunDetail(null);
        setRunError(null);
        setContent("");
      },
      [],
    );

  /**
   * Loads persisted Conversations for one explicit Project and Team scope and opens its newest Conversation.
   */
  const loadScope =
    useCallback(
      async (
        nextProjectPath:
          string,
        nextTeamId:
          string,
        action:
          | "project"
          | "team",
      ): Promise<void> => {
        setBusyAction(
          action,
        );

        setError(
          null,
        );

        setProjectPath(
          nextProjectPath,
        );

        setTeamId(
          nextTeamId,
        );

        clearConversationWorkspace();

        if (
          !nextProjectPath ||
          !nextTeamId
        ) {
          setBusyAction(
            null,
          );

          return;
        }

        try {
          const response =
            await listConversations(
              nextProjectPath,
              nextTeamId,
            );

          setConversations(
            response.conversations,
          );

          const first =
            response.conversations.at(
              0,
            );

          if (!first) {
            return;
          }

          const detail =
            await getConversation(
              first.id,
            );

          if (
            detail.conversation
              .projectPath !==
                nextProjectPath ||
            detail.conversation
              .teamId !==
                nextTeamId
          ) {
            throw new Error(
              "Conversation scope does not match the selected Project and Team.",
            );
          }

          setConversation(
            detail.conversation,
          );

          setMessages(
            detail.messages,
          );
        } catch (
          value
        ) {
          clearConversationWorkspace();

          setError(
            errorMessage(
              value,
              "Failed to load conversations.",
            ),
          );
        } finally {
          setBusyAction(
            null,
          );
        }
      },
      [
        clearConversationWorkspace,
      ],
    );

  useEffect(
    () => {
      let disposed =
        false;

      /**
       * Loads filesystem-backed Projects and configured Teams without choosing a Team implicitly.
       */
      const initialize =
        async (): Promise<void> => {
          setBusyAction(
            "loading",
          );

          try {
            const [
              projectResponse,
              nextTeams,
            ] =
              await Promise.all([
                getProjects(),
                getTeams(),
              ]);

            if (disposed) {
              return;
            }

            setProjects(
              projectResponse.projects,
            );

            setTeams(
              nextTeams,
            );

            setWorkspaceError(
              projectResponse.error,
            );

            const firstProject =
              projectResponse.projects.at(
                0,
              );

            if (!firstProject) {
              setProjectPath("");
              setTeamId("");
              clearConversationWorkspace();
              setBusyAction(null);

              return;
            }

            setProjectPath(
              firstProject.path,
            );

            setTeamId("");

            clearConversationWorkspace();

            setBusyAction(
              null,
            );
          } catch (
            value
          ) {
            if (disposed) {
              return;
            }

            setError(
              errorMessage(
                value,
                "Failed to load Orchestrator workspace.",
              ),
            );

            setBusyAction(
              null,
            );
          }
        };

      void initialize();

      return () => {
        disposed =
          true;
      };
    },
    [
      clearConversationWorkspace,
    ],
  );

  useEffect(
    () => {
      let disposed =
        false;

      /**
       * Loads separately persisted supervisor configuration without treating it as worker execution data.
       */
      const loadSettings =
        async (): Promise<void> => {
          try {
            const value =
              await getOrchestratorSettings();

            if (!disposed) {
              setSettings(
                value,
              );

              setSettingsError(
                null,
              );
            }
          } catch (
            value
          ) {
            if (!disposed) {
              setSettings(
                null,
              );

              setSettingsError(
                errorMessage(
                  value,
                  "Orchestrator settings are unavailable.",
                ),
              );
            }
          }
        };

      void loadSettings();

      return () => {
        disposed =
          true;
      };
    },
    [],
  );

  useEffect(
    () => {
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
    },
    [],
  );

  useEffect(
    () => {
      if (!linkedRunId) {
        return;
      }

      let disposed =
        false;

      /**
       * Refreshes authoritative Run detail used by every Orchestrator observability panel.
       */
      const refresh =
        async (): Promise<void> => {
          try {
            const detail =
              await getRun(
                linkedRunId,
              );

            if (!disposed) {
              setRunDetail(
                detail,
              );

              setRunError(
                null,
              );
            }
          } catch (
            value
          ) {
            if (!disposed) {
              setRunError(
                errorMessage(
                  value,
                  "Run state is unavailable.",
                ),
              );
            }
          }
        };

      void refresh();

      const shouldPoll =
        linkedRunStatus ===
          null ||
        isRunActive(
          linkedRunStatus,
        );

      const timer =
        shouldPoll
          ? window.setInterval(
              () => {
                void refresh();
              },
              2_500,
            )
          : undefined;

      return () => {
        disposed =
          true;

        if (timer) {
          window.clearInterval(
            timer,
          );
        }
      };
    },
    [
      linkedRunId,
      linkedRunStatus,
    ],
  );

  /**
   * Refreshes one persisted Conversation and verifies it still belongs to the currently selected scope.
   */
  const refreshConversation =
    async (
      conversationId:
        string,
    ): Promise<Conversation> => {
      const detail =
        await getConversation(
          conversationId,
        );

      if (
        detail.conversation
          .projectPath !==
            projectPath ||
        detail.conversation
          .teamId !==
            teamId
      ) {
        throw new Error(
          "Conversation scope does not match the selected Project and Team.",
        );
      }

      setConversation(
        detail.conversation,
      );

      setMessages(
        detail.messages,
      );

      setRunDetail(
        (current) =>
          current?.run.id ===
          detail.conversation
            .runId
            ? current
            : null,
      );

      return detail.conversation;
    };

  /**
   * Refreshes the Team-scoped Conversation chooser after message activity changes persisted ordering.
   */
  const refreshConversationList =
    async (): Promise<void> => {
      if (
        !projectPath ||
        !teamId
      ) {
        return;
      }

      const response =
        await listConversations(
          projectPath,
          teamId,
        );

      setConversations(
        response.conversations,
      );
    };

  /**
   * Persists an operator-edited Orchestrator configuration and replaces local state with the validated response.
   */
  const handleSaveSettings =
    async (
      nextSettings:
        OrchestratorSettings,
    ): Promise<void> => {
      setSettingsSaving(
        true,
      );

      setSettingsError(
        null,
      );

      try {
        const saved =
          await updateOrchestratorSettings(
            nextSettings,
          );

        setSettings(
          saved,
        );
      } catch (
        value
      ) {
        setSettingsError(
          errorMessage(
            value,
            "Failed to save Orchestrator settings.",
          ),
        );
      } finally {
        setSettingsSaving(
          false,
        );
      }
    };

  /**
   * Restores the Orchestrator configuration through the server-owned defaults endpoint.
   */
  const handleResetSettings =
    async (): Promise<void> => {
      setSettingsSaving(
        true,
      );

      setSettingsError(
        null,
      );

      try {
        const reset =
          await resetOrchestratorSettings();

        setSettings(
          reset,
        );
      } catch (
        value
      ) {
        setSettingsError(
          errorMessage(
            value,
            "Failed to reset Orchestrator settings.",
          ),
        );
      } finally {
        setSettingsSaving(
          false,
        );
      }
    };

  /**
   * Opens one explicitly selected persisted Conversation inside the current Project and Team scope.
   */
  const handleConversationChange =
    async (
      conversationId:
        string,
    ): Promise<void> => {
      if (
        !conversationId ||
        busyAction !==
          null
      ) {
        return;
      }

      setBusyAction(
        "conversation",
      );

      setError(
        null,
      );

      setRunDetail(
        null,
      );

      setRunError(
        null,
      );

      try {
        await refreshConversation(
          conversationId,
        );
      } catch (
        value
      ) {
        setError(
          errorMessage(
            value,
            "Failed to open conversation.",
          ),
        );
      } finally {
        setBusyAction(
          null,
        );
      }
    };

  /**
   * Creates a new Conversation for the currently selected Project and Team.
   */
  const handleNewConversation =
    async (): Promise<void> => {
      if (
        !projectPath ||
        !teamId ||
        busyAction !==
          null
      ) {
        return;
      }

      setBusyAction(
        "new-conversation",
      );

      setError(
        null,
      );

      try {
        const created =
          await createConversation(
            projectPath,
            teamId,
          );

        setConversation(
          created,
        );

        setMessages([]);
        setRunDetail(null);
        setRunError(null);
        setContent("");

        const response =
          await listConversations(
            projectPath,
            teamId,
          );

        setConversations(
          response.conversations,
        );
      } catch (
        value
      ) {
        setError(
          errorMessage(
            value,
            "Failed to create conversation.",
          ),
        );
      } finally {
        setBusyAction(
          null,
        );
      }
    };

  /**
   * Sends one supervisor instruction and then reloads authoritative persisted transcript state.
   */
  const sendSupervisorMessage =
    async (
      message:
        string,
      action:
        Exclude<
          BusyAction,
          | "loading"
          | "project"
          | "team"
          | "conversation"
          | "new-conversation"
          | "stop"
          | "retry"
          | null
        >,
      clearDraft:
        boolean,
    ): Promise<void> => {
      const trimmed =
        message.trim();

      if (
        !conversation ||
        !trimmed ||
        busyAction !==
          null
      ) {
        return;
      }

      const conversationId =
        conversation.id;

      setPendingMessage({
        content:
          trimmed,
        createdAt:
          new Date().toISOString(),
      });

      if (clearDraft) {
        setContent("");
      }

      setBusyAction(
        action,
      );

      setError(
        null,
      );

      try {
        await postMessage(
          conversationId,
          trimmed,
        );

        await refreshConversation(
          conversationId,
        );

        try {
          await refreshConversationList();
        } catch {
          // The active persisted Conversation remains authoritative if chooser refresh fails.
        }
      } catch (
        value
      ) {
        setError(
          errorMessage(
            value,
            "The Orchestrator request failed.",
          ),
        );

        try {
          await refreshConversation(
            conversationId,
          );
        } catch {
          // Preserve the original mutation failure if transcript recovery also fails.
        }
      } finally {
        setBusyAction(
          null,
        );

        setPendingMessage(
          null,
        );
      }
    };

  /**
   * Handles the normal composer Send action.
   */
  const handleSubmit =
    (
      event:
        FormEvent<HTMLFormElement>,
    ): void => {
      event.preventDefault();

      void sendSupervisorMessage(
        content,
        "send",
        true,
      );
    };

  /**
   * Explicitly asks the supervisor to create and start the engineering Task represented by the current draft.
   */
  const handleStartTask =
    (): void => {
      if (!content.trim()) {
        return;
      }

      void sendSupervisorMessage(
        `Start this engineering task now:\n\n${content.trim()}`,
        "start-task",
        true,
      );
    };

  /**
   * Requests a grounded supervisor explanation of the current linked Run.
   */
  const handleExplainStatus =
    (): void => {
      void sendSupervisorMessage(
        "Explain the current run status using only persisted and live system state.",
        "explain-status",
        false,
      );
    };

  /**
   * Cancels the linked active Run through the existing workflow control API.
   */
  const handleStop =
    async (): Promise<void> => {
      const runId =
        conversation?.runId;

      if (
        !runId ||
        busyAction !==
          null ||
        !runDetail ||
        !isRunActive(
          runDetail.run.status,
        )
      ) {
        return;
      }

      setBusyAction(
        "stop",
      );

      setError(
        null,
      );

      try {
        await cancelRun(
          runId,
        );

        setRunDetail(
          await getRun(
            runId,
          ),
        );

        setRunError(
          null,
        );
      } catch (
        value
      ) {
        setError(
          errorMessage(
            value,
            "Failed to stop the run.",
          ),
        );
      } finally {
        setBusyAction(
          null,
        );
      }
    };

  /**
   * Retries only the backend-supported final execution of a failed or blocked Run.
   */
  const handleRetry =
    async (): Promise<void> => {
      const runId =
        conversation?.runId;

      if (
        !runId ||
        busyAction !==
          null
      ) {
        return;
      }

      setBusyAction(
        "retry",
      );

      setError(
        null,
      );

      try {
        await retryRun(
          runId,
        );

        setRunDetail(
          await getRun(
            runId,
          ),
        );

        setRunError(
          null,
        );
      } catch (
        value
      ) {
        setError(
          errorMessage(
            value,
            "Failed to retry the execution.",
          ),
        );
      } finally {
        setBusyAction(
          null,
        );
      }
    };

  const activeExecution =
    selectActiveExecution(
      runDetail,
    );

  const terminalExecution =
    selectTerminalExecution(
      runDetail,
    );

  const resultExecution =
    selectLatestResultExecution(
      runDetail,
    );

  const switchingWorkspace =
    busyAction ===
      "loading" ||
    busyAction ===
      "project" ||
    busyAction ===
      "team" ||
    busyAction ===
      "conversation";

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      <OrchestratorContextStrip
        projects={
          projects
        }
        projectPath={
          projectPath
        }
        teams={
          teams
        }
        teamId={
          teamId
        }
        conversations={
          conversations
        }
        conversation={
          conversation
        }
        runDetail={
          runDetail
        }
        activeExecution={
          activeExecution
        }
        busyAction={
          busyAction
        }
        now={
          now
        }
        onProjectChange={(
          value,
        ) => {
          if (
            busyAction ===
            null
          ) {
            void loadScope(
              value,
              teamId,
              "project",
            );
          }
        }}
        onTeamChange={(
          value,
        ) => {
          if (
            busyAction ===
            null
          ) {
            void loadScope(
              projectPath,
              value,
              "team",
            );
          }
        }}
        onConversationChange={(
          value,
        ) => {
          void handleConversationChange(
            value,
          );
        }}
        onNewConversation={() => {
          void handleNewConversation();
        }}
        onStop={() => {
          void handleStop();
        }}
        onRetry={() => {
          void handleRetry();
        }}
      />

      {workspaceError ? (
        <div
          role="status"
          className="shrink-0 rounded-md border border-status-warning/30 bg-status-warning/5 px-3 py-2 text-xs text-status-warning"
        >
          {workspaceError}
        </div>
      ) : null}

      {error ? (
        <div
          role="alert"
          className="flex shrink-0 items-start gap-2 rounded-md border border-status-error/30 bg-status-error/5 px-3 py-2 text-xs text-status-error"
        >
          <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />

          <span>
            {error}
          </span>
        </div>
      ) : null}

      {switchingWorkspace ? (
        <Card className="min-h-0 flex-1">
          <CardContent className="flex min-h-72 flex-1 items-center justify-center p-6 text-center">
            <div>
              <LoaderCircleIcon className="mx-auto size-6 animate-spin text-brand-accent" />

              <p className="mt-3 text-xs text-text-muted">
                Loading Orchestrator workspace...
              </p>
            </div>
          </CardContent>
        </Card>
      ) : projects.length ===
        0 ? (
        <Card className="min-h-0 flex-1">
          <CardContent className="flex min-h-72 flex-1 items-center justify-center p-6 text-center">
            <div className="max-w-sm">
              <BotIcon className="mx-auto size-8 text-text-muted" />

              <h2 className="mt-3 text-sm font-semibold text-text-primary">
                No project available
              </h2>

              <p className="mt-1 text-xs leading-5 text-text-muted">
                The Orchestrator requires a filesystem-discovered Git project before a conversation can be created.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : teams.length ===
        0 ? (
        <Card className="min-h-0 flex-1">
          <CardContent className="flex min-h-72 flex-1 items-center justify-center p-6 text-center">
            <div className="max-w-sm">
              <BotIcon className="mx-auto size-8 text-text-muted" />

              <h2 className="mt-3 text-sm font-semibold text-text-primary">
                No Team available
              </h2>

              <p className="mt-1 text-xs leading-5 text-text-muted">
                Configure at least one Team before creating a Team-scoped Orchestrator conversation.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : !teamId ? (
        <Card className="min-h-0 flex-1">
          <CardContent className="flex min-h-72 flex-1 items-center justify-center p-6 text-center">
            <div className="max-w-sm">
              <BotIcon className="mx-auto size-8 text-text-muted" />

              <h2 className="mt-3 text-sm font-semibold text-text-primary">
                Select a Team
              </h2>

              <p className="mt-1 text-xs leading-5 text-text-muted">
                Choose the Team that owns this conversation before opening or creating Orchestrator work.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : desktopWorkspace ? (
        <div className="min-h-0 flex-1">
          <ResizablePanelGroup
            orientation="vertical"
            className="h-full min-h-0"
          >
            <ResizablePanel
              id="orchestrator-primary"
              defaultSize="68%"
              minSize="55%"
            >
              <div className="grid h-full min-h-0 min-w-0 grid-cols-[minmax(0,2.1fr)_minmax(360px,1fr)] gap-3">
                <OrchestratorConversation
                  className="h-full min-h-0"
                  projectPath={
                    projectPath
                  }
                  conversation={
                    conversation
                  }
                  messages={
                    messages
                  }
                  content={
                    content
                  }
                  runStatus={
                    linkedRunStatus
                  }
                  busyAction={
                    busyAction
                  }
                  pendingMessage={
                    pendingMessage
                  }
                  onContentChange={
                    setContent
                  }
                  onSubmit={
                    handleSubmit
                  }
                  onStartTask={
                    handleStartTask
                  }
                  onExplainStatus={
                    handleExplainStatus
                  }
                  onNewConversation={() => {
                    void handleNewConversation();
                  }}
                />

                <OrchestratorInspector
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
                  settingsSaving={
                    settingsSaving
                  }
                  onSaveSettings={
                    handleSaveSettings
                  }
                  onResetSettings={
                    handleResetSettings
                  }
                  now={
                    now
                  }
                />
              </div>
            </ResizablePanel>

            <ResizableHandle
              withHandle
              className="my-2 shrink-0"
            />

            <ResizablePanel
              id="orchestrator-workbench"
              defaultSize="32%"
              minSize="22%"
              maxSize="45%"
            >
              <OrchestratorWorkbench
                runDetail={
                  runDetail
                }
                terminalExecution={
                  terminalExecution
                }
                resultExecution={
                  resultExecution
                }
              />
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="flex shrink-0 justify-end">
            <OrchestratorInspectorDrawer
              runDetail={
                runDetail
              }
              runError={
                runError
              }
              activeExecution={
                activeExecution
              }
              terminalExecution={
                terminalExecution
              }
              resultExecution={
                resultExecution
              }
              settings={
                settings
              }
              settingsError={
                settingsError
              }
              settingsSaving={
                settingsSaving
              }
              onSaveSettings={
                handleSaveSettings
              }
              onResetSettings={
                handleResetSettings
              }
              now={
                now
              }
            />
          </div>

          <OrchestratorConversation
            className="min-h-[680px] flex-1"
            projectPath={
              projectPath
            }
            conversation={
              conversation
            }
            messages={
              messages
            }
            content={
              content
            }
            runStatus={
              linkedRunStatus
            }
            busyAction={
              busyAction
            }
            pendingMessage={
              pendingMessage
            }
            onContentChange={
              setContent
            }
            onSubmit={
              handleSubmit
            }
            onStartTask={
              handleStartTask
            }
            onExplainStatus={
              handleExplainStatus
            }
            onNewConversation={() => {
              void handleNewConversation();
            }}
          />
        </div>
      )}
    </div>
  );
}
