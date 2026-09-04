"use client";

import {
  CircleDotIcon,
} from "lucide-react";

import type {
  RunMonitoringSummary,
} from "@orc/shared";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  RUN_STATUS_FILTERS,
  formatRelativeTime,
  formatStatusLabel,
  projectNameFromPath,
  shortIdentifier,
  type RunStatusFilter,
} from "@/lib/run-observability";
import { cn } from "@/lib/utils";

type BadgeVariant =
  | "running"
  | "success"
  | "warning"
  | "error"
  | "neutral";

interface RunNavigatorProps {
  runs: RunMonitoringSummary[];
  selectedRunId:
    | string
    | null;
  statusFilter: RunStatusFilter;
  onStatusFilterChange: (
    value: RunStatusFilter,
  ) => void;
  onSelect: (
    runId: string,
  ) => void;
}

interface RunNavigatorRowProps {
  run: RunMonitoringSummary;
  selected: boolean;
  onSelect: (
    runId: string,
  ) => void;
}

/**
 * Maps persisted run state onto the shared semantic badge variants.
 */
function runStatusVariant(
  status:
    RunMonitoringSummary["status"],
): BadgeVariant {
  switch (status) {
    case "running":
      return "running";
    case "completed":
      return "success";
    case "pending":
    case "blocked":
      return "warning";
    case "failed":
      return "error";
    case "cancelled":
    default:
      return "neutral";
  }
}

/**
 * Returns the semantic progress indicator class for one run lifecycle state.
 */
function progressToneClass(
  status:
    RunMonitoringSummary["status"],
): string {
  switch (status) {
    case "completed":
      return "[&_[data-slot=progress-indicator]]:bg-status-success";
    case "failed":
      return "[&_[data-slot=progress-indicator]]:bg-status-error";
    case "blocked":
    case "pending":
      return "[&_[data-slot=progress-indicator]]:bg-status-warning";
    case "cancelled":
      return "[&_[data-slot=progress-indicator]]:bg-status-neutral";
    case "running":
    default:
      return "[&_[data-slot=progress-indicator]]:bg-status-running";
  }
}

/**
 * Converts execution attempts into bounded workflow-plan progress.
 */
function executionProgress(
  executionCount: number,
  plannedExecutionCount: number,
): number {
  if (
    plannedExecutionCount <= 0
  ) {
    return 0;
  }

  return Math.min(
    100,
    (executionCount /
      plannedExecutionCount) *
      100,
  );
}

/**
 * Renders a full-height desktop run navigator with a fixed filter header and independently scrollable history.
 */
export function RunNavigator({
  runs,
  selectedRunId,
  statusFilter,
  onStatusFilterChange,
  onSelect,
}: RunNavigatorProps) {
  return (
    <Card className="min-w-0 gap-0 self-start overflow-hidden xl:sticky xl:top-6 xl:h-[calc(100dvh-3rem)]">
      <CardHeader className="shrink-0 border-b border-divider py-3">
        <div className="flex flex-wrap gap-1">
          {RUN_STATUS_FILTERS.map(
            (status) => {
              const selected =
                status ===
                statusFilter;

              return (
                <Button
                  key={status}
                  type="button"
                  variant="ghost"
                  size="xs"
                  aria-pressed={
                    selected
                  }
                  className={cn(
                    selected &&
                      "bg-link/10 text-link hover:bg-link/15 hover:text-link",
                  )}
                  onClick={() =>
                    onStatusFilterChange(
                      status,
                    )
                  }
                >
                  {formatStatusLabel(
                    status,
                  )}
                </Button>
              );
            },
          )}
        </div>
      </CardHeader>

      <CardContent className="min-h-0 flex-1 overflow-hidden p-0">
        {runs.length ? (
          <ScrollArea className="h-[min(58vh,520px)] xl:h-full">
            {runs.map(
              (run) => (
                <RunNavigatorRow
                  key={run.id}
                  run={run}
                  selected={
                    selectedRunId ===
                    run.id
                  }
                  onSelect={
                    onSelect
                  }
                />
              ),
            )}
          </ScrollArea>
        ) : (
          <div className="flex h-full min-h-44 flex-col items-center justify-center gap-2 px-4 text-center">
            <CircleDotIcon className="size-5 text-text-muted" />

            <p className="text-sm font-medium text-text-secondary">
              No matching runs
            </p>

            <p className="max-w-56 text-xs leading-5 text-text-muted">
              Adjust the status filter or global search, or wait for a workflow to start.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Renders one compact keyboard-accessible run summary and workflow progress indicator.
 */
function RunNavigatorRow({
  run,
  selected,
  onSelect,
}: RunNavigatorRowProps) {
  const planned =
    run.plannedExecutionCount;

  const progress =
    executionProgress(
      run.executionCount,
      planned,
    );

  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() =>
        onSelect(run.id)
      }
      className={cn(
        "block w-full border-b border-divider px-3 py-3 text-left transition-colors last:border-b-0 hover:bg-surface-interactive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus-ring",
        selected &&
          "bg-link/5 ring-1 ring-inset ring-link/70",
      )}
    >
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <Badge
              variant={runStatusVariant(
                run.status,
              )}
              className="h-4 px-1.5 text-[9px] uppercase"
            >
              {formatStatusLabel(
                run.status,
              )}
            </Badge>

            <p className="min-w-0 flex-1 truncate text-xs font-medium text-text-primary">
              {run.taskTitle ??
                "Workflow run"}
            </p>
          </div>

          <p className="mt-1 truncate text-[10px] text-text-muted">
            {projectNameFromPath(
              run.projectPath,
            )}
            {run.taskId
              ? `  /  Task ${shortIdentifier(
                  run.taskId,
                )}`
              : ""}
          </p>
        </div>

        <span className="shrink-0 text-[10px] text-text-muted">
          {formatRelativeTime(
            run.updatedAt,
          )}
        </span>
      </div>

      <div className="mt-2 grid grid-cols-[minmax(0,1fr)_84px] items-end gap-3">
        <div className="min-w-0">
          <p className="truncate text-[10px] text-text-secondary">
            {run.currentAgent
              ?.name ??
              "No active agent"}
          </p>
        </div>

        <div className="min-w-0">
          <p className="mb-1 text-right text-[10px] font-medium tabular-nums text-text-primary">
            {planned > 0
              ? `${run.executionCount} / ${planned}`
              : `${run.executionCount} attempts`}
          </p>

          <Progress
            value={progress}
            className={progressToneClass(
              run.status,
            )}
          />
        </div>
      </div>
    </button>
  );
}
