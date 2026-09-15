"use client";

import { CheckCircle2Icon, ShieldAlertIcon, XCircleIcon } from "lucide-react";
import { Handle, Position, type NodeProps } from "@xyflow/react";

import type { TerminalAction } from "@orc/shared";

import { TERMINAL_LABELS } from "@/lib/workflow-graph-draft";

const TERMINAL_ICON: Record<TerminalAction, typeof CheckCircle2Icon> = {
  complete_run: CheckCircle2Icon,
  block_run: ShieldAlertIcon,
  fail_run: XCircleIcon,
};

const TERMINAL_COLOR: Record<TerminalAction, string> = {
  complete_run: "text-status-success",
  block_run: "text-status-warning",
  fail_run: "text-status-error",
};

export type TerminalNodeData = {
  terminalAction: TerminalAction;
};

/** Non-deletable system node: one of Complete Run / Block Run / Fail Run. */
export function TerminalNode({ data, selected }: NodeProps & { data: TerminalNodeData }) {
  const Icon = TERMINAL_ICON[data.terminalAction];

  return (
    <div
      className={`workflow-node workflow-node--system flex items-center gap-2 rounded-lg px-3 py-2 ${
        selected ? "workflow-node--selected" : ""
      }`}
    >
      <Handle type="target" position={Position.Left} className="!size-2.5" />
      <Icon className={`size-4 ${TERMINAL_COLOR[data.terminalAction]}`} />
      <span className="workflow-node-title text-sm font-medium">
        {TERMINAL_LABELS[data.terminalAction]}
      </span>
    </div>
  );
}
