import assert from "node:assert/strict";
import test from "node:test";

import {
  autoLayoutGraph,
  availableOutcomesForNewEdge,
  boundedPosition,
  buildPaletteAgents,
  canAddAgentNode,
  findStartEdge,
  focusTargetForIssue,
  outcomesForSourceNode,
  setOutcomeRoute,
} from "./workflow-graph-draft.ts";

function agent(id, name = id) {
  return { id, name, department: { name: "Department" } };
}

function startNode(id, x = 0, y = 0) {
  return { id, kind: "start", position: { x, y } };
}

function agentNode(id, agentId, x = 0, y = 0) {
  return { id, kind: "agent", agentId, position: { x, y } };
}

function terminalNode(id, terminalAction, x = 0, y = 0) {
  return { id, kind: "terminal", terminalAction, position: { x, y } };
}

function edge(id, sourceNodeId, targetNodeId, outcome = null) {
  return { id, sourceNodeId, targetNodeId, outcome };
}

test("buildPaletteAgents excludes Agents already placed as nodes", () => {
  const graph = { nodes: [agentNode("n1", "a")], edges: [] };
  const teamAgents = [agent("a"), agent("b")];

  const palette = buildPaletteAgents(teamAgents, graph);

  assert.deepEqual(palette.map((a) => a.id), ["b"]);
});

test("canAddAgentNode prevents duplicate Agent placement", () => {
  const graph = { nodes: [agentNode("n1", "a")], edges: [] };

  assert.equal(canAddAgentNode("a", graph), false);
  assert.equal(canAddAgentNode("b", graph), true);
});

test("outcomesForSourceNode derives all five outcomes, marking unconfigured ones Not configured", () => {
  const graph = {
    nodes: [agentNode("n1", "a"), agentNode("n2", "b")],
    edges: [edge("e1", "n1", "n2", "completed")],
  };

  const rows = outcomesForSourceNode("n1", graph, (id) => (id === "n2" ? "Agent B" : id));

  assert.equal(rows.length, 5);
  const completed = rows.find((row) => row.outcome === "completed");
  assert.equal(completed.configured, true);
  assert.equal(completed.targetLabel, "Agent B");

  const approved = rows.find((row) => row.outcome === "approved");
  assert.equal(approved.configured, false);
  assert.equal(approved.targetLabel, "Not configured");
  assert.equal(approved.edgeId, null);
});

test("availableOutcomesForNewEdge excludes already-assigned outcomes", () => {
  const graph = {
    nodes: [agentNode("n1", "a"), agentNode("n2", "b")],
    edges: [edge("e1", "n1", "n2", "completed"), edge("e2", "n1", "n2", "approved")],
  };

  assert.deepEqual(availableOutcomesForNewEdge("n1", graph), [
    "changes_requested",
    "blocked",
    "failed",
  ]);
});

test("setOutcomeRoute adds, retargets, and clears only the selected canonical outcome", () => {
  const graph = {
    nodes: [agentNode("n1", "a"), agentNode("n2", "b"), agentNode("n3", "c")],
    edges: [edge("e1", "n1", "n2", "completed"), edge("e2", "n1", "n2", "approved")],
  };
  const retargeted = setOutcomeRoute(graph, "n1", "completed", "n3", () => "new");
  assert.equal(retargeted.edges.find((item) => item.id === "e1").targetNodeId, "n3");
  assert.equal(retargeted.edges.find((item) => item.id === "e2").targetNodeId, "n2");
  const added = setOutcomeRoute(retargeted, "n1", "blocked", "n2", () => "new");
  assert.equal(added.edges.find((item) => item.id === "new").outcome, "blocked");
  const cleared = setOutcomeRoute(added, "n1", "completed", null, () => "ignored");
  assert.equal(cleared.edges.some((item) => item.id === "e1"), false);
  assert.equal(cleared.edges.some((item) => item.id === "e2"), true);
});

test("boundedPosition clamps and rounds coordinates", () => {
  assert.deepEqual(boundedPosition(12.6, -7.2), { x: 13, y: -7 });
  assert.deepEqual(boundedPosition(1_000_000, -1_000_000), { x: 100_000, y: -100_000 });
  assert.deepEqual(boundedPosition(Number.NaN, Number.POSITIVE_INFINITY), { x: 0, y: 100_000 });
});

