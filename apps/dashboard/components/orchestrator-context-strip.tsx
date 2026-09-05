"use client";

import Link from "next/link";
import type {
  AgentExecution,
  Conversation,
  Project,
  RunDetail,
  Team,
} from "@orc/shared";
import {
  MessageSquarePlusIcon,
  RefreshCcwIcon,
  SquareIcon,
} from "lucide-react";
import type {
  ReactNode,
} from "react";

import {
  Badge,
} from "@/components/ui/badge";
import {
  Button,
} from "@/components/ui/button";
import {
  Card,
} from "@/components/ui/card";
import {
  formatElapsedTime,
  isRunActive,
  isRunRetryable,
} from "@/lib/orchestrator-presentation";
import {
  formatStatusLabel,
  getLifecycleBadgeVariant,
  shortId,
} from "@/lib/task-presentation";
import {
  cn,
} from "@/lib/utils";

interface OrchestratorContextStripProps {
  projects:
    Project[];
  projectPath:
    string;
  teams:
    Team[];
  teamId:
    string;
  conversations:
    Conversation[];
  conversation:
    Conversation | null;
  runDetail:
    RunDetail | null;
  activeExecution:
    AgentExecution | null;
  busyAction:
    string | null;
  now:
    number;
  onProjectChange:
    (projectPath: string) => void;
  onTeamChange:
    (teamId: string) => void;
  onConversationChange:
    (conversationId: string) => void;
  onNewConversation:
    () => void;
  onStop:
    () => void;
  onRetry:
    () => void;
}

/**
 * Renders one compact contextual label and value inside the command bar.
 */
function ContextCell({
  label,
  children,
  className,
}: {
  label:
    string;
  children:
    ReactNode;
  className?:
    string;
}) {
  return (
    <div
      className={cn(
        "min-w-0 bg-surface-card px-3 py-2",
        className,
      )}
    >
      <div className="text-[9px] font-medium uppercase tracking-wide text-text-muted">
        {label}
      </div>

      <div className="mt-1 min-w-0 text-xs font-medium text-text-primary">
        {children}
      </div>
    </div>
  );
}

/**
 * Renders authoritative Project, Team, Conversation, Run, Stop, and Retry context.
 */
