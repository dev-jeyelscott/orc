"use client";

import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from "@xyflow/react";

import type { AgentRouteOutcome } from "@orc/shared";

import { OUTCOME_LABELS } from "@/lib/workflow-graph-draft";

export type OutcomeEdgeData = {
  outcomes: AgentRouteOutcome[];
  underlyingEdgeIds: string[];
  backward: boolean;
};

/**
 * Renders one display connection for one-or-more persisted routes. Labels are
 * always textual; the edge data retains every canonical route ID.
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
  const [forwardPath, forwardLabelX, forwardLabelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: data?.backward ? 16 : 8,
    offset: data?.backward ? 72 : 24,
  });

  const gutterX = Math.max(sourceX, targetX) + 96;
  const edgePath = data?.backward
    ? `M ${sourceX},${sourceY} L ${gutterX},${sourceY} L ${gutterX},${targetY} L ${targetX},${targetY}`
    : forwardPath;
  const labelX = data?.backward ? gutterX : forwardLabelX;
  const labelY = data?.backward ? (sourceY + targetY) / 2 : forwardLabelY;

  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} />
      {data?.outcomes.length ? (
        <EdgeLabelRenderer>
          <div
            className={`workflow-edge-label pointer-events-none absolute px-1.5 py-0.5 text-[11px] font-medium ${
              selected ? "workflow-edge-label--selected" : ""
            }`}
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
          >
            {data.outcomes.map((outcome) => OUTCOME_LABELS[outcome]).join(" + ")}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}
