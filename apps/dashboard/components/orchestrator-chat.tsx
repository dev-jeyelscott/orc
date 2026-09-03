"use client";

import {
  useEffect,
  useState,
  type FormEvent,
} from "react";
import type {
  Conversation,
  ConversationMessage,
  Project,
} from "@orc/shared";

import {
  Button,
} from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Textarea,
} from "@/components/ui/textarea";
import {
  createConversation,
  getConversation,
  listConversations,
  postMessage,
} from "@/lib/conversations";
import {
  getProjects,
} from "@/lib/projects";

/**
 * Formats a persisted conversation timestamp for the compact thread selector.
 */
function conversationLabel(
  conversation: Conversation,
): string {
  const timestamp =
    new Date(
      conversation.updatedAt,
    );

  return `${timestamp.toLocaleString()}${conversation.runId ? " · run linked" : ""}`;
}

/**
 * Renders project-scoped persistent orchestrator conversations.
 */
export function OrchestratorChat() {
  const [
    projects,
    setProjects,
  ] = useState<Project[]>([]);

  const [
    projectPath,
    setProjectPath,
  ] = useState("");

  const [
    conversations,
    setConversations,
  ] = useState<
    Conversation[]
  >([]);

  const [
    selectedConversationId,
    setSelectedConversationId,
  ] = useState("");

  const [
    activeConversationId,
    setActiveConversationId,
  ] = useState<
    string | null
  >(null);

  const [
    messages,
    setMessages,
  ] = useState<
    ConversationMessage[]
  >([]);

  const [
    content,
    setContent,
  ] = useState("");

  const [
    error,
    setError,
  ] = useState<
    string | null
  >(null);

  const [
    busy,
    setBusy,
  ] = useState(false);

  const [
    loadedProjectPath,
    setLoadedProjectPath,
  ] = useState<
    string | null
  >(null);

  const projectLoading =
    Boolean(
      projectPath &&
      loadedProjectPath !==
        projectPath,
    );

  const interactionBusy =
    busy || projectLoading;

  /**
   * Loads filesystem-backed projects once when the chat workspace mounts.
   */
  useEffect(() => {
    let cancelled = false;

    void getProjects()
      .then((value) => {
        if (cancelled) {
          return;
        }

        setProjects(
          value.projects,
        );

        setProjectPath(
          value.projects[0]
            ?.path ?? "",
        );
      })
      .catch(
        (value: unknown) => {
          if (cancelled) {
            return;
          }

          setError(
            value instanceof Error
              ? value.message
              : "Unable to load projects",
          );
        },
      );

    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Refreshes project-scoped conversation choices when project selection changes.
   */
  useEffect(() => {
    if (!projectPath) {
      return;
    }

    let cancelled = false;

    void listConversations(
      projectPath,
    )
      .then((value) => {
        if (cancelled) {
          return;
        }

        setConversations(
          value.conversations,
        );

        setSelectedConversationId(
          value.conversations[0]
            ?.id ?? "",
        );

        setLoadedProjectPath(
          projectPath,
        );

        setError(null);
      })
      .catch(
        (value: unknown) => {
          if (cancelled) {
            return;
          }

          setLoadedProjectPath(
            projectPath,
          );

          setError(
            value instanceof Error
              ? value.message
              : "Unable to load conversations",
          );
        },
      );

    return () => {
      cancelled = true;
    };
  }, [
    projectPath,
  ]);

  /**
   * Changes the selected project and clears state owned by the previous project.
   */
  function changeProject(
    nextProjectPath: string,
  ) {
    setProjectPath(
      nextProjectPath,
    );
    setLoadedProjectPath(
      null,
    );
    setActiveConversationId(
      null,
    );
    setMessages([]);
    setSelectedConversationId(
      "",
    );
    setConversations([]);
    setError(null);
  }

  /**
   * Opens the currently selected persisted conversation and loads its messages.
   */
  async function openSelectedConversation() {
    if (
      !selectedConversationId
    ) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const data =
        await getConversation(
          selectedConversationId,
        );

      setActiveConversationId(
        data.conversation.id,
      );

      setMessages(
        data.messages,
      );
    } catch (value) {
      setError(
        value instanceof Error
          ? value.message
          : "Unable to open conversation",
      );
    } finally {
      setBusy(false);
    }
  }

  /**
   * Creates and immediately opens a new project-scoped conversation.
   */
  async function createNewConversation() {
    if (!projectPath) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const conversation =
        await createConversation(
          projectPath,
        );

      setConversations(
        (current) => [
          conversation,
          ...current,
        ],
      );

      setSelectedConversationId(
        conversation.id,
      );

      setActiveConversationId(
        conversation.id,
      );

      setMessages([]);
    } catch (value) {
      setError(
        value instanceof Error
          ? value.message
          : "Unable to create conversation",
      );
    } finally {
      setBusy(false);
    }
  }

  /**
   * Sends one user message and appends the persisted grounded supervisor response.
   */
  async function submit(
    event:
      FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    const trimmed =
      content.trim();

    if (
      !activeConversationId ||
      !trimmed
    ) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const result =
        await postMessage(
          activeConversationId,
          trimmed,
        );

      setMessages(
        (current) => [
          ...current,
          {
            id:
              crypto.randomUUID(),
            conversationId:
              activeConversationId,
            role: "user",
            content: trimmed,
            createdAt:
              new Date().toISOString(),
          },
          result.message,
        ],
      );

      setContent("");

      const refreshed =
        await listConversations(
          projectPath,
        );

      setConversations(
        refreshed.conversations,
      );
    } catch (value) {
      setError(
        value instanceof Error
          ? value.message
          : "Unable to send message",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex max-w-4xl flex-col gap-5">
      <Card>
        <CardHeader>
          <CardTitle>
            Orchestrator
          </CardTitle>
        </CardHeader>

        <CardContent className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto]">
          <label
            className="sr-only"
            htmlFor="orchestrator-project"
          >
            Project
          </label>

          <select
            id="orchestrator-project"
            value={projectPath}
            onChange={(event) =>
              changeProject(
                event.target.value,
              )
            }
            className="h-9 min-w-0 rounded border bg-transparent px-2 text-sm"
            disabled={
              interactionBusy
            }
          >
            <option value="">
              Select project
            </option>

            {projects.map(
              (project) => (
                <option
                  key={project.id}
                  value={project.path}
                >
                  {project.name}
                </option>
              ),
            )}
          </select>

          <label
            className="sr-only"
            htmlFor="orchestrator-conversation"
          >
            Conversation
          </label>

          <select
            id="orchestrator-conversation"
            value={
              selectedConversationId
            }
            onChange={(event) =>
              setSelectedConversationId(
                event.target.value,
              )
            }
            className="h-9 min-w-0 rounded border bg-transparent px-2 text-sm"
            disabled={
              interactionBusy ||
              !projectPath ||
              conversations.length ===
                0
            }
          >
            <option value="">
              {conversations.length ===
              0
                ? "No conversations"
                : "Select conversation"}
            </option>

            {conversations.map(
              (conversation) => (
                <option
                  key={
                    conversation.id
                  }
                  value={
                    conversation.id
                  }
                >
                  {conversationLabel(
                    conversation,
                  )}
                </option>
              ),
            )}
          </select>

          <Button
            type="button"
            onClick={() =>
              void openSelectedConversation()
            }
            disabled={
              interactionBusy ||
              !selectedConversationId
            }
          >
            Open
          </Button>

          <Button
            type="button"
            onClick={() =>
              void createNewConversation()
            }
            disabled={
              interactionBusy ||
              !projectPath
            }
          >
            New
          </Button>
        </CardContent>
      </Card>

      {activeConversationId && (
        <Card>
          <CardContent className="flex min-h-80 flex-col gap-4 py-5">
            {messages.length ===
              0 && (
              <p className="text-sm text-text-muted">
                Start a new task or ask the orchestrator about project and runtime state.
              </p>
            )}

            {messages.map(
              (message) => (
                <div
                  key={message.id}
                  className={
                    message.role ===
                    "user"
                      ? "self-end max-w-[80%] whitespace-pre-wrap rounded bg-primary p-3 text-primary-foreground"
                      : "max-w-[80%] whitespace-pre-wrap rounded bg-muted p-3 text-text-primary"
                  }
                >
                  {
                    message.content
                  }
                </div>
              ),
            )}

            <form
              onSubmit={submit}
              className="mt-auto flex gap-2"
            >
              <Textarea
                value={content}
                onChange={(event) =>
                  setContent(
                    event.target.value,
                  )
                }
                placeholder="Describe the engineering task or ask for status…"
                disabled={busy}
              />

              <Button
                type="submit"
                disabled={
                  busy ||
                  !content.trim()
                }
              >
                {busy
                  ? "Working…"
                  : "Send"}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {error && (
        <p
          role="alert"
          className="text-sm text-status-error"
        >
          {error}
        </p>
      )}
    </div>
  );
}
