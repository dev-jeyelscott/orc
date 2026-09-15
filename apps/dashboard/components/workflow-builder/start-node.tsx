"use client";

import { PlayIcon } from "lucide-react";
import { Handle, Position, type NodeProps } from "@xyflow/react";

/** Non-deletable system node: the single entry point into the workflow. */
export function StartNode({ selected }: NodeProps) {
  return (
    <div
      className={`workflow-node workflow-node--system flex items-center gap-2 rounded-lg px-3 py-2 ${
        selected ? "workflow-node--selected" : ""
      }`}
    >
      <PlayIcon className="size-4 text-status-success" />
      <span className="workflow-node-title text-sm font-medium">Start</span>
      <Handle type="source" id="route" position={Position.Bottom} className="!size-2.5" />
    </div>
  );
}
