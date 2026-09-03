"use client";

import type {
  Conversation,
  ConversationMessage,
  Project,
  Run,
} from "@orc/shared";
import {
  BotIcon,
  RefreshCcwIcon,
  SendIcon,
  SquareIcon,
  UserRoundIcon,
} from "lucide-react";
import type {
  FormEvent,
} from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  formatConversationTime,
  isRunActive,
  isRunRetryable,
  pairConversationMessages,
} from "@/lib/orchestrator-presentation";
import {
  formatStatusLabel,
  getLifecycleBadgeVariant,
  projectNameFromPath,
} from "@/lib/task-presentation";
import { cn } from "@/lib/utils";

interface MessageCardProps {
  message: ConversationMessage;
  side: "user" | "assistant";
}

interface OrchestratorConversationProps {
  projects: Project[];
  projectPath: string;
  conversation: Conversation;
  messages: ConversationMessage[];
  content: string;
  runStatus: Run["status"] | null;
  busyAction: string | null;
  onProjectChange: (
    path: string,
  ) => Promise<void>;
  onContentChange: (
    content: string,
  ) => void;
  onSubmit: (
    event: FormEvent<HTMLFormElement>,
  ) => void;
  onExplainStatus: () => void;
  onStop: () => void;
  onRetry: () => void;
}

/** Renders one persisted conversation message using a role-specific visual treatment. */
function MessageCard({
  message,
  side,
}: MessageCardProps) {
  const isUser =
    side === "user";

  return (
    <article
      className={cn(
        "min-w-0 rounded-lg border p-3",
        isUser
          ? "border-status-running/25 bg-status-running/5"
          : "border-brand-accent/25 bg-brand-accent/5",
      )}
    >
      <header className="mb-2 flex items-center gap-2">
        <span
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-md",
            isUser
              ? "bg-status-running/10 text-status-running"
              : "bg-brand-accent/10 text-brand-accent",
          )}
        >
          {isUser ? (
            <UserRoundIcon className="size-3.5" />
          ) : (
            <BotIcon className="size-3.5" />
          )}
        </span>

        <span className="text-xs font-semibold text-text-primary">
          {isUser
            ? "You"
            : "Orchestrator"}
        </span>

        <time className="ms-auto text-[11px] text-text-muted">
          {formatConversationTime(
            message.createdAt,
          )}
        </time>
      </header>

      <p className="whitespace-pre-wrap break-words text-sm leading-5 text-text-secondary">
        {message.content}
      </p>
    </article>
  );
}

/** Renders one chronological user-to-assistant exchange with responsive side-by-side placement. */
function ConversationExchangeRow({
  user,
  assistant,
}: {
  user: ConversationMessage | null;
  assistant: ConversationMessage | null;
}) {
  return (
    <div className="grid min-w-0 gap-2 md:grid-cols-2">
      {user ? (
        <MessageCard
          message={user}
          side="user"
        />
      ) : (
        <div className="hidden md:block" />
      )}

      {assistant ? (
        <MessageCard
          message={assistant}
          side="assistant"
        />
      ) : null}
    </div>
  );
}

/** Renders the persistent conversation, responsive two-column exchanges, composer, and supported controls. */
export function OrchestratorConversation({
  projects,
  projectPath,
  conversation,
  messages,
  content,
  runStatus,
  busyAction,
  onProjectChange,
  onContentChange,
  onSubmit,
  onExplainStatus,
  onStop,
  onRetry,
}: OrchestratorConversationProps) {
  const exchanges =
    pairConversationMessages(
      messages,
    );

  const busy =
    busyAction !== null;

  const active =
    runStatus !== null &&
    isRunActive(runStatus);

  const retryable =
    runStatus !== null &&
    isRunRetryable(runStatus);

  const projectExists =
    projects.some(
      (project) =>
        project.path ===
        projectPath,
    );

  return (
    <Card className="flex min-h-[640px] min-w-0 flex-col overflow-hidden xl:h-[680px]">
      <CardHeader className="border-b border-divider px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-sm">
              Conversation
            </CardTitle>

            <p className="mt-1 text-[11px] text-text-muted">
              Persisted project-scoped supervisor history
            </p>
          </div>

          <Badge variant="neutral">
            {exchanges.length} exchanges
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col p-0">
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {exchanges.length ? (
            <div className="flex flex-col gap-2">
              {exchanges.map(
                (exchange) => (
                  <ConversationExchangeRow
                    key={
                      exchange.id
                    }
                    user={
                      exchange.user
                    }
                    assistant={
                      exchange.assistant
                    }
                  />
                ),
              )}
            </div>
          ) : (
            <div className="flex h-full min-h-64 items-center justify-center">
              <div className="max-w-sm text-center">
                <BotIcon className="mx-auto size-7 text-text-muted" />

                <p className="mt-3 text-sm font-medium text-text-primary">
                  No messages yet
                </p>

                <p className="mt-1 text-xs leading-5 text-text-muted">
                  Describe an engineering task or ask the Orchestrator about the current system state.
                </p>
              </div>
            </div>
          )}
        </div>

        <form
          onSubmit={onSubmit}
          className="border-t border-divider bg-surface-elevated p-3"
        >
          <div className="mb-2 flex items-center gap-2">
            <label
              htmlFor="orchestrator-project"
              className="text-[11px] font-medium text-text-muted"
            >
              Project
            </label>

            <select
              id="orchestrator-project"
              value={projectPath}
              disabled={busy}
              onChange={(event) => {
                void onProjectChange(
                  event.target.value,
                );
              }}
              className="h-8 min-w-0 flex-1 rounded-md border border-border-default bg-surface-interactive px-2 text-xs text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
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

            <span
              className="hidden max-w-40 truncate font-mono text-[10px] text-text-muted sm:block"
              title={
                conversation.id
              }
            >
              {conversation.id.slice(
                0,
                8,
              )}
            </span>
          </div>

          <div className="flex items-end gap-2">
            <Textarea
              value={content}
              disabled={busy}
              onChange={(event) =>
                onContentChange(
                  event.target.value,
                )
              }
              placeholder="Ask about this run, delegate work, or describe the next task..."
              className="min-h-20 resize-none"
            />

            <Button
              type="submit"
              size="icon"
              disabled={
                busy ||
                !content.trim()
              }
              aria-label="Send message"
            >
              <SendIcon className="size-4" />
            </Button>
          </div>

          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={
                busy ||
                runStatus === null
              }
              onClick={
                onExplainStatus
              }
            >
              Explain status
            </Button>

            {active ? (
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={busy}
                onClick={
                  onStop
                }
              >
                <SquareIcon className="size-3.5" />
                Stop current run
              </Button>
            ) : null}

            {retryable ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={
                  onRetry
                }
              >
                <RefreshCcwIcon className="size-3.5" />
                Retry last execution
              </Button>
            ) : null}

            {runStatus ? (
              <Badge
                className="ms-auto self-center"
                variant={getLifecycleBadgeVariant(
                  runStatus,
                )}
              >
                {formatStatusLabel(
                  runStatus,
                )}
              </Badge>
            ) : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
