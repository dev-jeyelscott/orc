"use client";

import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from "@xyflow/react";

import type { AgentRouteOutcome } from "@orc/shared";

import { OUTCOME_LABELS } from "@/lib/workflow-graph-draft";

export type OutcomeEdgeData = {
  outcome: AgentRouteOutcome | null;
};

/**
 * Renders every Agent outcome edge with a persistent, readable text label
 * (never color-only, per roadmap section 16). The Start edge (null
 * outcome) renders with no label. Reuses the dashed-stroke classes from
 * `globals.css`'s `.agents-react-flow` block via the `outcome`/`default`
 * class names on the wrapping pane.
 */
export function OutcomeEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
  markerEnd,
}: EdgeProps & { data?: OutcomeEdgeData }) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} />
      {data?.outcome ? (
        <EdgeLabelRenderer>
          <div
            className={`workflow-edge-label pointer-events-none absolute px-1.5 py-0.5 text-[11px] font-medium ${
              selected ? "workflow-edge-label--selected" : ""
            }`}
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
          >
            {OUTCOME_LABELS[data.outcome]}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}
