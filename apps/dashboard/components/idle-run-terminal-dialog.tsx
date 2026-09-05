"use client";

import {
  CircleAlertIcon,
} from "lucide-react";
import {
  useEffect,
  useState,
} from "react";

import type {
  RunMonitoringDetail,
  RunMonitoringSummary,
} from "@orc/shared";

import {
  AgentExecutionTerminal,
} from "@/components/agent-execution-terminal";
import {
  RunExecutionInspector,
} from "@/components/run-execution-inspector";
import {
  Badge,
} from "@/components/ui/badge";
import {
  Button,
} from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  selectIdleRunExecution,
} from "@/lib/idle-run-monitor-state";
import {
  runStatusVariant,
} from "@/lib/run-detail-state";
import {
  formatDuration,
  formatStatusLabel,
  projectNameFromPath,
} from "@/lib/run-observability";
import {
  cn,
} from "@/lib/utils";

interface IdleRunTerminalDialogProps {
  run:
    RunMonitoringSummary;
  detail:
    | RunMonitoringDetail
    | null;
  monitoringWarning:
    | string
    | null;
  onOpenChange:
    (
      open: boolean,
    ) => void;
  onOpenRunDetail:
    () => void;
}

interface HeaderFactProps {
  label: string;
  value: string;
  className?: string;
}

/**
 * Calculates live elapsed time from the persisted run start timestamp.
 */
function elapsedRunMs(
  createdAt: string,
  now: number,
):
  | number
  | null {
  const startedAt =
    Date.parse(
      createdAt,
    );

  if (
    !Number.isFinite(
      startedAt,
    )
  ) {
    return null;
  }

  return Math.max(
    0,
    now -
      startedAt,
  );
}

/**
 * Renders one compact high-signal run fact without allowing long content to expand the header.
 */
function HeaderFact({
  label,
  value,
  className,
}: HeaderFactProps) {
  return (
    <div
      className={cn(
        "min-w-0",
        className,
      )}
    >
      <p className="text-[9px] font-medium uppercase tracking-wide text-text-muted">
        {label}
      </p>

      <p
        title={value}
        className="mt-0.5 truncate text-xs font-medium text-text-secondary"
      >
        {value}
      </p>
    </div>
  );
}

/**
 * Renders the execution preparation state without creating a second terminal implementation.
 */
function WaitingExecutionPanel() {
  return (
    <div className="flex h-full min-h-[18rem] min-w-0 items-center justify-center rounded-lg border border-border-default bg-surface-card p-6 text-center">
      <div>
        <p className="text-sm font-medium text-text-primary">
          Waiting for
          active execution
        </p>

        <p className="mt-1 text-xs text-text-muted">
          The run is
          active, but no
          starting or running
          worker is currently
          persisted.
        </p>
      </div>
    </div>
  );
}

/**
 * Renders the read-only idle active-run observability dialog.
 */
export function IdleRunTerminalDialog({
  run,
  detail,
  monitoringWarning,
  onOpenChange,
  onOpenRunDetail,
}: IdleRunTerminalDialogProps) {
  const [
    now,
    setNow,
  ] =
    useState(
      () =>
        Date.now(),
    );

  /**
   * Updates the compact elapsed-time display while this dialog is mounted.
   */
  useEffect(() => {
    /**
     * Refreshes the local presentation clock without affecting authoritative run state.
     */
    function refreshElapsedTime(): void {
      setNow(
        Date.now(),
      );
    }

    refreshElapsedTime();

    const timer =
      window.setInterval(
        refreshElapsedTime,
        1_000,
      );

    return () => {
      window.clearInterval(
        timer,
      );
    };
  }, [
    run.id,
  ]);

  const confirmedDetail =
    detail?.run.id ===
    run.id
      ? detail
      : null;

  const selectedExecution =
    confirmedDetail
      ? selectIdleRunExecution(
          confirmedDetail,
        )
      : null;

  const taskTitle =
    confirmedDetail
      ?.task?.title ??
    run.taskTitle ??
    "Workflow run";

  const currentAgentName =
    selectedExecution
      ?.agentName ??
    run.currentAgent
      ?.name ??
    "Preparing";

  const elapsed =
    elapsedRunMs(
      run.createdAt,
      now,
    );

  return (
    <Dialog
      open
      onOpenChange={
        onOpenChange
      }
    >
      <DialogContent
        showCloseButton={
          false
        }
        className="flex h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-[1800px] min-w-0 flex-col gap-0 overflow-hidden rounded-lg border border-border-default bg-bg-app p-0 shadow-lg sm:h-[calc(100dvh-2rem)] sm:w-[calc(100vw-2rem)] sm:max-w-[1800px]"
      >
        <DialogHeader className="shrink-0 gap-0 border-b border-border-default bg-surface-elevated px-4 py-3">
          <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <DialogTitle
                title={
                  taskTitle
                }
                className="truncate text-sm font-semibold text-text-primary"
              >
                {taskTitle}
              </DialogTitle>

              <DialogDescription className="sr-only">
                Read-only
                active run
                terminal and
                execution
                details.
              </DialogDescription>
            </div>

            <div className="grid min-w-0 flex-1 grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4 lg:max-w-4xl">
              <HeaderFact
                label="Project"
                value={projectNameFromPath(
                  run.projectPath,
                )}
              />

              <div className="min-w-0">
                <p className="text-[9px] font-medium uppercase tracking-wide text-text-muted">
                  Run Status
                </p>

                <div className="mt-0.5">
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
                </div>
              </div>

              <HeaderFact
                label="Current Agent"
                value={
                  currentAgentName
                }
              />

              <HeaderFact
                label="Elapsed"
                value={formatDuration(
                  elapsed,
                )}
                className="font-mono tabular-nums"
              />
            </div>
          </div>
        </DialogHeader>

        {monitoringWarning ? (
          <div
            role="status"
            className="flex min-h-8 shrink-0 items-center gap-2 border-b border-status-warning/30 bg-status-warning/5 px-4 text-[10px] text-status-warning"
          >
            <CircleAlertIcon className="size-3.5 shrink-0" />

            <span className="min-w-0 truncate">
              {
                monitoringWarning
              }
            </span>
          </div>
        ) : null}

        <div className="grid min-h-0 min-w-0 flex-1 gap-3 overflow-y-auto p-3 min-[1100px]:grid-cols-[minmax(0,3fr)_minmax(16rem,1fr)] min-[1100px]:items-stretch min-[1100px]:overflow-hidden">
          <div className="min-h-[18rem] min-w-0 min-[1100px]:min-h-0">
            {selectedExecution ? (
              <AgentExecutionTerminal
                key={
                  selectedExecution.id
                }
                executionId={
                  selectedExecution.id
                }
                title={`${selectedExecution.agentName} Terminal`}
                className="h-full min-h-0"
                heightClassName="min-h-[18rem] flex-1 min-[1100px]:min-h-0"
              />
            ) : (
              <WaitingExecutionPanel />
            )}
          </div>

          <RunExecutionInspector
            execution={
              selectedExecution
            }
            className="h-auto min-h-[16rem] min-[1100px]:h-full min-[1100px]:min-h-0"
          />
        </div>

        <DialogFooter className="mx-0 mb-0 shrink-0 rounded-none border-t border-border-default bg-surface-elevated p-3 sm:justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              onOpenChange(
                false,
              )
            }
          >
            Close
          </Button>

          <Button
            type="button"
            onClick={
              onOpenRunDetail
            }
          >
            Open Run
            Detail
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
