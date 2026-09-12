import assert from "node:assert/strict";
import test from "node:test";

import {
  TEAM_AGENT_VIEW_MODES,
  countConfiguredLayers,
  getAgentCapabilityLabels,
  getTeamRouteRows,
  getVisibleTeamAgents,
  getWorkflowOrderedAgents,
} from "./team-workspace-presentation.ts";

function agent(overrides = {}) {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    teamId: "00000000-0000-4000-8000-000000000001",
    slug: "backend-engineer",
    name: "Jordan Diaz",
    role: "Backend Engineer",
    description: "",
    layer: 2,
    executionOrder: 1,
    harness: "claude",
    model: "sonnet",
    reasoning: "high",
    systemPrompt: "Build the requested change.",
    enabled: true,
    canWrite: true,
    canRunCommands: true,
    canCommit: false,
    routes: [],
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-10T00:00:00.000Z",
    ...overrides,
  };
}

test("Team Agent browser exposes Table, List, Detailed, and Grid views", () => {
  assert.deepEqual(
    TEAM_AGENT_VIEW_MODES,
    ["table", "list", "details", "grid"],
  );
});

test("Team Agent browser sorts alphabetically by name by default", () => {
  const visible = getVisibleTeamAgents(
    [
      agent({
        id: "10000000-0000-4000-8000-000000000003",
        name: "runtime Reviewer",
      }),
      agent({
        id: "10000000-0000-4000-8000-000000000002",
        name: "Coder 2",
      }),
      agent({
        id: "10000000-0000-4000-8000-000000000001",
        name: "Coder 1",
      }),
    ],
    "",
    null,
    "all",
    "name",
  );

  assert.deepEqual(
    visible.map((item) => item.name),
    ["Coder 1", "Coder 2", "runtime Reviewer"],
  );
});

test("Team Agent browser applies search, layer, and status filters to one collection", () => {
  const visible = getVisibleTeamAgents(
    [
      agent({
        id: "10000000-0000-4000-8000-000000000001",
        name: "Planner",
        role: "Strategist",
        layer: 1,
      }),
      agent({
        id: "10000000-0000-4000-8000-000000000002",
        name: "Coder",
        role: "Backend Engineer",
        layer: 2,
        enabled: true,
      }),
      agent({
        id: "10000000-0000-4000-8000-000000000003",
        name: "Disabled Coder",
        role: "Backend Engineer",
        layer: 2,
        enabled: false,
      }),
    ],
    "backend",
    2,
    "enabled",
    "name",
  );

  assert.deepEqual(
    visible.map((item) => item.name),
    ["Coder"],
  );
});

test("Workflow order follows layer then execution order", () => {
  const ordered = getWorkflowOrderedAgents([
    agent({
      id: "10000000-0000-4000-8000-000000000003",
      name: "Later Layer",
      layer: 3,
      executionOrder: 1,
    }),
    agent({
      id: "10000000-0000-4000-8000-000000000002",
      name: "Second",
      layer: 1,
      executionOrder: 2,
    }),
    agent({
      id: "10000000-0000-4000-8000-000000000001",
      name: "First",
      layer: 1,
      executionOrder: 1,
    }),
  ]);

  assert.deepEqual(
    ordered.map((item) => item.name),
    ["First", "Second", "Later Layer"],
  );
});

test("Capability labels expose only persisted permissions", () => {
  assert.deepEqual(
    getAgentCapabilityLabels(
      agent({
        canWrite: true,
        canRunCommands: true,
        canCommit: false,
      }),
    ),
    ["Write", "Commands"],
  );

  assert.deepEqual(
    getAgentCapabilityLabels(
      agent({
        canWrite: false,
        canRunCommands: false,
        canCommit: false,
      }),
    ),
    ["Read only"],
  );
});

test("Routing rows resolve Team-local Agent and terminal destinations", () => {
  const target = agent({
    id: "10000000-0000-4000-8000-000000000002",
    name: "Reviewer",
    layer: 2,
  });
  const source = agent({
    id: "10000000-0000-4000-8000-000000000001",
    name: "Coder",
    layer: 1,
    routes: [
      {
        id: "20000000-0000-4000-8000-000000000001",
        sourceAgentId: "10000000-0000-4000-8000-000000000001",
        outcome: "completed",
        targetAgentId: target.id,
        terminalAction: null,
        enabled: true,
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-10T00:00:00.000Z",
      },
      {
        id: "20000000-0000-4000-8000-000000000002",
        sourceAgentId: "10000000-0000-4000-8000-000000000001",
        outcome: "failed",
        targetAgentId: null,
        terminalAction: "fail_run",
        enabled: false,
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-10T00:00:00.000Z",
      },
    ],
  });

  const rows = getTeamRouteRows([
    target,
    source,
  ]);

  assert.deepEqual(
    rows.map((row) => [
      row.sourceName,
      row.outcome,
      row.destination,
      row.enabled,
    ]),
    [
      ["Coder", "completed", "Reviewer", true],
      ["Coder", "failed", "fail_run", false],
    ],
  );
});

test("Configured layer count is based only on present Agent configuration", () => {
  assert.equal(
    countConfiguredLayers([
      agent({ layer: 1 }),
      agent({
        id: "10000000-0000-4000-8000-000000000002",
        layer: 2,
      }),
      agent({
        id: "10000000-0000-4000-8000-000000000003",
        layer: 2,
      }),
    ]),
    2,
  );
});
