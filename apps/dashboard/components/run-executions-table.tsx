"use client";

import Link from "next/link";
import {
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

type BadgeVariant =
  | "running"
  | "success"
  | "warning"
  | "error"
  | "neutral";

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

interface RunExecutionsTableProps {
  executions: AgentExecution[];
}

/**
 * Renders execution attempts in grouped operational columns to reduce normal desktop overflow.
 */
export function RunExecutionsTable({
  executions,
}: RunExecutionsTableProps) {
  return (
    <Card className="min-w-0">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>
          Executions
        </CardTitle>

        <span className="text-[11px] text-text-muted">
          {executions.length}{" "}
          {executions.length === 1
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
                    Role, layer, order
                  </p>
                </TableHead>

                <TableHead className="h-auto px-3 py-2">
                  <p>
                    Runtime
                  </p>
                  <p className="text-[9px] font-normal text-text-muted">
                    Harness, model, reasoning
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
                    Outcome and failure
                  </p>
                </TableHead>

                <TableHead className="h-auto px-3 py-2">
                  <p>
                    Timing
                  </p>
                  <p className="text-[9px] font-normal text-text-muted">
                    Started and completion
                  </p>
                </TableHead>

                <TableHead className="h-auto px-3 py-2">
                  <p>
                    Process
                  </p>
                  <p className="text-[9px] font-normal text-text-muted">
                    PID and exit
                  </p>
                </TableHead>

                <TableHead className="h-auto px-3 py-2">
                  <p>
                    Usage
                  </p>
                  <p className="text-[9px] font-normal text-text-muted">
                    Tokens and context
                  </p>
                </TableHead>

                <TableHead className="h-auto px-3 py-2">
                  Commit
                </TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {executions.map(
                (execution) => (
                  <ExecutionTableRow
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
            Preparing the first worker.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface ExecutionTableRowProps {
  execution: AgentExecution;
}

/**
 * Renders one persisted execution with grouped runtime, timing, process, and usage telemetry.
 */
function ExecutionTableRow({
  execution,
}: ExecutionTableRowProps) {
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

  const resultLabel =
    execution.resultStatus
      ? formatStatusLabel(
          execution.resultStatus,
        )
      : execution.failureReason
        ? "Failure recorded"
        : "Pending";

  return (
    <TableRow className="border-divider hover:bg-surface-interactive/40">
      <TableCell className="min-w-36 whitespace-normal px-3 py-2.5 align-top">
        <Link
          href={`/agent-executions/${execution.id}`}
          className="font-medium text-link hover:underline"
        >
          {execution.agentName}
        </Link>

        <p className="mt-0.5 text-[10px] text-text-muted">
          {execution.agentRole}
        </p>

        <p className="mt-0.5 text-[9px] tabular-nums text-text-muted">
          L{execution.layer} / O
          {execution.executionOrder}
        </p>
      </TableCell>

      <TableCell className="min-w-40 max-w-52 whitespace-normal px-3 py-2.5 align-top">
        <p className="capitalize text-text-secondary">
          {execution.harness}
        </p>

        <p className="mt-0.5 truncate font-mono text-[9px] text-text-muted">
          {execution.model}
        </p>

        <p className="mt-0.5 capitalize text-[9px] text-text-muted">
          {execution.reasoning}
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
          {resultLabel}
        </p>

        {execution.failureReason ? (
          <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-status-error">
            {execution.failureReason}
          </p>
        ) : null}

        {execution.repairAttempted ? (
          <span className="mt-1 inline-flex items-center gap-1 text-[9px] text-status-warning">
            <WrenchIcon className="size-2.5" />
            Repair attempted
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
            : elapsed !== null
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
