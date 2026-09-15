"use client";

import { UserIcon } from "lucide-react";
import { Handle, Position, type NodeProps } from "@xyflow/react";

import type { Agent } from "@orc/shared";

import { Badge } from "@/components/ui/badge";

export type AgentNodeData = {
  agentId: string;
  agent: Agent | null;
  invalid: boolean;
};

/**
 * Displays only high-value identity/runtime information per roadmap
 * section 16 -- name, Department/role, effective harness/model, enabled
 * state. Full Agent settings still open through the existing Agent
 * drawer, not here.
 */
export function AgentNode({ data, selected }: NodeProps & { data: AgentNodeData }) {
  const agent = data.agent;

  return (
    <div
      className={`workflow-node flex min-w-48 flex-col gap-1 rounded-lg px-3 py-2.5 ${
        selected ? "workflow-node--selected" : ""
      } ${data.invalid ? "workflow-node--invalid" : ""}`}
    >
      <Handle type="target" position={Position.Left} className="!size-2.5" />

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

      <Handle type="source" position={Position.Right} className="!size-2.5" />
    </div>
  );
}
