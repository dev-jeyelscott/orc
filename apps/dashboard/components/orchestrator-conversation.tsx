"use client";

import type {
  Conversation,
  ConversationMessage,
  Run,
} from "@orc/shared";
import {
  BotIcon,
  CirclePlayIcon,
  RefreshCcwIcon,
  SendIcon,
  SquareIcon,
  UserIcon,
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
import {
  Message,
  MessageAvatar,
  MessageContent,
  MessageHeader,
} from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { Textarea } from "@/components/ui/textarea";
import {
  formatConversationTime,
  isRunActive,
  isRunRetryable,
} from "@/lib/orchestrator-presentation";
import {
  compactPath,
  formatStatusLabel,
  getLifecycleBadgeVariant,
  shortId,
} from "@/lib/task-presentation";
import { cn } from "@/lib/utils";

interface OrchestratorConversationProps {
  projectPath: string;
  conversation: Conversation;
  messages: ConversationMessage[];
  content: string;
  runStatus: Run["status"] | null;
  busyAction: string | null;
  onContentChange: (content: string) => void;
  onSubmit: (
    event: FormEvent<HTMLFormElement>,
  ) => void;
  onStartTask: () => void;
  onExplainStatus: () => void;
  onStop: () => void;
  onRetry: () => void;
}

/** Renders one persisted conversation message using normal chat-style left/right alignment. */
function ConversationMessageRow({
  message,
}: {
  message: ConversationMessage;
}) {
  const isUser =
    message.role === "user";

  return (
    <Message
      align={
        isUser
          ? "end"
          : "start"
      }
      className="items-end gap-2"
    >
      <MessageAvatar
        className={cn(
          "size-7 border",
          isUser
            ? "border-brand-accent/40 bg-brand-accent text-primary-foreground"
            : "border-border-default bg-surface-interactive text-brand-accent",
        )}
      >
        {isUser ? (
          <UserIcon className="size-3.5" />
        ) : (
          <BotIcon className="size-3.5" />
        )}
      </MessageAvatar>

      <MessageContent
        className={cn(
          "max-w-[88%] sm:max-w-[82%] lg:max-w-[78%]",
          isUser
            ? "items-end"
            : "items-start",
        )}
      >
        <MessageHeader
          className={cn(
            "mb-1 gap-2 px-1 text-[10px]",
            isUser &&
              "justify-end",
          )}
        >
          <span className="font-semibold text-text-secondary">
            {isUser
              ? "You"
              : "Orchestrator"}
          </span>

          <time
            dateTime={
              message.createdAt
            }
            className="text-text-muted"
          >
            {formatConversationTime(
              message.createdAt,
            )}
          </time>
        </MessageHeader>

        <div
          className={cn(
            "w-fit max-w-full whitespace-pre-wrap break-words rounded-xl border px-3 py-2 text-xs leading-5",
            isUser
              ? "border-brand-accent/40 bg-brand-accent text-primary-foreground"
              : "border-border-default bg-surface-interactive text-text-secondary",
          )}
        >
          {message.content}
        </div>
      </MessageContent>
    </Message>
  );
}

/** Renders the chronological persisted transcript, composer, and supported workflow controls. */
export function OrchestratorConversation({
  projectPath,
  conversation,
  messages,
  content,
  runStatus,
  busyAction,
  onContentChange,
  onSubmit,
  onStartTask,
  onExplainStatus,
  onStop,
  onRetry,
}: OrchestratorConversationProps) {
  const busy =
    busyAction !== null;

  const active =
    runStatus !== null &&
    isRunActive(
      runStatus,
    );

  const retryable =
    runStatus !== null &&
    isRunRetryable(
      runStatus,
    );

  return (
    <Card className="flex min-h-[620px] min-w-0 flex-col overflow-hidden 2xl:h-[700px]">
      <CardHeader className="border-b border-divider px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-sm">
              Conversation
            </CardTitle>

            <p className="mt-1 text-[11px] text-text-muted">
              Orchestrator left, you right
            </p>
          </div>

          <Badge variant="neutral">
            {messages.length} messages
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col p-0">
        <div className="min-h-0 flex-1">
          <MessageScrollerProvider
            autoScroll
            defaultScrollPosition="end"
            scrollPreviousItemPeek={48}
          >
            <MessageScroller>
              <MessageScrollerViewport>
                <MessageScrollerContent
                  className="gap-3 p-3 sm:p-4"
                  aria-busy={
                    busyAction ===
                      "send" ||
                    busyAction ===
                      "start-task" ||
                    busyAction ===
                      "explain-status"
                  }
                >
                  {messages.length ? (
                    messages.map(
                      (message) => (
                        <MessageScrollerItem
                          key={
                            message.id
                          }
                          messageId={
                            message.id
                          }
                          scrollAnchor={
                            message.role ===
                            "user"
                          }
                          className="py-0.5"
                        >
                          <ConversationMessageRow
                            message={
                              message
                            }
                          />
                        </MessageScrollerItem>
                      ),
                    )
                  ) : (
                    <MessageScrollerItem
                      messageId="conversation-empty-state"
                    >
                      <div className="flex min-h-64 items-center justify-center px-6 text-center">
                        <div className="max-w-sm">
                          <BotIcon className="mx-auto size-7 text-text-muted" />

                          <p className="mt-3 text-sm font-medium text-text-primary">
                            No messages yet
                          </p>

                          <p className="mt-1 text-xs leading-5 text-text-muted">
                            Describe an engineering task or ask the Orchestrator about authoritative system state.
                          </p>
                        </div>
                      </div>
                    </MessageScrollerItem>
                  )}
                </MessageScrollerContent>
              </MessageScrollerViewport>

              <MessageScrollerButton />
            </MessageScroller>
          </MessageScrollerProvider>
        </div>

        <form
          onSubmit={onSubmit}
          className="border-t border-divider bg-surface-elevated p-3"
        >
          <div className="mb-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-text-muted">
            <span>
              Project
            </span>

            <span
              className="max-w-full truncate font-mono text-text-secondary"
              title={projectPath}
            >
              {compactPath(
                projectPath,
              )}
            </span>

            <span className="hidden sm:inline">
              Conversation
            </span>

            <span
              className="hidden font-mono text-text-secondary sm:inline"
              title={
                conversation.id
              }
            >
              {shortId(
                conversation.id,
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
              onKeyDown={(event) => {
                if (
                  event.key ===
                    "Enter" &&
                  (event.ctrlKey ||
                    event.metaKey)
                ) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder="Ask about this run or describe an engineering task..."
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

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={
                busy ||
                active ||
                !content.trim()
              }
              onClick={
                onStartTask
              }
            >
              <CirclePlayIcon className="size-3.5" />
              Start task
            </Button>

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

            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={
                busy ||
                !active
              }
              onClick={onStop}
            >
              <SquareIcon className="size-3.5" />
              Stop current run
            </Button>

            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={
                busy ||
                !retryable
              }
              onClick={onRetry}
            >
              <RefreshCcwIcon className="size-3.5" />
              Retry last execution
            </Button>

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

          <p className="mt-2 text-[10px] text-text-muted">
            Ctrl+Enter or Cmd+Enter sends. Enter inserts a new line.
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
