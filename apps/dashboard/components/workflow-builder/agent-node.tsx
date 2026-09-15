"use client";

import { UserIcon } from "lucide-react";
import { Handle, Position, type NodeProps } from "@xyflow/react";

import type { Agent, AgentRouteOutcome } from "@orc/shared";

import { Badge } from "@/components/ui/badge";
import { OUTCOME_LABELS, WORKFLOW_OUTCOMES } from "@/lib/workflow-graph-draft";

export type AgentNodeData = {
  agentId: string;
  agent: Agent | null;
  invalid: boolean;
};

const OUTCOME_ABBREVIATIONS: Record<AgentRouteOutcome, string> = {
  completed: "Comp",
  approved: "Appr",
  changes_requested: "CR",
  blocked: "Blk",
  failed: "Fail",
};

const OUTCOME_OFFSETS: Record<AgentRouteOutcome, string> = {
  completed: "10%",
  approved: "30%",
  changes_requested: "50%",
  blocked: "70%",
  failed: "90%",
};

/**
 * Displays only high-value identity/runtime information per roadmap
 * section 16 -- name, Department/role, effective harness/model, enabled
 * state. Full Agent settings still open through the existing Agent
 * drawer, not here. One target handle on top (incoming); one labeled
 * source handle per fixed outcome along the bottom (outgoing) so
 * dragging from a specific port *is* the outcome selection.
 */
export function AgentNode({ data, selected }: NodeProps & { data: AgentNodeData }) {
  const agent = data.agent;

  return (
    <div
      className={`workflow-node relative flex min-w-60 flex-col gap-1 rounded-lg px-3 pb-5 pt-2.5 ${
        selected ? "workflow-node--selected" : ""
      } ${data.invalid ? "workflow-node--invalid" : ""}`}
    >
      <Handle type="target" position={Position.Top} className="!size-2.5" />

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <UserIcon className="size-3.5 shrink-0 text-text-muted" />
          <span className="workflow-node-title truncate text-sm font-medium">
            {agent?.name ?? "Unavailable Agent"}
          </span>
        </div>
        <Badge variant={agent?.enabled ? "success" : "disabled"} className="shrink-0">
          {agent?.enabled ? "Enabled" : "Disabled"}
        </Badge>
      </div>

      <p className="workflow-node-subtitle truncate text-xs">
        {agent?.department.name ?? "Unknown Department"} · {agent?.effective.role ?? "Unknown role"}
      </p>

      <p className="workflow-node-meta truncate text-[11px]">
        {agent?.effective.harness ?? "?"} · {agent?.effective.model ?? "?"}
      </p>

      {WORKFLOW_OUTCOMES.map((outcome) => (
        <Handle
          key={outcome}
          type="source"
          position={Position.Bottom}
          id={outcome}
          title={OUTCOME_LABELS[outcome]}
          style={{ left: OUTCOME_OFFSETS[outcome] }}
          className="!size-2.5"
        />
      ))}

      {WORKFLOW_OUTCOMES.map((outcome) => (
        <span
          key={outcome}
          className="workflow-node-meta pointer-events-none absolute bottom-0.5 -translate-x-1/2 whitespace-nowrap text-[9px] leading-none"
          style={{ left: OUTCOME_OFFSETS[outcome] }}
        >
          {OUTCOME_ABBREVIATIONS[outcome]}
        </span>
      ))}
    </div>
  );
}
