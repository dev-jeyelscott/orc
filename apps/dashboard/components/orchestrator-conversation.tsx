"use client"

import type {
  Conversation,
  ConversationMessage,
  Project,
  Run,
} from "@orc/shared"
import {
  BotIcon,
  RefreshCcwIcon,
  SendIcon,
  SquareIcon,
} from "lucide-react"
import type {
  FormEvent,
} from "react"

import {
  Avatar,
  AvatarFallback,
} from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import {
  Bubble,
  BubbleContent,
} from "@/components/ui/bubble"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Message,
  MessageAvatar,
  MessageContent,
  MessageHeader,
} from "@/components/ui/message"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller"
import { Textarea } from "@/components/ui/textarea"
import {
  formatConversationTime,
  isRunActive,
  isRunRetryable,
} from "@/lib/orchestrator-presentation"
import {
  formatStatusLabel,
  getLifecycleBadgeVariant,
  projectNameFromPath,
} from "@/lib/task-presentation"
import { cn } from "@/lib/utils"

interface OrchestratorConversationProps {
  projects: Project[]
  projectPath: string
  conversation: Conversation
  messages: ConversationMessage[]
  content: string
  runStatus: Run["status"] | null
  busyAction: string | null
  onProjectChange: (
    path: string,
  ) => Promise<void>
  onContentChange: (
    content: string,
  ) => void
  onSubmit: (
    event: FormEvent<HTMLFormElement>,
  ) => void
  onExplainStatus: () => void
  onStop: () => void
  onRetry: () => void
}

/** Renders one persisted user or Orchestrator message using the shadcn Message composition. */
function ConversationMessageRow({
  message,
}: {
  message: ConversationMessage
}) {
  const isUser =
    message.role === "user"

  const align =
    isUser
      ? "end"
      : "start"

  return (
    <Message
      align={align}
      className="gap-2"
    >
      {!isUser ? (
        <MessageAvatar className="size-7 bg-brand-accent/10">
          <Avatar className="size-7">
            <AvatarFallback className="bg-brand-accent/10 text-brand-accent">
              <BotIcon className="size-3.5" />
            </AvatarFallback>
          </Avatar>
        </MessageAvatar>
      ) : null}

      <MessageContent
        className={cn(
          "gap-1.5",
          isUser
            ? "max-w-[86%] items-end"
            : "max-w-[90%] items-start",
        )}
      >
        <MessageHeader
          className={cn(
            "gap-2 px-1 text-[10px] text-text-muted",
            isUser
              ? "justify-end"
              : "justify-start",
          )}
        >
          <span className="font-semibold text-text-primary">
            {isUser
              ? "You"
              : "Orchestrator"}
          </span>

          <time
            dateTime={
              message.createdAt
            }
          >
            {formatConversationTime(
              message.createdAt,
            )}
          </time>
        </MessageHeader>

        <Bubble
          align={align}
          variant={
            isUser
              ? "tinted"
              : "outline"
          }
          className="max-w-full"
        >
          <BubbleContent className="max-w-full whitespace-pre-wrap">
            {message.content}
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  )
}

/** Renders the persisted conversation, shadcn message scroller, composer, and supported workflow controls. */
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
  const busy =
    busyAction !== null

  const active =
    runStatus !== null &&
    isRunActive(
      runStatus,
    )

  const retryable =
    runStatus !== null &&
    isRunRetryable(
      runStatus,
    )

  const projectExists =
    projects.some(
      (project) =>
        project.path ===
        projectPath,
    )

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
                  className="gap-2 p-3"
                  aria-busy={
                    busyAction ===
                    "send"
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
                          className="py-1"
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
                            Describe an engineering task or ask the Orchestrator about the current system state.
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
                )
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
              placeholder="Ask the Orchestrator to start work, explain status, stop a run, or retry execution..."
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
                Stop run
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
                Retry execution
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
  )
}
