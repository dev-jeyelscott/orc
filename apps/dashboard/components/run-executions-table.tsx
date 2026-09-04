"use client";

import Link from "next/link";
import type {
  KeyboardEvent,
} from "react";
import {
  ExternalLinkIcon,
  WrenchIcon,
} from "lucide-react";

import type {
  AgentExecution,
} from "@orc/shared";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  executionDurationMs,
  formatCompactNumber,
  formatDateTime,
  formatDuration,
  formatStatusLabel,
  normalizeContextUsage,
  normalizeTokenUsage,
  shortIdentifier,
} from "@/lib/run-observability";
import { cn } from "@/lib/utils";

type BadgeVariant =
  | "running"
  | "success"
  | "warning"
  | "error"
  | "neutral";

type RunExecutionsTableVariant =
  | "overview"
  | "operator";

interface RunExecutionsTableProps {
  executions:
    AgentExecution[];
  variant?:
    RunExecutionsTableVariant;
  selectedExecutionId?:
    | string
    | null;
  onSelectExecution?: (
    executionId: string,
  ) => void;
  className?: string;
}

/**
 * Maps persisted execution lifecycle state onto shared semantic badge variants.
 */
function executionStatusVariant(
  status:
    AgentExecution["status"],
): BadgeVariant {
  switch (status) {
    case "running":
      return "running";
    case "starting":
    case "pending":
      return "warning";
    case "completed":
      return "success";
    case "failed":
    case "blocked":
      return "error";
    case "cancelled":
    default:
      return "neutral";
  }
}

/**
 * Resolves one persisted execution's concise result label without inventing an outcome.
 */
function executionResultLabel(
  execution:
    AgentExecution,
): string {
  if (
    execution.resultStatus
  ) {
    return formatStatusLabel(
      execution.resultStatus,
    );
  }

  if (
    execution.failureReason
  ) {
    return "Failure recorded";
  }

  return "Unavailable";
}

/**
 * Renders execution attempts using the overview or dedicated operator presentation.
 */
export function RunExecutionsTable({
  executions,
  variant = "overview",
  selectedExecutionId = null,
  onSelectExecution,
  className,
}: RunExecutionsTableProps) {
  if (
    variant ===
    "operator"
  ) {
    return (
      <OperatorRunExecutionsTable
        executions={
          executions
        }
        selectedExecutionId={
          selectedExecutionId
        }
        onSelectExecution={
          onSelectExecution
        }
        className={
          className
        }
      />
    );
  }

  return (
    <OverviewRunExecutionsTable
      executions={
        executions
      }
      className={
        className
      }
    />
  );
}

/**
 * Preserves the richer grouped monitoring table used on the Runs overview page.
 */
