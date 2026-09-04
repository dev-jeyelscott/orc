"use client";

import type {
  RunMonitoringDetail,
} from "@orc/shared";

import { Badge } from "@/components/ui/badge";
import {
  Card,
} from "@/components/ui/card";
import {
  deriveWorkflowSteps,
  formatDuration,
  formatStatusLabel,
  type WorkflowStep,
  type WorkflowStepState,
} from "@/lib/run-observability";
import type {
  RunBadgeVariant,
} from "@/lib/run-detail-state";
import { cn } from "@/lib/utils";

interface RunWorkflowPipelineProps {
  detail:
    RunMonitoringDetail;
  dense?: boolean;
}

/**
 * Maps one derived workflow state onto a semantic design-system badge.
 */
function workflowStateVariant(
  state:
    WorkflowStepState,
): RunBadgeVariant {
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
 * Returns the semantic node border and surface treatment for one workflow state.
 */
function workflowStepClasses(
  state:
    WorkflowStepState,
): string {
  switch (state) {
    case "completed":
      return "border-status-success/40 bg-status-success/5";
    case "running":
      return "border-status-running/60 bg-status-running/5";
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
 * Returns the concise status label rendered inside one fixed-height pipeline node.
 */
function workflowStepLabel(
  step: WorkflowStep,
): string {
  if (
    step.state ===
    "waiting"
  ) {
    return "Waiting";
  }

  return formatStatusLabel(
    step.outcome,
  );
}

/**
 * Renders the horizontally scrolling sequence of immutable workflow-plan agents.
 */
function WorkflowNodes({
  steps,
}: {
  steps:
    WorkflowStep[];
}) {
  return (
    <div className="min-w-0 overflow-x-auto">
      <div className="flex min-w-max items-stretch">
        {steps.map(
          (
            step,
            index,
          ) => (
            <div
              key={
                step.id
              }
              className="flex items-center"
            >
              <WorkflowPipelineStep
                step={
                  step
                }
                index={
                  index
                }
              />

              {index <
              steps.length -
                1 ? (
                <div
                  aria-hidden="true"
                  className="mx-1.5 h-px w-3 shrink-0 bg-divider"
                />
              ) : null}
            </div>
          ),
        )}
      </div>
    </div>
  );
}

/**
 * Renders one fixed-height configured agent node without implying same-layer parallelism.
 */
function WorkflowPipelineStep({
  step,
  index,
}: {
  step:
    WorkflowStep;
  index: number;
}) {
  return (
    <div
      className={cn(
        "flex h-[60px] w-40 shrink-0 flex-col justify-between rounded-md border px-2.5 py-2",
        workflowStepClasses(
          step.state,
        ),
      )}
    >
      <div className="flex min-w-0 items-start gap-2">
        <div
          className={cn(
            "flex size-5 shrink-0 items-center justify-center rounded-full border text-[9px] font-semibold tabular-nums",
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
          <p
            title={
              step.name
            }
            className="truncate text-[11px] font-medium leading-4 text-text-primary"
          >
            {step.name}
          </p>

          <p className="truncate text-[9px] leading-3 text-text-muted">
            Layer{" "}
            {step.layer}
            {" · "}
            Order{" "}
            {
              step.executionOrder
            }
            {step.attemptCount >
            1
              ? ` · Attempt ${step.attemptCount}`
              : ""}
          </p>
        </div>
      </div>

      <div className="flex min-w-0 items-center justify-between gap-2 ps-7">
        <Badge
          variant={workflowStateVariant(
            step.state,
          )}
          className="h-4 max-w-24 truncate px-1.5 text-[9px]"
        >
          {workflowStepLabel(
            step,
          )}
        </Badge>

        <span className="shrink-0 text-[9px] tabular-nums text-text-muted">
          {step.durationMs !==
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

/**
 * Renders workflow progression from the immutable run snapshot in overview or dense detail mode.
 */
export function RunWorkflowPipeline({
  detail,
  dense = false,
}: RunWorkflowPipelineProps) {
  const steps =
    deriveWorkflowSteps(
      detail,
    );

  if (dense) {
    return (
      <section
        aria-labelledby="run-workflow-pipeline-title"
        className="min-w-0 overflow-hidden rounded-lg border border-border-default bg-surface-card p-2 shadow-xs"
      >
        <h2
          id="run-workflow-pipeline-title"
          className="sr-only"
        >
          Workflow
          pipeline
        </h2>

        {steps.length ? (
          <WorkflowNodes
            steps={
              steps
            }
          />
        ) : (
          <div className="flex h-[60px] items-center px-2 text-xs text-text-muted">
            Workflow
            snapshot
            unavailable.
          </div>
        )}
      </section>
    );
  }

  return (
    <Card className="min-w-0 gap-0 rounded-lg border border-border-default bg-surface-card py-0 shadow-xs ring-0">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-divider px-3">
        <h2 className="font-heading text-xs font-medium text-text-primary">
          Workflow /
          Execution
          Pipeline
        </h2>

        <span className="text-[10px] text-text-muted">
          {steps.length
            ? `${steps.length} configured agents`
            : "Snapshot unavailable"}
        </span>
      </div>

      <div className="p-2">
        {steps.length ? (
          <WorkflowNodes
            steps={
              steps
            }
          />
        ) : (
          <div className="flex h-[60px] items-center px-2 text-xs text-text-muted">
            This run does
            not expose a
            valid workflow
            snapshot.
          </div>
        )}
      </div>
    </Card>
  );
}
