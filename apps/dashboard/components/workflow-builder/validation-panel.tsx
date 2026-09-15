"use client";

import { AlertTriangleIcon, CheckCircle2Icon, XCircleIcon } from "lucide-react";

import type { WorkflowValidationResult } from "@orc/shared";

import { focusTargetForIssue } from "@/lib/workflow-graph-draft";

/**
 * Structured blocking errors, non-blocking warnings, and publish
 * readiness. Clicking an issue focuses/selects the related node or edge
 * when an ID is available.
 */
export function ValidationPanel({
  validation,
  onFocusIssue,
}: {
  validation: WorkflowValidationResult;
  onFocusIssue: (target: { kind: "node"; id: string } | { kind: "edge"; id: string }) => void;
}) {
  if (validation.errors.length === 0 && validation.warnings.length === 0) {
    return (
      <div className="flex items-center gap-2 text-xs text-status-success">
        <CheckCircle2Icon className="size-3.5" />
        No validation issues. This Draft is ready to publish.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {validation.errors.map((issue, index) => {
        const target = focusTargetForIssue(issue);

        return (
          <button
            key={`error-${index}`}
            type="button"
            disabled={!target}
            onClick={() => target && onFocusIssue(target)}
            className="flex items-start gap-1.5 rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-left text-xs text-destructive disabled:cursor-default"
          >
            <XCircleIcon className="mt-0.5 size-3.5 shrink-0" />
            {issue.message}
          </button>
        );
      })}

      {validation.warnings.map((issue, index) => {
        const target = focusTargetForIssue(issue);

        return (
          <button
            key={`warning-${index}`}
            type="button"
            disabled={!target}
            onClick={() => target && onFocusIssue(target)}
            className="flex items-start gap-1.5 rounded-md border border-status-warning/30 bg-status-warning/5 px-2 py-1.5 text-left text-xs text-status-warning disabled:cursor-default"
          >
            <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
            {issue.message}
          </button>
        );
      })}
    </div>
  );
}
