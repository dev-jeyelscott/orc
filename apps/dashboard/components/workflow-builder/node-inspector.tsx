"use client";

import { AlertTriangleIcon, SettingsIcon } from "lucide-react";

import type { Agent, WorkflowGraph } from "@orc/shared";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { OUTCOME_LABELS, outcomesForSourceNode, type AgentGraphNode } from "@/lib/workflow-graph-draft";

/**
 * Selected Agent node detail: identity plus all five derived outcome rows
 * and destination names. Absent edges show "Not configured" with warning
 * treatment -- never persisted as fake nullable edges.
 */
export function NodeInspector({
  node,
  agent,
  graph,
  labelForNode,
  readOnly,
  onEditAgent,
  onSelectOutcomeRow,
}: {
  node: AgentGraphNode;
  agent: Agent | null;
  graph: WorkflowGraph;
  labelForNode: (nodeId: string) => string;
  readOnly: boolean;
  onEditAgent: () => void;
  onSelectOutcomeRow: (edgeId: string | null, outcome: string) => void;
}) {
  const rows = outcomesForSourceNode(node.id, graph, labelForNode);

  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium text-text-primary">{agent?.name ?? "Unavailable Agent"}</p>
          <Badge variant={agent?.enabled ? "success" : "disabled"}>
            {agent?.enabled ? "Enabled" : "Disabled"}
          </Badge>
        </div>
        <p className="text-xs text-text-muted">
          {agent?.department.name ?? "Unknown Department"} · {agent?.effective.role ?? "Unknown role"}
        </p>
        <p className="text-xs text-text-muted">
          {agent?.effective.harness ?? "?"} · {agent?.effective.model ?? "?"}
        </p>
      </div>

      <Button type="button" variant="outline" size="sm" onClick={onEditAgent}>
        <SettingsIcon />
        Edit Agent settings
      </Button>

      <div className="flex flex-col gap-1.5">
        <h4 className="text-xs font-medium text-text-secondary">Outcome routing</h4>
        {rows.map((row) => (
          <button
            key={row.outcome}
            type="button"
            onClick={() => onSelectOutcomeRow(row.edgeId, row.outcome)}
            disabled={!row.edgeId}
            className="flex items-center justify-between gap-2 rounded-md border border-border-subtle px-2.5 py-1.5 text-left text-xs disabled:cursor-default"
          >
            <span className="font-medium text-text-primary">{OUTCOME_LABELS[row.outcome]}</span>
            <span
              className={
                row.configured
                  ? "text-text-secondary"
                  : "flex items-center gap-1 text-status-warning"
              }
            >
              {!row.configured ? <AlertTriangleIcon className="size-3" /> : null}
              {row.targetLabel}
            </span>
          </button>
        ))}
      </div>

      {readOnly ? (
        <p className="text-[11px] text-text-muted">
          This Published revision is read-only. Switch to Draft to make changes.
        </p>
      ) : null}
    </div>
  );
}
