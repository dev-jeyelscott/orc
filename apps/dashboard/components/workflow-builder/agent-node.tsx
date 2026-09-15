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
 * Inspector, never by dragging between ports. The handles below exist only
 * as fixed visual anchors (per outcome, per the shared system route enum)
 * so edges leave/enter a consistent side of the node; all but the primary
 * top target are `isConnectable={false}` and play no part in the drag UX.
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
      <Handle
        type="target"
        id="target-back"
        position={Position.Bottom}
        style={{ left: "70%" }}
        isConnectable={false}
        className="!size-2.5"
      />

      <Handle
        type="source"
        id="source-completed"
        position={Position.Bottom}
        style={{ left: "35%" }}
        isConnectable={false}
        className="!size-2.5"
      />
      <Handle
        type="source"
        id="source-approved"
        position={Position.Bottom}
        isConnectable={false}
        className="!size-2.5"
      />
      <Handle
        type="source"
        id="source-changes_requested"
        position={Position.Top}
        style={{ left: "70%" }}
        isConnectable={false}
        className="!size-2.5"
      />
      <Handle
        type="source"
        id="source-blocked"
        position={Position.Right}
        isConnectable={false}
        className="!size-2.5"
      />
      <Handle
        type="source"
        id="source-failed"
        position={Position.Left}
        isConnectable={false}
        className="!size-2.5"
      />

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
