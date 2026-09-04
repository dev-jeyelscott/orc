"use client";

import type {
  Conversation,
  ConversationMessage,
  Run,
} from "@orc/shared";
import {
  BotIcon,
  CirclePlayIcon,
  LoaderCircleIcon,
  MessageSquarePlusIcon,
  SendIcon,
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
  pairConversationMessages,
  type ConversationExchange,
} from "@/lib/orchestrator-presentation";
import {
  compactPath,
  shortId,
} from "@/lib/task-presentation";
import { cn } from "@/lib/utils";

interface OrchestratorConversationProps {
  projectPath: string;
  conversation: Conversation | null;
  messages: ConversationMessage[];
  content: string;
  runStatus: Run["status"] | null;
  busyAction: string | null;
  pendingMessage: { content: string; createdAt: string } | null;
  className?: string;
  onContentChange: (content: string) => void;
  onSubmit: (
    event: FormEvent<HTMLFormElement>,
  ) => void;
  onStartTask: () => void;
  onExplainStatus: () => void;
  onNewConversation: () => void;
}

/** Returns whether the current request is waiting for an authoritative supervisor response. */
function isSupervisorRequestBusy(
  busyAction: string | null,
): boolean {
  return (
    busyAction === "send" ||
    busyAction === "start-task" ||
    busyAction === "explain-status"
  );
}

/** Renders one persisted conversation message using the visual language from the approved reference. */
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
      className="items-start gap-2.5"
    >
      <MessageAvatar
        className={cn(
          "mt-5 size-7 self-start border",
          isUser
            ? "border-brand-accent/40 bg-brand-accent/15 text-brand-accent"
            : "border-border-default bg-surface-interactive text-text-secondary",
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
          "max-w-[84%] sm:max-w-[78%] lg:max-w-[72%]",
          isUser
            ? "items-end"
            : "items-start",
        )}
      >
        <MessageHeader
          className={cn(
            "mb-1.5 gap-2 px-1 text-[10px]",
            isUser &&
              "justify-end",
          )}
        >
          <span className="font-medium text-text-secondary">
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
            "w-fit max-w-full whitespace-pre-wrap break-words rounded-xl border px-3.5 py-2.5 text-xs leading-5 shadow-xs",
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

/** Renders one deterministic exchange while preserving the persisted chronological message order. */
function ConversationExchangeRow({
  exchange,
}: {
  exchange: ConversationExchange;
}) {
  return (
    <div className="space-y-4">
      {exchange.user ? (
        <ConversationMessageRow
          message={exchange.user}
        />
      ) : null}

      {exchange.assistant ? (
        <ConversationMessageRow
          message={
            exchange.assistant
          }
        />
      ) : null}
    </div>
  );
}

/** Renders an optimistic user message that has not yet been persisted. */
function PendingUserMessage({
  message,
}: {
  message: { content: string; createdAt: string };
}) {
  return (
    <Message
      align="end"
      className="items-start gap-2.5 opacity-60"
    >
      <MessageAvatar
        className={cn(
          "mt-5 size-7 self-start border",
          "border-brand-accent/40 bg-brand-accent/15 text-brand-accent",
        )}
      >
        <UserIcon className="size-3.5" />
      </MessageAvatar>

      <MessageContent
        className="max-w-[84%] sm:max-w-[78%] lg:max-w-[72%] items-end"
      >
        <MessageHeader className="mb-1.5 gap-2 px-1 text-[10px] justify-end">
          <span className="font-medium text-text-secondary">
            You
          </span>

          <span className="text-text-muted">
            Sending…
          </span>
        </MessageHeader>

        <div className="w-fit max-w-full whitespace-pre-wrap break-words rounded-xl border border-brand-accent/40 bg-brand-accent px-3.5 py-2.5 text-xs leading-5 shadow-xs text-primary-foreground">
          {message.content}
        </div>
      </MessageContent>
    </Message>
  );
}