test("focusTargetForIssue resolves node, edge, or nothing", () => {
  assert.deepEqual(focusTargetForIssue({ severity: "error", code: "x", message: "m", nodeId: "n1" }), {
    kind: "node",
    id: "n1",
  });
  assert.deepEqual(focusTargetForIssue({ severity: "error", code: "x", message: "m", edgeId: "e1" }), {
    kind: "edge",
    id: "e1",
  });
  assert.equal(focusTargetForIssue({ severity: "error", code: "x", message: "m" }), null);
});

test("findStartEdge returns the Start node's single outgoing edge", () => {
  const graph = {
    nodes: [startNode("s1"), agentNode("n1", "a")],
    edges: [edge("e1", "s1", "n1", null)],
  };

  assert.equal(findStartEdge(graph).id, "e1");
  assert.equal(findStartEdge({ nodes: [startNode("s1")], edges: [] }), undefined);
});

test("autoLayoutGraph ranks connected nodes top-to-bottom and positions every node", () => {
  const start = startNode("s1");
  const a = agentNode("n1", "a");
  const b = agentNode("n2", "b");
  const unreachable = agentNode("n3", "c");
  const complete = terminalNode("t1", "complete_run");

  const graph = {
    nodes: [start, a, b, unreachable, complete],
    edges: [
      edge("e1", "s1", "n1", null),
      edge("e2", "n1", "n2", "completed"),
      edge("e3", "n2", "t1", "completed"),
    ],
  };

  const laidOut = autoLayoutGraph(graph);
  const positionById = new Map(laidOut.nodes.map((node) => [node.id, node.position]));

  assert.ok(positionById.get("s1").y < positionById.get("n1").y);
  assert.ok(positionById.get("n1").y < positionById.get("n2").y);
  assert.ok(positionById.get("n2").y < positionById.get("t1").y);
  assert.ok(Number.isFinite(positionById.get("n3").y));
  assert.equal(laidOut.edges, graph.edges);
});

test("autoLayoutGraph keeps loops out of ranking constraints and places terminals below agents", () => {
  const graph = {
    nodes: [startNode("s1"), agentNode("n1", "a"), agentNode("n2", "b"), terminalNode("t1", "fail_run")],
    edges: [
      edge("e1", "s1", "n1", null),
      edge("e2", "n1", "n2", "completed"),
      edge("e3", "n2", "n1", "changes_requested"),
      edge("e4", "n1", "t1", "failed"),
    ],
  };
  const laidOut = autoLayoutGraph(graph);
  const byId = new Map(laidOut.nodes.map((item) => [item.id, item.position]));
  assert.ok(byId.get("n1").y < byId.get("n2").y);
  assert.ok(byId.get("t1").y > byId.get("n2").y);
  assert.deepEqual(autoLayoutGraph(graph).nodes, laidOut.nodes);
});

test("autoLayoutGraph remains bounded and stable for a larger arbitrary Team", () => {
  const agents = Array.from({ length: 20 }, (_, index) => agentNode(`n${index}`, `a${index}`));
  const graph = {
    nodes: [startNode("s1"), ...agents, terminalNode("t1", "complete_run")],
    edges: [
      edge("start", "s1", "n0", null),
      ...agents.slice(0, -1).map((_, index) => edge(`e${index}`, `n${index}`, `n${index + 1}`, "completed")),
      edge("complete", "n19", "t1", "completed"),
      edge("review-loop", "n12", "n5", "changes_requested"),
    ],
  };
  const first = autoLayoutGraph(graph);
  const second = autoLayoutGraph(graph);
  assert.deepEqual(second.nodes, first.nodes);
  for (const item of first.nodes) {
    assert.ok(Number.isFinite(item.position.x));
    assert.ok(Number.isFinite(item.position.y));
    assert.ok(Math.abs(item.position.x) <= 100_000);
    assert.ok(Math.abs(item.position.y) <= 100_000);
  }
  const positions = new Map(first.nodes.map((item) => [item.id, item.position]));
  assert.ok(positions.get("n5").y < positions.get("n12").y);
  assert.ok(positions.get("n19").y < positions.get("t1").y);
});
