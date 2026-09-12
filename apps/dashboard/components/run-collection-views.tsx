"use client";

import {
  FolderIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import type {
  KeyboardEvent,
  MouseEvent,
} from "react";

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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  formatRelativeTime,
} from "@/lib/run-observability";
import {
  getRunProjectName,
} from "@/lib/run-collection";

export type RunViewMode =
  | "list"
  | "details"
  | "grid";

interface RunCollectionViewsProps {
  runs: RunMonitoringSummary[];
  viewMode: RunViewMode;
}

const statusBadgeVariant = {
  pending: "neutral",
  running: "running",
  completed: "success",
  failed: "error",
  blocked: "warning",
  cancelled: "disabled",
  skipped: "neutral",
} as const;


/**
 * Produces a compact stable Run identifier for collection surfaces.
 */
function compactRunId(
  runId: string,
): string {
  return runId.slice(0, 8);
}

/**
 * Returns the persisted task title or a stable Run-based fallback when no task is attached.
 */
function runTitle(
  run: RunMonitoringSummary,
): string {
  return (
    run.taskTitle ??
    `Run ${compactRunId(
      run.id,
    )}`
  );
}

/**
 * Capitalizes one persisted status label without changing its underlying value.
 */
function statusLabel(
  status:
    RunMonitoringSummary["status"],
): string {
  return (
    status.charAt(0).toUpperCase() +
    status.slice(1)
  );
}

/**
 * Formats one persisted ISO timestamp for a native exact-time tooltip.
 */
function exactTimestamp(
  value: string,
): string {
  const date = new Date(value);

  return Number.isNaN(
    date.getTime(),
  )
    ? value
    : date.toLocaleString();
}

/**
 * Renders one semantic status badge using the existing dashboard status-token variants.
 */
function RunStatusBadge({
  run,
}: {
  run: RunMonitoringSummary;
}) {
  return (
    <Badge
      variant={
        statusBadgeVariant[
          run.status
        ]
      }
      aria-label={`Run status: ${run.status}`}
    >
      <span
        className="size-1.5 rounded-full bg-current"
        aria-hidden="true"
      />
      {statusLabel(
        run.status,
      )}
    </Badge>
  );
}

/**
 * Renders the project name while preserving the authoritative absolute project path as discoverable metadata.
 */
function RunProject({
  run,
}: {
  run: RunMonitoringSummary;
}) {
  return (
    <div
      className="flex min-w-0 items-center gap-2"
      title={run.projectPath}
    >
      <FolderIcon
        className="size-4 shrink-0 text-text-muted"
        aria-hidden="true"
      />
      <span className="truncate text-text-secondary">
        {getRunProjectName(
          run.projectPath,
        )}
      </span>
    </div>
  );
}

/**
 * Renders persisted execution progress without inventing unreported workflow telemetry.
 */