/** Renders the approved chat-focused conversation experience and its supported supervisor actions. */
export function OrchestratorConversation({
  projectPath,
  conversation,
  messages,
  content,
  runStatus,
  busyAction,
  pendingMessage,
  className,
  onContentChange,
  onSubmit,
  onStartTask,
  onExplainStatus,
  onNewConversation,
}: OrchestratorConversationProps) {
  const busy =
    busyAction !== null;

  const active =
    runStatus !== null &&
    isRunActive(
      runStatus,
    );

  const supervisorBusy =
    isSupervisorRequestBusy(
      busyAction,
    );

  const exchanges =
    pairConversationMessages(
      messages,
    );

  return (
    <Card
      className={cn(
        "flex min-h-[620px] min-w-0 flex-col gap-0 overflow-hidden p-0",
        className,
      )}
    >
      <CardHeader className="shrink-0 border-b border-divider px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-sm">
              Conversation
            </CardTitle>

            <p className="mt-0.5 text-[11px] text-text-muted">
              Collaborate with the orchestrator
            </p>
          </div>

          <Badge variant="neutral">
            {messages.length}{" "}
            {messages.length === 1
              ? "message"
              : "messages"}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col p-0">
        <div className="min-h-0 flex-1">
          <MessageScrollerProvider
            autoScroll
            defaultScrollPosition="end"
            scrollPreviousItemPeek={72}
          >
            <MessageScroller>
              <MessageScrollerViewport>
                <MessageScrollerContent
                  className="gap-5 px-4 py-5 sm:px-5 lg:px-6"
                  aria-busy={
                    supervisorBusy
                  }
                >
                  {!conversation ? (
                    <MessageScrollerItem
                      messageId="conversation-not-selected"
                    >
                      <div className="flex min-h-80 items-center justify-center px-6 text-center">
                        <div className="max-w-sm">
                          <div className="mx-auto flex size-10 items-center justify-center rounded-full border border-border-default bg-surface-interactive text-brand-accent">
                            <BotIcon className="size-5" />
                          </div>

                          <h2 className="mt-4 text-base font-semibold text-text-primary">
                            Start a conversation
                          </h2>

                          <p className="mt-1 text-xs leading-5 text-text-muted">
                            Create a persistent conversation for this project to begin working with the supervisor.
                          </p>

                          <Button
                            type="button"
                            className="mt-4"
                            disabled={
                              busy ||
                              !projectPath
                            }
                            onClick={
                              onNewConversation
                            }
                          >
                            <MessageSquarePlusIcon className="size-4" />
                            New conversation
                          </Button>
                        </div>
                      </div>
                    </MessageScrollerItem>
                  ) : exchanges.length ? (
                    exchanges.map(
                      (
                        exchange,
                        index,
                      ) => (
                        <MessageScrollerItem
                          key={
                            exchange.id
                          }
                          messageId={
                            exchange.id
                          }
                          scrollAnchor={
                            index ===
                            exchanges.length -
                              1
                          }
                          className="py-0.5"
                        >
                          <ConversationExchangeRow
                            exchange={
                              exchange
                            }
                          />
                        </MessageScrollerItem>
                      ),
                    )
                  ) : (
                    <MessageScrollerItem
                      messageId="conversation-empty-state"
                    >
                      <div className="flex min-h-80 items-center justify-center px-6 text-center">
                        <div className="max-w-sm">
                          <div className="mx-auto flex size-10 items-center justify-center rounded-full border border-border-default bg-surface-interactive text-brand-accent">
                            <BotIcon className="size-5" />
                          </div>

                          <h2 className="mt-4 text-base font-semibold text-text-primary">
                            New conversation
                          </h2>

                          <p className="mt-1 text-xs leading-5 text-text-muted">
                            Describe an engineering task or ask about authoritative run state.
                          </p>
                        </div>
                      </div>
                    </MessageScrollerItem>
                  )}

                  {conversation &&
                  pendingMessage ? (
                    <MessageScrollerItem
                      messageId="pending-user-message"
                    >
                      <PendingUserMessage
                        message={
                          pendingMessage
                        }
                      />
                    </MessageScrollerItem>
                  ) : null}

                  {conversation &&
                  supervisorBusy ? (
                    <MessageScrollerItem
                      messageId="orchestrator-working"
                      scrollAnchor
                    >
                      <div
                        className="flex items-center gap-2 pl-9 text-[11px] text-text-muted"
                        role="status"
                        aria-live="polite"
                      >
                        <LoaderCircleIcon className="size-3.5 animate-spin" />
                        <span>
                          Orchestrator is working...
                        </span>
                      </div>
                    </MessageScrollerItem>
                  ) : null}
                </MessageScrollerContent>
              </MessageScrollerViewport>

              <MessageScrollerButton />
            </MessageScroller>
          </MessageScrollerProvider>
        </div>

        {conversation ? (
          <form
            onSubmit={onSubmit}
            className="shrink-0 border-t border-divider bg-surface-elevated p-3"
          >
            <div className="rounded-xl border border-border-default bg-surface-interactive p-2 shadow-xs focus-within:border-focus-ring/60 focus-within:ring-2 focus-within:ring-focus-ring/20">
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
                placeholder="Ask the orchestrator or describe an engineering task..."
                className="min-h-20 resize-none border-0 bg-transparent px-2 py-1.5 shadow-none focus-visible:ring-0"
              />

              <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
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
                  variant="ghost"
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
                  type="submit"
                  size="icon"
                  className="ms-auto"
                  disabled={
                    busy ||
                    !content.trim()
                  }
                  aria-label="Send message"
                >
                  <SendIcon className="size-4" />
                </Button>
              </div>
            </div>

            <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-text-muted">
              <span
                className="max-w-52 truncate font-mono text-text-secondary"
                title={projectPath}
              >
                {compactPath(
                  projectPath,
                )}
              </span>

              <span
                className="font-mono text-text-secondary"
                title={
                  conversation.id
                }
              >
                {shortId(
                  conversation.id,
                )}
              </span>

              <span className="ms-auto">
                Ctrl+Enter or Cmd+Enter sends
              </span>
            </div>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}
