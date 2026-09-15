import assert from "node:assert/strict";
import test from "node:test";
import { deriveWorkflowPresentation } from "./workflow-graph-presentation.ts";

const node = (id, kind = "agent", y = 0) => kind === "agent"
  ? { id, kind, agentId: "00000000-0000-4000-8000-000000000001", position: { x: 0, y } }
  : { id, kind, position: { x: 0, y } };
const edge = (id, sourceNodeId, targetNodeId, outcome = null) => ({ id, sourceNodeId, targetNodeId, outcome });
const graph = (edges) => ({ nodes: [node("start", "start", 0), node("a", "agent", 100), node("b", "agent", 200), node("c", "agent", 300)], edges });

test("simplified presentation groups success routes without changing canonical edges", () => {
  const canonical = graph([edge("start-edge", "start", "a"), edge("completed", "a", "b", "completed"), edge("approved", "a", "b", "approved"), edge("failed", "a", "c", "failed")]);
  const before = JSON.stringify(canonical);
  const result = deriveWorkflowPresentation({ graph: canonical, mode: "simplified" });
  assert.equal(result.length, 2);
  assert.deepEqual(result.find((item) => item.sourceNodeId === "a").outcomes, ["completed", "approved"]);
  assert.deepEqual(result.find((item) => item.sourceNodeId === "a").underlyingEdgeIds, ["approved", "completed"]);
  assert.equal(JSON.stringify(canonical), before);
});

test("presentation reveals exceptional routes only on selection or all-routes mode", () => {
  const canonical = graph([edge("completed", "a", "b", "completed"), edge("failed", "a", "c", "failed")]);
  assert.equal(deriveWorkflowPresentation({ graph: canonical, mode: "simplified" }).length, 1);
  assert.equal(deriveWorkflowPresentation({ graph: canonical, mode: "simplified", selectedNodeId: "a" }).length, 2);
  assert.equal(deriveWorkflowPresentation({ graph: canonical, mode: "all_routes" }).length, 2);
});

test("missing outcomes never produce presentation edges and distinct targets remain branches", () => {
  const canonical = graph([edge("completed", "a", "b", "completed"), edge("approved", "a", "c", "approved")]);
  const result = deriveWorkflowPresentation({ graph: canonical, mode: "simplified" });
  assert.equal(result.length, 2);
  assert.equal(result.every((item) => item.underlyingEdgeIds.length === 1), true);
});

test("focused hidden and self routes remain representable without a graph mutation", () => {
  const canonical = graph([edge("retry", "b", "a", "changes_requested"), edge("self", "a", "a", "blocked")]);
  const focused = deriveWorkflowPresentation({ graph: canonical, mode: "simplified", focusedEdgeId: "retry" });
  assert.equal(focused.length, 1);
  assert.equal(focused[0].backward, true);
  const selected = deriveWorkflowPresentation({ graph: canonical, mode: "simplified", selectedNodeId: "a" });
  assert.equal(selected.find((item) => item.underlyingEdgeIds.includes("self")).backward, true);
});