function OverviewRunExecutionsTable({
  executions,
  className,
}: {
  executions:
    AgentExecution[];
  className?: string;
}) {
  return (
    <Card
      className={cn(
        "min-w-0",
        className,
      )}
    >
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>
          Executions
        </CardTitle>

        <span className="text-[11px] text-text-muted">
          {
            executions.length
          }{" "}
          {executions.length ===
          1
            ? "attempt"
            : "attempts"}
        </span>
      </CardHeader>

      <CardContent className="min-w-0 p-0">
        {executions.length ? (
          <Table className="min-w-[940px] text-[11px]">
            <TableHeader>
              <TableRow className="bg-surface-interactive/40 hover:bg-surface-interactive/40">
                <TableHead className="h-auto px-3 py-2">
                  <p>
                    Agent
                  </p>
                  <p className="text-[9px] font-normal text-text-muted">
                    Role,
                    layer,
                    order
                  </p>
                </TableHead>

                <TableHead className="h-auto px-3 py-2">
                  <p>
                    Runtime
                  </p>
                  <p className="text-[9px] font-normal text-text-muted">
                    Harness,
                    model,
                    reasoning
                  </p>
                </TableHead>

                <TableHead className="h-auto px-3 py-2">
                  Status
                </TableHead>

                <TableHead className="h-auto px-3 py-2">
                  <p>
                    Result
                  </p>
                  <p className="text-[9px] font-normal text-text-muted">
                    Outcome
                    and
                    failure
                  </p>
                </TableHead>

                <TableHead className="h-auto px-3 py-2">
                  <p>
                    Timing
                  </p>
                  <p className="text-[9px] font-normal text-text-muted">
                    Started
                    and
                    completion
                  </p>
                </TableHead>

                <TableHead className="h-auto px-3 py-2">
                  <p>
                    Process
                  </p>
                  <p className="text-[9px] font-normal text-text-muted">
                    PID and
                    exit
                  </p>
                </TableHead>

                <TableHead className="h-auto px-3 py-2">
                  <p>
                    Usage
                  </p>
                  <p className="text-[9px] font-normal text-text-muted">
                    Tokens
                    and
                    context
                  </p>
                </TableHead>

                <TableHead className="h-auto px-3 py-2">
                  Commit
                </TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {executions.map(
                (
                  execution,
                ) => (
                  <OverviewExecutionRow
                    key={
                      execution.id
                    }
                    execution={
                      execution
                    }
                  />
                ),
              )}
            </TableBody>
          </Table>
        ) : (
          <div className="px-4 py-8 text-center text-sm text-text-muted">
            Preparing
            the first
            worker.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Renders one existing overview row with grouped runtime, timing, process, and usage telemetry.
 */
function OverviewExecutionRow({
  execution,
}: {
  execution:
    AgentExecution;
}) {
  const tokens =
    normalizeTokenUsage(
      execution.tokenUsage,
    );

  const context =
    normalizeContextUsage(
      execution.contextUsage,
    );

  const elapsed =
    executionDurationMs(
      execution,
    );

  return (
    <TableRow className="border-divider hover:bg-surface-interactive/40">
      <TableCell className="min-w-36 whitespace-normal px-3 py-2.5 align-top">
        <Link
          href={`/agent-executions/${execution.id}`}
          className="font-medium text-link hover:underline"
        >
          {
            execution.agentName
          }
        </Link>

        <p className="mt-0.5 text-[10px] text-text-muted">
          {
            execution.agentRole
          }
        </p>

        <p className="mt-0.5 text-[9px] tabular-nums text-text-muted">
          L
          {
            execution.layer
          }{" "}
          / O
          {
            execution.executionOrder
          }
        </p>
      </TableCell>

      <TableCell className="min-w-40 max-w-52 whitespace-normal px-3 py-2.5 align-top">
        <p className="capitalize text-text-secondary">
          {
            execution.harness
          }
        </p>

        <p className="mt-0.5 truncate font-mono text-[9px] text-text-muted">
          {
            execution.model
          }
        </p>

        <p className="mt-0.5 capitalize text-[9px] text-text-muted">
          {
            execution.reasoning
          }
        </p>
      </TableCell>

      <TableCell className="whitespace-normal px-3 py-2.5 align-top">
        <Badge
          variant={executionStatusVariant(
            execution.status,
          )}
          className="h-4 px-1.5 text-[9px]"
        >
          {formatStatusLabel(
            execution.status,
          )}
        </Badge>
      </TableCell>

      <TableCell className="min-w-40 max-w-56 whitespace-normal px-3 py-2.5 align-top">
        <p className="text-text-secondary">
          {executionResultLabel(
            execution,
          )}
        </p>

        {execution.failureReason ? (
          <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-status-error">
            {
              execution.failureReason
            }
          </p>
        ) : null}

        {execution.repairAttempted ? (
          <span className="mt-1 inline-flex items-center gap-1 text-[9px] text-status-warning">
            <WrenchIcon className="size-2.5" />
            Repair
            attempted
          </span>
        ) : null}
      </TableCell>

      <TableCell className="min-w-36 whitespace-normal px-3 py-2.5 align-top tabular-nums">
        <p className="whitespace-nowrap text-text-secondary">
          {formatDateTime(
            execution.startedAt,
          )}
        </p>

        <p className="mt-0.5 whitespace-nowrap text-[9px] text-text-muted">
          {execution.completedAt
            ? `Completed ${formatDateTime(
                execution.completedAt,
              )}`
            : elapsed !==
                null
              ? `Elapsed ${formatDuration(
                  elapsed,
                )}`
              : "Completion unavailable"}
        </p>
      </TableCell>

      <TableCell className="whitespace-normal px-3 py-2.5 align-top font-mono tabular-nums">
        <p className="text-text-secondary">
          PID{" "}
          {execution.pid ??
            "Unavailable"}
        </p>

        <p className="mt-0.5 text-[9px] text-text-muted">
          Exit{" "}
          {execution.exitCode ??
            "Unavailable"}
        </p>
      </TableCell>

      <TableCell className="whitespace-normal px-3 py-2.5 align-top tabular-nums">
        <p className="text-text-secondary">
          {tokens?.totalTokens !==
            null &&
          tokens?.totalTokens !==
            undefined
            ? formatCompactNumber(
                tokens.totalTokens,
              )
            : "Unavailable"}
        </p>

        <p className="mt-0.5 text-[9px] text-text-muted">
          Context{" "}
          {context
            ? `${context.percent.toFixed(
                0,
              )}%`
            : "Unavailable"}
        </p>
      </TableCell>

      <TableCell className="whitespace-normal px-3 py-2.5 align-top font-mono">
        {execution.commitHash ? (
          <span className="text-link">
            {shortIdentifier(
              execution.commitHash,
            )}
          </span>
        ) : (
          <span className="text-text-muted">
            Unavailable
          </span>
        )}
      </TableCell>
    </TableRow>
  );
}

/**
 * Renders the bounded selectable execution table used by the dedicated Run Detail workspace.
 */
function OperatorRunExecutionsTable({
  executions,
  selectedExecutionId,
  onSelectExecution,
  className,
}: {
  executions:
    AgentExecution[];
  selectedExecutionId:
    | string
    | null;
  onSelectExecution?: (
    executionId: string,
  ) => void;
  className?: string;
}) {
  return (
    <Card
      className={cn(
        "h-full min-h-0 min-w-0 gap-0 rounded-lg border border-border-default bg-surface-card py-0 shadow-xs ring-0",
        className,
      )}
    >
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-divider px-3">
        <h2 className="font-heading text-xs font-medium text-text-primary">
          Executions
        </h2>

        <span className="text-[10px] tabular-nums text-text-muted">
          {
            executions.length
          }{" "}
          {executions.length ===
          1
            ? "attempt"
            : "attempts"}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {executions.length ? (
          <Table className="min-w-[660px] table-fixed text-[10px]">
            <colgroup>
              <col className="w-12" />
              <col className="w-40" />
              <col className="w-14" />
              <col className="w-36" />
              <col className="w-40" />
              <col className="w-20" />
              <col className="w-24" />
            </colgroup>

            <TableHeader>
              <TableRow className="bg-surface-interactive/40 hover:bg-surface-interactive/40">
                <TableHead className="h-8 px-2 text-[10px]">
                  Attempt
                </TableHead>

                <TableHead className="h-8 px-2 text-[10px]">
                  Agent
                </TableHead>

                <TableHead className="h-8 px-2 text-[10px]">
                  Layer
                </TableHead>

                <TableHead className="h-8 px-2 text-[10px]">
                  Harness /
                  Model
                </TableHead>

                <TableHead className="h-8 px-2 text-[10px]">
                  Status /
                  Result
                </TableHead>

                <TableHead className="h-8 px-2 text-[10px]">
                  Duration
                </TableHead>

                <TableHead className="h-8 px-2 text-[10px]">
                  Commit
                </TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {executions.map(
                (
                  execution,
                  index,
                ) => (
                  <OperatorExecutionRow
                    key={
                      execution.id
                    }
                    execution={
                      execution
                    }
                    attemptNumber={
                      index + 1
                    }
                    selected={
                      selectedExecutionId ===
                      execution.id
                    }
                    onSelectExecution={
                      onSelectExecution
                    }
                  />
                ),
              )}
            </TableBody>
          </Table>
        ) : (
          <div className="flex min-h-32 items-center justify-center px-4 text-center text-xs text-text-muted">
            No
            persisted
            execution
            attempts
            yet.
          </div>
        )}
      </div>
    </Card>
  );
}

/**
 * Renders one stable-height selectable persisted execution attempt.
 */
function OperatorExecutionRow({
  execution,
  attemptNumber,
  selected,
  onSelectExecution,
}: {
  execution:
    AgentExecution;
  attemptNumber:
    number;
  selected: boolean;
  onSelectExecution?: (
    executionId: string,
  ) => void;
}) {
  const elapsed =
    executionDurationMs(
      execution,
    );

  const selectable =
    typeof onSelectExecution ===
    "function";

  /**
   * Selects this execution for the terminal and inspector without route navigation.
   */
  function handleSelect(): void {
    onSelectExecution?.(
      execution.id,
    );
  }

  /**
   * Makes execution-row selection available to keyboard users without hijacking child links.
   */
  function handleKeyDown(
    event:
      KeyboardEvent<HTMLTableRowElement>,
  ): void {
    if (
      event.target !==
      event.currentTarget
    ) {
      return;
    }

    if (
      event.key ===
        "Enter" ||
      event.key ===
        " "
    ) {
      event.preventDefault();
      handleSelect();
    }
  }

  return (
    <TableRow
      tabIndex={
        selectable
          ? 0
          : undefined
      }
      aria-current={
        selected
          ? "true"
          : undefined
      }
      aria-label={
        selectable
          ? `Inspect ${execution.agentName} execution attempt ${attemptNumber}`
          : undefined
      }
      onClick={
        selectable
          ? handleSelect
          : undefined
      }
      onKeyDown={
        selectable
          ? handleKeyDown
          : undefined
      }
      className={cn(
        "h-9 border-divider hover:bg-surface-interactive/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus-ring",
        selectable &&
          "cursor-pointer",
        selected &&
          "bg-status-running/10 ring-1 ring-inset ring-status-running/50 hover:bg-status-running/10",
      )}
    >
      <TableCell className="px-2 py-1.5 text-center font-mono tabular-nums text-text-secondary">
        {
          attemptNumber
        }
      </TableCell>

      <TableCell className="min-w-0 px-2 py-1.5">
        <div className="flex min-w-0 items-center gap-1">
          <span
            title={
              execution.agentName
            }
            className="min-w-0 flex-1 truncate font-medium text-text-primary"
          >
            {
              execution.agentName
            }
          </span>

          <Link
            href={`/agent-executions/${execution.id}`}
            aria-label={`Open standalone execution detail for ${execution.agentName}`}
            title="Open standalone execution detail"
            className="shrink-0 rounded-sm text-text-muted hover:text-link focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            <ExternalLinkIcon className="size-3" />
          </Link>
        </div>

        {selected ? (
          <span className="sr-only">
            Selected
            execution.
          </span>
        ) : null}
      </TableCell>

      <TableCell className="px-2 py-1.5 text-center tabular-nums text-text-secondary">
        {
          execution.layer
        }
      </TableCell>

      <TableCell className="min-w-0 px-2 py-1.5">
        <p className="truncate capitalize text-text-secondary">
          {
            execution.harness
          }{" "}
          /{" "}
          <span
            title={
              execution.model
            }
            className="font-mono normal-case"
          >
            {
              execution.model
            }
          </span>
        </p>
      </TableCell>

      <TableCell className="px-2 py-1.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <Badge
            variant={executionStatusVariant(
              execution.status,
            )}
            className="h-4 shrink-0 px-1.5 text-[9px]"
          >
            {formatStatusLabel(
              execution.status,
            )}
          </Badge>

          <span
            title={executionResultLabel(
              execution,
            )}
            className="min-w-0 truncate text-[9px] text-text-muted"
          >
            {executionResultLabel(
              execution,
            )}
          </span>
        </div>
      </TableCell>

      <TableCell className="px-2 py-1.5 font-mono tabular-nums text-text-secondary">
        {formatDuration(
          elapsed,
        )}
      </TableCell>

      <TableCell
        title={
          execution.commitHash ??
          undefined
        }
        className="truncate px-2 py-1.5 font-mono text-text-secondary"
      >
        {execution.commitHash
          ? shortIdentifier(
              execution.commitHash,
            )
          : "Unavailable"}
      </TableCell>
    </TableRow>
  );
}