export function OrchestratorContextStrip({
  projects,
  projectPath,
  teams,
  teamId,
  conversations,
  conversation,
  runDetail,
  activeExecution,
  busyAction,
  now,
  onProjectChange,
  onTeamChange,
  onConversationChange,
  onNewConversation,
  onStop,
  onRetry,
}: OrchestratorContextStripProps) {
  const busy =
    busyAction !==
    null;

  const run =
    runDetail?.run ??
    null;

  const active =
    run
      ? isRunActive(
          run.status,
        )
      : false;

  const retryable =
    run
      ? isRunRetryable(
          run.status,
        )
      : false;

  const elapsed =
    run
      ? formatElapsedTime(
          run.createdAt,
          active
            ? null
            : run.updatedAt,
          now,
        )
      : "-";

  return (
    <Card className="shrink-0 gap-0 overflow-hidden p-0">
      <div className="overflow-x-auto">
        <div className="grid min-w-[1340px] gap-px bg-divider grid-cols-[minmax(150px,0.95fr)_minmax(150px,0.9fr)_minmax(230px,1.4fr)_minmax(110px,0.7fr)_minmax(170px,1fr)_minmax(115px,0.7fr)_minmax(180px,1fr)_minmax(100px,0.65fr)_auto]">
          <ContextCell label="Project">
            <select
              value={
                projectPath
              }
              disabled={
                busy ||
                projects.length ===
                  0
              }
              onChange={(
                event,
              ) =>
                onProjectChange(
                  event.target
                    .value,
                )
              }
              className="h-7 w-full min-w-0 rounded-md border border-border-default bg-surface-interactive px-2 text-xs text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
              aria-label="Selected project"
            >
              {projects.length ===
              0 ? (
                <option value="">
                  No projects
                </option>
              ) : null}

              {projects.map(
                (
                  project,
                ) => (
                  <option
                    key={
                      project.id
                    }
                    value={
                      project.path
                    }
                  >
                    {project.name}
                  </option>
                ),
              )}
            </select>
          </ContextCell>

          <ContextCell label="Team">
            <select
              value={
                teamId
              }
              disabled={
                busy ||
                teams.length ===
                  0 ||
                !projectPath
              }
              onChange={(
                event,
              ) =>
                onTeamChange(
                  event.target
                    .value,
                )
              }
              className="h-7 w-full min-w-0 rounded-md border border-border-default bg-surface-interactive px-2 text-xs text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
              aria-label="Selected team"
            >
              <option value="">
                Select Team
              </option>

              {teams.map(
                (
                  team,
                ) => (
                  <option
                    key={
                      team.id
                    }
                    value={
                      team.id
                    }
                  >
                    {team.name}
                    {!team.enabled
                      ? " (disabled)"
                      : ""}
                  </option>
                ),
              )}
            </select>
          </ContextCell>

          <ContextCell label="Task">
            <span
              className="block truncate"
              title={
                runDetail?.task
                  ?.title ??
                conversation
                  ?.taskId ??
                undefined
              }
            >
              {runDetail?.task
                ?.title ??
                (
                  conversation
                    ?.taskId
                    ? shortId(
                        conversation.taskId,
                      )
                    : "No linked task"
                )}
            </span>
          </ContextCell>

          <ContextCell label="Run ID">
            {run ? (
              <Link
                href={`/runs/${run.id}`}
                className="font-mono text-link hover:underline"
                title={
                  run.id
                }
              >
                {shortId(
                  run.id,
                )}
              </Link>
            ) : (
              <span className="text-text-muted">
                No run
              </span>
            )}
          </ContextCell>

          <ContextCell label="Conversation ID">
            <div className="flex min-w-0 items-center gap-1.5">
              <select
                value={
                  conversation
                    ?.id ??
                  ""
                }
                disabled={
                  busy ||
                  conversations.length ===
                    0
                }
                onChange={(
                  event,
                ) =>
                  onConversationChange(
                    event.target
                      .value,
                  )
                }
                className="h-7 min-w-0 flex-1 rounded-md border border-border-default bg-surface-interactive px-2 font-mono text-[10px] text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                aria-label="Selected conversation"
              >
                {conversations.length ===
                0 ? (
                  <option value="">
                    None
                  </option>
                ) : null}

                {conversations.map(
                  (
                    item,
                  ) => (
                    <option
                      key={
                        item.id
                      }
                      value={
                        item.id
                      }
                    >
                      {shortId(
                        item.id,
                      )}
                    </option>
                  ),
                )}
              </select>

              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                disabled={
                  busy ||
                  !projectPath ||
                  !teamId
                }
                onClick={
                  onNewConversation
                }
                aria-label="Create conversation"
              >
                <MessageSquarePlusIcon className="size-3.5" />
              </Button>
            </div>
          </ContextCell>

          <ContextCell label="Status">
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
              <span className="text-text-muted">
                Idle
              </span>
            )}
          </ContextCell>

          <ContextCell label="Current Agent">
            {activeExecution ? (
              <div className="flex min-w-0 items-center gap-1.5">
                <span
                  className="size-1.5 shrink-0 rounded-full bg-status-running"
                  aria-hidden
                />

                <span
                  className="truncate"
                  title={`${activeExecution.agentName} · ${activeExecution.agentRole}`}
                >
                  {activeExecution.agentName}
                </span>
              </div>
            ) : (
              <span className="text-text-muted">
                No active execution
              </span>
            )}
          </ContextCell>

          <ContextCell label="Elapsed">
            <span className="font-mono">
              {elapsed}
            </span>
          </ContextCell>

          <div className="flex items-center justify-end gap-2 bg-surface-card px-3 py-2">
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={
                busy ||
                !active
              }
              onClick={
                onStop
              }
            >
              <SquareIcon className="size-3.5" />
              Stop
            </Button>

            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={
                busy ||
                !retryable
              }
              onClick={
                onRetry
              }
            >
              <RefreshCcwIcon className="size-3.5" />
              Retry
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
