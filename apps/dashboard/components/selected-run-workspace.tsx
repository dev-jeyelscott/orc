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
  RunMonitoringSummary,
} from "@orc/shared";

import { RunExecutionsTable } from "@/components/run-executions-table";
import { RunInspectorDrawer } from "@/components/run-inspector-drawer";
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
  deriveWorkflowSteps,
  findLatestFailure,
  formatDateTime,
  formatDuration,
  formatStatusLabel,
  projectNameFromPath,
  shortIdentifier,
  type WorkflowStep,
  type WorkflowStepState,
} from "@/lib/run-observability";
import { cn } from "@/lib/utils";

type BadgeVariant =
  | "running"
  | "success"
  | "warning"
  | "error"
  | "neutral";

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

interface WorkflowPipelineProps {
  detail: RunMonitoringDetail;
}

interface WorkflowPipelineStepProps {
  step: WorkflowStep;
  index: number;
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
 * Maps one derived workflow step onto a semantic status badge.
 */
function workflowStateVariant(
  state: WorkflowStepState,
): BadgeVariant {
  switch (state) {
    case "running":
      return "running";
    case "completed":
      return "success";
    case "failed":
      return "error";
    case "blocked":
      return "warning";
    case "cancelled":
    case "waiting":
    default:
      return "neutral";
  }
}

/**
 * Returns the semantic border and surface classes for one workflow pipeline node.
 */
function workflowStepClasses(
  state: WorkflowStepState,
): string {
  switch (state) {
    case "completed":
      return "border-status-success/40 bg-status-success/5";
    case "running":
      return "border-status-running/50 bg-status-running/5";
    case "failed":
      return "border-status-error/50 bg-status-error/5";
    case "blocked":
      return "border-status-warning/50 bg-status-warning/5";
    case "cancelled":
    case "waiting":
    default:
      return "border-border-default bg-surface-interactive/30";
  }
}

/**
 * Resolves the operator-facing current state from persisted run and active execution state.
 */
function currentStateLabel(
  detail: RunMonitoringDetail,
): string {
  const currentExecution =
    [...detail.executions]
      .reverse()
      .find((execution) =>
        [
          "starting",
          "running",
        ].includes(
          execution.status,
        ),
      );

  if (
    currentExecution?.status ===
    "starting"
  ) {
    return "Starting";
  }

  if (
    currentExecution?.status ===
    "running"
  ) {
    return "Executing";
  }

  return formatStatusLabel(
    detail.run.status,
  );
}

/**
 * Converts current execution attempts into bounded planned workflow progress.
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
          Loading selected run...
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
            Choose a run from the navigator to inspect its execution state.
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
        detail.run.currentAgentId,
    ) ?? null;

  const active =
    detail.run.status ===
      "running" ||
    detail.run.status ===
      "pending";

  const retryable =
    detail.run.status ===
      "failed" ||
    detail.run.status ===
      "blocked";

  const failure =
    retryable
      ? findLatestFailure(
          detail,
        )
      : null;

  const progress =
    executionProgress(
      detail.run.executionCount,
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
                    detail.run.status,
                  )}
                  className="h-4 px-1.5 text-[9px] uppercase"
                >
                  {formatStatusLabel(
                    detail.run.status,
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
                  ? `  /  Task ${shortIdentifier(
                      detail.task.id,
                    )}`
                  : ""}
              </p>
            </div>

            <div className="flex shrink-0 flex-wrap gap-2">
              <RunInspectorDrawer
                detail={detail}
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
                planned > 0 ? (
                  <Progress
                    value={progress}
                    className="mt-1.5 max-w-32 [&_[data-slot=progress-indicator]]:bg-status-running"
                  />
                ) : null
              }
            />

            <RunSummaryField
              label="Current State"
              value={currentStateLabel(
                detail,
              )}
            />

            <RunSummaryField
              label="Last Update"
              value={formatDateTime(
                detail.run.updatedAt,
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
                  Latest failure
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
              {actionError}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <WorkflowPipeline
        detail={detail}
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

/**
 * Renders generic workflow progression from the immutable execution-plan snapshot.
 */
function WorkflowPipeline({
  detail,
}: WorkflowPipelineProps) {
  const steps =
    deriveWorkflowSteps(
      detail,
    );

  return (
    <Card className="min-w-0">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>
          Workflow / Execution Pipeline
        </CardTitle>

        <span className="text-[11px] text-text-muted">
          {steps.length
            ? `${steps.length} configured agents`
            : "Snapshot unavailable"}
        </span>
      </CardHeader>

      <CardContent>
        {steps.length ? (
          <div className="overflow-x-auto pb-1">
            <div className="flex min-w-max items-stretch">
              {steps.map(
                (
                  step,
                  index,
                ) => (
                  <div
                    key={step.id}
                    className="flex items-center"
                  >
                    <WorkflowPipelineStep
                      step={step}
                      index={index}
                    />

                    {index <
                    steps.length -
                      1 ? (
                      <div className="mx-2 h-px w-7 shrink-0 bg-divider" />
                    ) : null}
                  </div>
                ),
              )}
            </div>
          </div>
        ) : (
          <p className="text-sm text-text-muted">
            This run does not expose a valid workflow snapshot.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Renders one generic workflow-plan agent with its derived persisted execution state.
 */
function WorkflowPipelineStep({
  step,
  index,
}: WorkflowPipelineStepProps) {
  return (
    <div
      className={cn(
        "w-44 shrink-0 rounded-lg border p-3",
        workflowStepClasses(
          step.state,
        ),
      )}
    >
      <div className="flex items-start gap-2.5">
        <div
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold",
            step.state ===
              "completed" &&
              "border-status-success text-status-success",
            step.state ===
              "running" &&
              "border-status-running text-status-running",
            step.state ===
              "failed" &&
              "border-status-error text-status-error",
            step.state ===
              "blocked" &&
              "border-status-warning text-status-warning",
            [
              "waiting",
              "cancelled",
            ].includes(
              step.state,
            ) &&
              "border-border-strong text-text-muted",
          )}
        >
          {index + 1}
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-text-primary">
            {step.name}
          </p>

          <p className="mt-0.5 text-[9px] text-text-muted">
            Layer {step.layer}
            {"  /  "}
            Order{" "}
            {step.executionOrder}
          </p>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <Badge
          variant={workflowStateVariant(
            step.state,
          )}
          className="h-4 max-w-24 px-1.5 text-[9px]"
        >
          {step.state ===
          "waiting"
            ? "Waiting"
            : formatStatusLabel(
                step.outcome,
              )}
        </Badge>

        <span className="text-[9px] text-text-muted">
          {step.attemptCount > 1
            ? `${step.attemptCount} attempts`
            : step.durationMs !==
                null
              ? formatDuration(
                  step.durationMs,
                )
              : ""}
        </span>
      </div>
    </div>
  );
}
