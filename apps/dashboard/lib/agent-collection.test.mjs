import assert from "node:assert/strict";
import test from "node:test";
import { AGENT_VIEW_MODES, getVisibleAgents } from "./agent-collection.ts";
const agent = { id: "a", name: "Worker", slug: "worker", departmentId: "d", department: { name: "Platform" }, currentTeamId: null, enabled: true, effective: { role: "Reviewer", harness: "codex", model: "default", reasoning: "high" } };
test("registry provides all four views, table first", () => assert.deepEqual(AGENT_VIEW_MODES, ["table", "list", "details", "grid"]));
test("search includes identity, Department and effective runtime", () => {
  for (const query of [" worker ", "platform", "reviewer", "codex", "default", "high"]) assert.equal(getVisibleAgents([agent], query, "all", "all", "all").length, 1);
  assert.equal(getVisibleAgents([agent], "absent", "all", "all", "all").length, 0);
});
test("filters use persisted membership and Agent status, preserving source ordering", () => {
  const assigned = { ...agent, id: "b", currentTeamId: "t", enabled: false };
  const agents = [assigned, agent];
  assert.deepEqual(getVisibleAgents(agents, "", "d", "unassigned", "enabled"), [agent]);
  assert.deepEqual(getVisibleAgents(agents, "", "all", "t", "disabled"), [assigned]);
  assert.deepEqual(getVisibleAgents(agents, "", "other", "all", "all"), []);
  assert.deepEqual(getVisibleAgents(agents, "", "all", "all", "all"), agents);
});
