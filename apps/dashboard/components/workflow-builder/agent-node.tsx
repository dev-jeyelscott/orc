"use client";

import { UserIcon } from "lucide-react";
import { Handle, Position, type NodeProps } from "@xyflow/react";

import type { Agent } from "@orc/shared";

import { Badge } from "@/components/ui/badge";

export type AgentNodeData = {
  agentId: string;
  agent: Agent | null;
  invalid: boolean;
  routeCount: number;
};

/**
 * Displays only high-value identity/runtime information per roadmap
 * section 16 -- name, Department/role, effective harness/model, enabled
 * state. Full Agent settings and explicit outcome routing remain in the
 * Inspector. One unlabeled target and one unlabeled generic source handle
 * exist only for React Flow geometry; Agent-to-Agent routes are edited
 * accessibly through the Inspector rather than via outcome-specific ports.
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
      <Handle type="source" id="route" position={Position.Bottom} className="!size-2.5" />

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
      <p className="workflow-node-meta text-[11px]">{data.routeCount}/5 routes</p>
    </div>
  );
}