function RunProgress({
  run,
}: {
  run: RunMonitoringSummary;
}) {
  const planned =
    run.plannedExecutionCount;

  return (
    <div className="min-w-0 text-xs">
      <p className="font-medium text-text-secondary">
        {planned > 0
          ? `${run.executionCount}/${planned} executions`
          : `${run.executionCount} executions`}
      </p>

      {run.currentAgent ? (
        <p className="mt-0.5 truncate text-text-muted">
          {run.currentAgent.name}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Renders the current immutable agent snapshot fields available on the Run summary contract.
 */
function RunCurrentAgent({
  run,
}: {
  run: RunMonitoringSummary;
}) {
  if (!run.currentAgent) {
    return (
      <span className="text-text-muted">
        —
      </span>
    );
  }

  return (
    <div className="min-w-0">
      <p className="truncate font-medium text-text-secondary">
        {run.currentAgent.name}
      </p>
      <p className="mt-0.5 truncate text-xs text-text-muted">
        {run.currentAgent.role}
        {" · "}
        {run.currentAgent.harness}
        {" · "}
        {run.currentAgent.model}
      </p>
    </div>
  );
}

/**
 * Renders the primary Run title and compact persisted identifier.
 */
function RunIdentity({
  run,
  onNavigate,
}: {
  run: RunMonitoringSummary;
  onNavigate: () => void;
}) {
  return (
    <div className="min-w-0">
      <button
        type="button"
        className="block max-w-full truncate text-left font-medium text-text-primary outline-none hover:text-link focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-focus-ring/50"
        onClick={(event) => {
          event.stopPropagation();
          onNavigate();
        }}
      >
        {runTitle(run)}
      </button>
      <p className="mt-0.5 truncate font-mono text-[11px] text-text-muted">
        #{compactRunId(
          run.id,
        )}
        {run.currentAgent?.role
          ? ` · ${run.currentAgent.role}`
          : ""}
      </p>
    </div>
  );
}

/**
 * Renders one relative persisted timestamp with an exact timestamp exposed through native tooltip text.
 */
function RunTimestamp({
  value,
}: {
  value: string;
}) {
  return (
    <time
      dateTime={value}
      title={exactTimestamp(
        value,
      )}
      className="whitespace-nowrap text-xs text-text-secondary"
    >
      {formatRelativeTime(
        value,
      )}
    </time>
  );
}

/**
 * Owns navigation behavior shared by every Run collection presentation.
 */
export function RunCollectionViews({
  runs,
  viewMode,
}: RunCollectionViewsProps) {
  const router = useRouter();

  /**
   * Navigates to the existing dedicated Run detail workspace.
   */
  function navigateToRun(
    runId: string,
  ): void {
    router.push(
      `/runs/${runId}`,
    );
  }

  /**
   * Makes the whole row or card keyboard-operable without removing native controls inside it.
   */
  function handleKeyboardNavigation(
    event: KeyboardEvent,
    runId: string,
  ): void {
    if (
      event.key !== "Enter" &&
      event.key !== " "
    ) {
      return;
    }

    event.preventDefault();
    navigateToRun(runId);
  }

  /**
   * Navigates from a nested explicit View control without firing the parent row or card click handler twice.
   */
  function handleViewClick(
    event: MouseEvent,
    runId: string,
  ): void {
    event.stopPropagation();
    navigateToRun(runId);
  }

  if (viewMode === "grid") {
    return (
      <div className="grid grid-cols-1 gap-3 p-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {runs.map((run) => (
          <Card
            key={run.id}
            size="sm"
            tabIndex={0}
            className="gap-3 rounded-lg bg-surface-card shadow-none ring-1 ring-border-default transition-colors hover:bg-surface-interactive/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring/50"
            onClick={() =>
              navigateToRun(
                run.id,
              )
            }
            onKeyDown={(event) =>
              handleKeyboardNavigation(
                event,
                run.id,
              )
            }
            aria-label={`View ${runTitle(run)}`}
          >
            <CardHeader className="gap-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <RunIdentity
                    run={run}
                    onNavigate={() =>
                      navigateToRun(
                        run.id,
                      )
                    }
                  />
                </div>
                <RunStatusBadge
                  run={run}
                />
              </div>

              <RunProject
                run={run}
              />
            </CardHeader>

            <CardContent className="grid gap-2 text-xs">
              <div className="grid grid-cols-[72px_1fr] gap-2">
                <span className="text-text-muted">
                  Progress
                </span>
                <RunProgress
                  run={run}
                />
              </div>

              <div className="grid grid-cols-[72px_1fr] gap-2">
                <span className="text-text-muted">
                  Started
                </span>
                <RunTimestamp
                  value={run.createdAt}
                />
              </div>

              <div className="grid grid-cols-[72px_1fr] gap-2">
                <span className="text-text-muted">
                  Updated
                </span>
                <RunTimestamp
                  value={run.updatedAt}
                />
              </div>

              {run.terminalReason ? (
                <div className="grid gap-1 border-t border-divider pt-2">
                  <span className="text-text-muted">
                    Terminal reason
                  </span>
                  <p
                    className="line-clamp-2 text-text-secondary"
                    title={
                      run.terminalReason
                    }
                  >
                    {run.terminalReason}
                  </p>
                </div>
              ) : null}

              <div className="flex justify-end border-t border-divider pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={(event) =>
                    handleViewClick(
                      event,
                      run.id,
                    )
                  }
                >
                  View
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (viewMode === "details") {
    return (
      <Table className="min-w-[1180px]">
        <TableHeader className="bg-surface-interactive/50">
          <TableRow className="hover:bg-transparent">
            <TableHead className="h-9 px-4 text-xs text-text-secondary">
              Run
            </TableHead>
            <TableHead className="h-9 px-4 text-xs text-text-secondary">
              Status
            </TableHead>
            <TableHead className="h-9 px-4 text-xs text-text-secondary">
              Project
            </TableHead>
            <TableHead className="h-9 px-4 text-xs text-text-secondary">
              Current agent
            </TableHead>
            <TableHead className="h-9 px-4 text-xs text-text-secondary">
              Progress
            </TableHead>
            <TableHead className="h-9 px-4 text-xs text-text-secondary">
              Started
            </TableHead>
            <TableHead className="h-9 px-4 text-xs text-text-secondary">
              Updated
            </TableHead>
            <TableHead className="h-9 px-4 text-xs text-text-secondary">
              Terminal reason
            </TableHead>
            <TableHead className="h-9 px-4 text-right text-xs text-text-secondary">
              Actions
            </TableHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          {runs.map((run) => (
            <TableRow
              key={run.id}
              tabIndex={0}
              className="h-14 cursor-pointer border-divider hover:bg-surface-interactive/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus-ring/50"
              onClick={() =>
                navigateToRun(
                  run.id,
                )
              }
              onKeyDown={(event) =>
                handleKeyboardNavigation(
                  event,
                  run.id,
                )
              }
              aria-label={`View ${runTitle(run)}`}
            >
              <TableCell className="max-w-[360px] px-4 py-2">
                <RunIdentity
                  run={run}
                  onNavigate={() =>
                    navigateToRun(
                      run.id,
                    )
                  }
                />
              </TableCell>
              <TableCell className="px-4 py-2">
                <RunStatusBadge
                  run={run}
                />
              </TableCell>
              <TableCell className="max-w-[220px] px-4 py-2">
                <RunProject
                  run={run}
                />
              </TableCell>
              <TableCell className="max-w-[280px] px-4 py-2">
                <RunCurrentAgent
                  run={run}
                />
              </TableCell>
              <TableCell className="px-4 py-2">
                <RunProgress
                  run={run}
                />
              </TableCell>
              <TableCell className="px-4 py-2">
                <RunTimestamp
                  value={run.createdAt}
                />
              </TableCell>
              <TableCell className="px-4 py-2">
                <RunTimestamp
                  value={run.updatedAt}
                />
              </TableCell>
              <TableCell
                className="max-w-[260px] px-4 py-2 text-xs text-text-muted"
                title={
                  run.terminalReason ??
                  undefined
                }
              >
                <span className="block truncate">
                  {run.terminalReason ??
                    "—"}
                </span>
              </TableCell>
              <TableCell className="px-4 py-2 text-right">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={(event) =>
                    handleViewClick(
                      event,
                      run.id,
                    )
                  }
                >
                  View
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  }

  return (
    <Table className="min-w-[940px]">
      <TableHeader className="bg-surface-interactive/50">
        <TableRow className="hover:bg-transparent">
          <TableHead className="h-9 px-4 text-xs text-text-secondary">
            Run
          </TableHead>
          <TableHead className="h-9 px-4 text-xs text-text-secondary">
            Status
          </TableHead>
          <TableHead className="h-9 px-4 text-xs text-text-secondary">
            Project
          </TableHead>
          <TableHead className="h-9 px-4 text-xs text-text-secondary">
            Progress
          </TableHead>
          <TableHead className="h-9 px-4 text-xs text-text-secondary">
            Started
          </TableHead>
          <TableHead className="hidden h-9 px-4 text-xs text-text-secondary lg:table-cell">
            Updated
          </TableHead>
          <TableHead className="h-9 px-4 text-right text-xs text-text-secondary">
            Actions
          </TableHead>
        </TableRow>
      </TableHeader>

      <TableBody>
        {runs.map((run) => (
          <TableRow
            key={run.id}
            tabIndex={0}
            className="h-14 cursor-pointer border-divider hover:bg-surface-interactive/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus-ring/50"
            onClick={() =>
              navigateToRun(
                run.id,
              )
            }
            onKeyDown={(event) =>
              handleKeyboardNavigation(
                event,
                run.id,
              )
            }
            aria-label={`View ${runTitle(run)}`}
          >
            <TableCell className="max-w-[360px] px-4 py-2">
              <RunIdentity
                run={run}
                onNavigate={() =>
                  navigateToRun(
                    run.id,
                  )
                }
              />
            </TableCell>
            <TableCell className="px-4 py-2">
              <RunStatusBadge
                run={run}
              />
            </TableCell>
            <TableCell className="max-w-[220px] px-4 py-2">
              <RunProject
                run={run}
              />
            </TableCell>
            <TableCell className="px-4 py-2">
              <RunProgress
                run={run}
              />
            </TableCell>
            <TableCell className="px-4 py-2">
              <RunTimestamp
                value={run.createdAt}
              />
            </TableCell>
            <TableCell className="hidden px-4 py-2 lg:table-cell">
              <RunTimestamp
                value={run.updatedAt}
              />
            </TableCell>
            <TableCell className="px-4 py-2 text-right">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={(event) =>
                  handleViewClick(
                    event,
                    run.id,
                  )
                }
              >
                View
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
