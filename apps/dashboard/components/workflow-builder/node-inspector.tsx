"use client";

import { AlertTriangleIcon, SettingsIcon } from "lucide-react";

import type { Agent, AgentRouteOutcome, WorkflowGraph } from "@orc/shared";

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
  onSetOutcomeRoute,
  highlightedOutcomes = [],
}: {
  node: AgentGraphNode;
  agent: Agent | null;
  graph: WorkflowGraph;
  labelForNode: (nodeId: string) => string;
  readOnly: boolean;
  onEditAgent: () => void;
  onSetOutcomeRoute: (outcome: AgentRouteOutcome, targetNodeId: string | null) => void;
  highlightedOutcomes?: readonly AgentRouteOutcome[];
}) {
  const rows = outcomesForSourceNode(node.id, graph, labelForNode);
  const destinations = graph.nodes.filter((candidate) => candidate.kind !== "start");
  const highlighted = new Set(highlightedOutcomes);

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
          <label
            key={row.outcome}
            className={`flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-xs ${
              highlighted.has(row.outcome) ? "border-primary/50 bg-primary/5" : "border-border-subtle"
            }`}
          >
            <span className="font-medium text-text-primary">{OUTCOME_LABELS[row.outcome]}</span>
            <select
              aria-label={`${OUTCOME_LABELS[row.outcome]} destination`}
              value={row.targetNodeId ?? ""}
              disabled={readOnly}
              onChange={(event) => onSetOutcomeRoute(row.outcome, event.target.value || null)}
              className={`min-w-0 rounded border border-border-subtle bg-surface px-1.5 py-1 text-xs ${
                row.configured ? "text-text-secondary" : "text-status-warning"
              }`}
            >
              <option value="">Not configured</option>
              {destinations.map((destination) => (
                <option key={destination.id} value={destination.id}>
                  {labelForNode(destination.id)}
                </option>
              ))}
            </select>
            {!row.configured ? <AlertTriangleIcon className="size-3 shrink-0 text-status-warning" /> : null}
          </label>
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
