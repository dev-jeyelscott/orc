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
// Beyond one rank step (node height + rank separation, see workflow-graph-draft.ts),
// a backward edge risks crossing intervening nodes -- route it through a side gutter
// instead of trusting the smoothstep algorithm to avoid overlaps on its own.
const FAR_BACKWARD_THRESHOLD = 260;

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
  const isFarBackward = Boolean(data?.backward) && Math.abs(sourceY - targetY) > FAR_BACKWARD_THRESHOLD;

  const [forwardPath, forwardLabelX, forwardLabelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: data?.backward ? 12 : 8,
    offset: data?.backward ? 16 : 24,
  });

  const gutterX = Math.max(sourceX, targetX) + 96;
  const edgePath = isFarBackward
    ? `M ${sourceX},${sourceY} L ${gutterX},${sourceY} L ${gutterX},${targetY} L ${targetX},${targetY}`
    : forwardPath;
  const labelX = isFarBackward ? gutterX : forwardLabelX;
  const labelY = isFarBackward ? (sourceY + targetY) / 2 : forwardLabelY;

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
