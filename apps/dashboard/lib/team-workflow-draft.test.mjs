import assert from "node:assert/strict";
import test from "node:test";

import {
  buildWorkflowInput,
  computeDefaultNextAgentId,
  createDefaultRoutes,
  orderDraftMembers,
  validateDraft,
} from "./team-workflow-draft.ts";

function agent(id, departmentId) {
  return {
    id,
    departmentId,
    department: { id: departmentId, name: `${departmentId} Department` },
  };
}

function member(agentId, layer, executionOrder, routes = createDefaultRoutes()) {
  return { agentId, layer, executionOrder, routes };
}

test("orderDraftMembers sorts by layer then execution order", () => {
  const members = [
    member("c", 2, 1),
    member("a", 1, 2),
    member("b", 1, 1),
  ];

  assert.deepEqual(
    orderDraftMembers(members).map((m) => m.agentId),
    ["b", "a", "c"],
  );
});

test("computeDefaultNextAgentId returns the next ordered member or null when last", () => {
  const members = [
    member("a", 1, 1),
    member("b", 2, 1),
    member("c", 3, 1),
  ];

  assert.equal(computeDefaultNextAgentId(members, "a"), "b");
  assert.equal(computeDefaultNextAgentId(members, "b"), "c");
  assert.equal(computeDefaultNextAgentId(members, "c"), null);
  assert.equal(computeDefaultNextAgentId(members, "missing"), null);
});

test("validateDraft rejects duplicate Department, duplicate placement, and missing exceptional routes", () => {
  const agentsById = new Map([
    ["a", agent("a", "dept-1")],
    ["b", agent("b", "dept-1")],
  ]);

  const members = [
    member("a", 1, 1, [
      { outcome: "completed", mode: "default", targetAgentId: null },
      { outcome: "approved", mode: "default", targetAgentId: null },
      { outcome: "changes_requested", mode: "block_run", targetAgentId: null },
      { outcome: "blocked", mode: "block_run", targetAgentId: null },
      { outcome: "failed", mode: "fail_run", targetAgentId: null },
    ]),
    member("b", 1, 1, [
      { outcome: "completed", mode: "default", targetAgentId: null },
      { outcome: "approved", mode: "default", targetAgentId: null },
      { outcome: "changes_requested", mode: "default", targetAgentId: null },
      { outcome: "blocked", mode: "default", targetAgentId: null },
      { outcome: "failed", mode: "default", targetAgentId: null },
    ]),
  ];

  const issues = validateDraft(members, agentsById);

  assert.ok(issues.some((issue) => issue.message.includes("already represented")));
  assert.ok(issues.some((issue) => issue.message.includes("already assigned")));
  assert.ok(
    issues.some(
      (issue) => issue.agentId === "b" && issue.message.includes("changes_requested"),
    ),
  );
});

test("validateDraft accepts a fully configured single-department, single-slot member", () => {
  const agentsById = new Map([["a", agent("a", "dept-1")]]);

  const members = [member("a", 1, 1)];

  assert.deepEqual(validateDraft(members, agentsById), []);
});

test("buildWorkflowInput drops default routes and preserves explicit ones", () => {
  const members = [
    member("a", 1, 1, [
      { outcome: "completed", mode: "default", targetAgentId: null },
      { outcome: "approved", mode: "default", targetAgentId: null },
      { outcome: "changes_requested", mode: "agent", targetAgentId: "b" },
      { outcome: "blocked", mode: "block_run", targetAgentId: null },
      { outcome: "failed", mode: "fail_run", targetAgentId: null },
    ]),
  ];

  const input = buildWorkflowInput(members);

  assert.equal(input.members.length, 1);
  assert.equal(input.members[0].routes.length, 3);
  assert.deepEqual(
    input.members[0].routes.find((route) => route.outcome === "changes_requested"),
    { outcome: "changes_requested", targetAgentId: "b", terminalAction: null },
  );
  assert.deepEqual(
    input.members[0].routes.find((route) => route.outcome === "blocked"),
    { outcome: "blocked", targetAgentId: null, terminalAction: "block_run" },
  );
});
