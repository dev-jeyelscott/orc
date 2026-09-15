"use client";

import { AlertTriangleIcon, CheckCircle2Icon, XCircleIcon } from "lucide-react";

import type { WorkflowValidationIssue, WorkflowValidationResult } from "@orc/shared";

import { focusTargetForIssue } from "@/lib/workflow-graph-draft";

/**
 * Structured blocking errors, non-blocking warnings, and publish
 * readiness. Clicking an issue focuses/selects the related node or edge
 * when an ID is available.
 */
export function ValidationPanel({
  validation,
  onFocusIssue,
  labelForNode,
}: {
  validation: WorkflowValidationResult;
  onFocusIssue: (target: { kind: "node"; id: string } | { kind: "edge"; id: string }) => void;
  labelForNode?: (nodeId: string) => string;
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
      {[...validation.errors, ...validation.warnings].reduce<WorkflowValidationIssue[][]>((groups, issue) => {
        const key = `${issue.severity}:${issue.nodeId ?? "workflow"}:${issue.code}`;
        const group = groups.find((candidate) => `${candidate[0]!.severity}:${candidate[0]!.nodeId ?? "workflow"}:${candidate[0]!.code}` === key);
        if (group) group.push(issue);
        else groups.push([issue]);
        return groups;
      }, []).map((issues, index) => {
        const issue = issues[0]!;
        const target = focusTargetForIssue(issue);
        const isError = issue.severity === "error";
        const message = issues.length === 1 ? issue.message : `${issues.length} ${issue.code.replaceAll("_", " ")} issues`;

        return (
          <button
            key={`${issue.severity}-${issue.nodeId ?? "workflow"}-${issue.code}-${index}`}
            type="button"
            disabled={!target}
            onClick={() => target && onFocusIssue(target)}
            className={`flex items-start gap-1.5 rounded-md border px-2 py-1.5 text-left text-xs disabled:cursor-default ${
              isError ? "border-destructive/30 bg-destructive/5 text-destructive" : "border-status-warning/30 bg-status-warning/5 text-status-warning"
            }`}
          >
            {isError ? <XCircleIcon className="mt-0.5 size-3.5 shrink-0" /> : <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />}
            <span>
              {issue.nodeId && labelForNode ? <span className="font-medium">{labelForNode(issue.nodeId)}: </span> : null}
              {message}
            </span>
          </button>
        );
      })}
    </div>
  );
}
