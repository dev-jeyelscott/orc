"use client";

import type {
  ReactNode,
} from "react";
import {
  CircleAlertIcon,
  CircleDotIcon,
  LoaderCircleIcon,
  RotateCcwIcon,
  SquareIcon,
} from "lucide-react";

import type {
  RunMonitoringDetail,
} from "@orc/shared";

import { RunExecutionsTable } from "@/components/run-executions-table";
import { RunInspectorDrawer } from "@/components/run-inspector-drawer";
import { RunWorkflowPipeline } from "@/components/run-workflow-pipeline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  currentRunStateLabel,
  executionProgress,
  isRunActive,
  isRunRetryable,
  runStatusVariant,
} from "@/lib/run-detail-state";
import {
  findLatestFailure,
  formatDateTime,
  formatStatusLabel,
  projectNameFromPath,
  shortIdentifier,
} from "@/lib/run-observability";

interface SelectedRunWorkspaceProps {
  detail:
    | RunMonitoringDetail
    | null;
  loading: boolean;
  error:
    | string
    | null;
  actionError:
    | string
    | null;
  actionPending:
    | "cancel"
    | "retry"
    | null;
  onReload: () => void;
  onCancel: () => void;
  onRetry: () => void;
}

interface RunSummaryFieldProps {
  label: string;
  value: string;
  detail?: ReactNode;
}

/**
 * Renders authoritative selected-run state, recovery controls, workflow progression, and executions.
 */
export function SelectedRunWorkspace({
  detail,
  loading,
  error,
  actionError,
  actionPending,
  onReload,
  onCancel,
  onRetry,
}: SelectedRunWorkspaceProps) {
  if (
    loading &&
    !detail
  ) {
    return (
      <Card className="min-h-80">
        <CardContent className="flex min-h-80 items-center justify-center gap-2 text-sm text-text-muted">
          <LoaderCircleIcon className="size-4 animate-spin motion-reduce:animate-none" />
          Loading
          selected
          run...
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border-status-error/40">
        <CardContent className="flex min-h-64 flex-col items-center justify-center gap-3 text-center">
          <CircleAlertIcon className="size-5 text-status-error" />

          <p className="max-w-lg text-sm text-status-error">
            {error}
          </p>

          <Button
            variant="outline"
            size="sm"
            onClick={
              onReload
            }
          >
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!detail) {
    return (
      <Card className="min-h-80">
        <CardContent className="flex min-h-80 flex-col items-center justify-center gap-2 text-center">
          <CircleDotIcon className="size-5 text-text-muted" />

          <p className="text-sm font-medium text-text-secondary">
            Select a run
          </p>

          <p className="text-xs text-text-muted">
            Choose a run
            from the
            navigator to
            inspect its
            execution
            state.
          </p>
        </CardContent>
      </Card>
    );
  }

  const planned =
    detail.executionPlan.length;

  const currentAgent =
    detail.executionPlan.find(
      (agent) =>
        agent.id ===
        detail.run
          .currentAgentId,
    ) ?? null;

  const active =
    isRunActive(
      detail.run.status,
    );

  const retryable =
    isRunRetryable(
      detail.run.status,
    );

  const failure =
    retryable
      ? findLatestFailure(
          detail,
        )
      : null;

  const progress =
    executionProgress(
      detail.run
        .executionCount,
      planned,
    );

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Card className="min-w-0">
        <CardHeader className="gap-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <CardTitle className="min-w-0 truncate text-base">
                  {detail.task
                    ?.title ??
                    "Workflow run"}
                </CardTitle>

                <Badge
                  variant={runStatusVariant(
                    detail.run
                      .status,
                  )}
                  className="h-4 px-1.5 text-[9px] uppercase"
                >
                  {formatStatusLabel(
                    detail.run
                      .status,
                  )}
                </Badge>
              </div>

              <p className="mt-1 truncate text-xs text-text-muted">
                Project:{" "}
                {projectNameFromPath(
                  detail.run
                    .projectPath,
                )}
                {detail.task
                  ? ` / Task ${shortIdentifier(
                      detail.task
                        .id,
                    )}`
                  : ""}
              </p>
            </div>

            <div className="flex shrink-0 flex-wrap gap-2">
              <RunInspectorDrawer
                detail={
                  detail
                }
              />

              {active ? (
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={
                    actionPending !==
                    null
                  }
                  onClick={
                    onCancel
                  }
                >
                  <SquareIcon className="size-3.5" />
                  {actionPending ===
                  "cancel"
                    ? "Cancelling..."
                    : "Cancel Run"}
                </Button>
              ) : null}

              {retryable ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={
                    actionPending !==
                    null
                  }
                  onClick={
                    onRetry
                  }
                >
                  <RotateCcwIcon className="size-3.5" />
                  {actionPending ===
                  "retry"
                    ? "Retrying..."
                    : "Retry"}
                </Button>
              ) : null}
            </div>
          </div>
        </CardHeader>

        <CardContent>
          <div className="grid gap-4 border-t border-divider pt-4 sm:grid-cols-2 xl:grid-cols-4">
            <RunSummaryField
              label="Current Agent"
              value={
                currentAgent
                  ?.name ??
                "Unavailable"
              }
            />

            <RunSummaryField
              label="Executions"
              value={
                planned > 0
                  ? `${detail.run.executionCount} / ${planned}`
                  : `${detail.run.executionCount} attempts`
              }
              detail={
                planned >
                0 ? (
                  <Progress
                    value={
                      progress
                    }
                    aria-label="Run execution progress"
                    className="mt-1.5 max-w-32 [&_[data-slot=progress-indicator]]:bg-status-running"
                  />
                ) : null
              }
            />

            <RunSummaryField
              label="Current State"
              value={currentRunStateLabel(
                detail,
              )}
            />

            <RunSummaryField
              label="Last Update"
              value={formatDateTime(
                detail.run
                  .updatedAt,
              )}
            />
          </div>

          {failure ? (
            <div
              role="alert"
              className="mt-4 flex items-start gap-2 rounded-lg border border-status-error/40 bg-status-error/5 p-3"
            >
              <CircleAlertIcon className="mt-0.5 size-4 shrink-0 text-status-error" />

              <div className="min-w-0">
                <p className="text-xs font-medium text-status-error">
                  Latest
                  failure
                </p>

                <p className="mt-1 line-clamp-2 text-xs leading-5 text-text-secondary">
                  {failure}
                </p>
              </div>
            </div>
          ) : null}

          {actionError ? (
            <p
              role="alert"
              className="mt-4 text-xs text-status-error"
            >
              {
                actionError
              }
            </p>
          ) : null}
        </CardContent>
      </Card>

      <RunWorkflowPipeline
        detail={
          detail
        }
      />

      <RunExecutionsTable
        executions={
          detail.executions
        }
      />
    </div>
  );
}

/**
 * Renders one high-signal selected-run summary value with optional supplemental visualization.
 */
function RunSummaryField({
  label,
  value,
  detail,
}: RunSummaryFieldProps) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-medium uppercase tracking-wide text-text-muted">
        {label}
      </p>

      <p className="mt-1 truncate text-xs font-medium text-text-primary">
        {value}
      </p>

      {detail}
    </div>
  );
}
