import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENT_AVATAR_LIMIT,
  TEAM_VIEW_MODES,
  getAgentAvatarSummary,
  getAgentInitials,
  getAgentToneIndex,
  getVisibleTeams,
  groupAgentsByTeam,
} from "./team-presentation.ts";

function team(overrides = {}) {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    slug: "platform",
    name: "Platform",
    description: "Platform engineering",
    enabled: true,
    notionDataSourceId: null,
    autoModeEnabled: false,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-10T00:00:00.000Z",
    ...overrides,
  };
}

function agent(overrides = {}) {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    departmentId: "20000000-0000-4000-7000-000000000001",
    teamId: "00000000-0000-4000-8000-000000000001",
    slug: "backend-engineer",
    name: "Jordan Diaz",
    layer: 2,
    executionOrder: 1,
    enabled: true,
    modelOverride: null,
    reasoningOverride: null,
    additionalPrompt: "",
    department: {
      id: "20000000-0000-4000-7000-000000000001",
      slug: "backend-engineering",
      name: "Backend Engineering",
      role: "Backend Engineer",
      description: "",
      enabled: true,
      harness: "claude",
      defaultModel: "sonnet",
      defaultReasoning: "high",
      systemPrompt: "Build the requested change.",
      canWrite: true,
      canRunCommands: true,
      canCommit: true,
      agentCount: 0,
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-10T00:00:00.000Z",
    },
    effective: {
      role: "Backend Engineer",
      harness: "claude",
      model: "sonnet",
      reasoning: "high",
      systemPrompt: "Build the requested change.",
      canWrite: true,
      canRunCommands: true,
      canCommit: true,
      enabled: true,
    },
    hasModelOverride: false,
    hasReasoningOverride: false,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-10T00:00:00.000Z",
    ...overrides,
  };
}

test("Team view modes keep List, Details, and Grid available", () => {
  assert.deepEqual(
    TEAM_VIEW_MODES,
    ["list", "details", "grid"],
  );
});

test("Agent initials use first and last names and support single-word names", () => {
  assert.equal(
    getAgentInitials("Jordan Diaz"),
    "JD",
  );
  assert.equal(
    getAgentInitials("Codex"),
    "CO",
  );
  assert.equal(
    getAgentInitials("  "),
    "?",
  );
});

test("Agent avatar tones are deterministic", () => {
  assert.equal(
    getAgentToneIndex("agent-1", 6),
    getAgentToneIndex("agent-1", 6),
  );
  assert.ok(
    getAgentToneIndex("agent-2", 6) >= 0,
  );
  assert.ok(
    getAgentToneIndex("agent-2", 6) < 6,
  );
});

test("Agent avatar summary displays five members and reports overflow", () => {
  const members = Array.from(
    { length: 8 },
    (_, index) =>
      agent({
        id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        name: `Agent ${index + 1}`,
      }),
  );

  const summary =
    getAgentAvatarSummary(members);

  assert.equal(
    AGENT_AVATAR_LIMIT,
    5,
  );
  assert.equal(
    summary.visibleAgents.length,
    5,
  );
  assert.equal(
    summary.overflowCount,
    3,
  );
});

test("Agent avatar summary handles Teams with no Agents", () => {
  const summary =
    getAgentAvatarSummary([]);

  assert.deepEqual(
    summary.visibleAgents,
    [],
  );
  assert.equal(
    summary.overflowCount,
    0,
  );
});

test("Agent memberships are ordered by layer, execution order, and name", () => {
  const membersByTeam =
    groupAgentsByTeam([
      agent({
        id: "10000000-0000-4000-8000-000000000003",
        name: "Zulu",
        layer: 2,
        executionOrder: 2,
      }),
      agent({
        id: "10000000-0000-4000-8000-000000000002",
        name: "Beta",
        layer: 1,
        executionOrder: 2,
      }),
      agent({
        id: "10000000-0000-4000-8000-000000000001",
        name: "Alpha",
        layer: 1,
        executionOrder: 1,
      }),
    ]);

  assert.deepEqual(
    membersByTeam
      .get("00000000-0000-4000-8000-000000000001")
      .map((member) => member.name),
    ["Alpha", "Beta", "Zulu"],
  );
});

test("Teams are alphabetically sorted by name by default using case-insensitive comparison", () => {
  const teams = [
    team({
      id: "00000000-0000-4000-8000-000000000003",
      name: "runtime Systems",
    }),
    team({
      id: "00000000-0000-4000-8000-000000000002",
      name: "Automation Ops",
    }),
    team({
      id: "00000000-0000-4000-8000-000000000001",
      name: "API Platform",
    }),
  ];

  const visible = getVisibleTeams(
    teams,
    new Map(),
    "",
    "all",
    "name",
  );

  assert.deepEqual(
    visible.map((item) => item.name),
    [
      "API Platform",
      "Automation Ops",
      "runtime Systems",
    ],
  );
});

test("Team search includes Team metadata and Agent names or roles", () => {
  const platformTeam = team();
  const membersByTeam = groupAgentsByTeam([
    agent({
      name: "Sarah Chen",
      effective: {
        role: "DevOps Engineer",
        harness: "claude",
        model: "sonnet",
        reasoning: "high",
        systemPrompt: "Build the requested change.",
        canWrite: true,
        canRunCommands: true,
        canCommit: true,
        enabled: true,
      },
    }),
  ]);

  assert.equal(
    getVisibleTeams(
      [platformTeam],
      membersByTeam,
      "devops",
      "all",
      "name",
    ).length,
    1,
  );

  assert.equal(
    getVisibleTeams(
      [platformTeam],
      membersByTeam,
      "missing",
      "all",
      "name",
    ).length,
    0,
  );
});

test("Team status filtering remains limited to persisted enabled and disabled states", () => {
  const enabled = team({
    id: "00000000-0000-4000-8000-000000000001",
    name: "Enabled Team",
    enabled: true,
  });
  const disabled = team({
    id: "00000000-0000-4000-8000-000000000002",
    name: "Disabled Team",
    enabled: false,
  });

  assert.deepEqual(
    getVisibleTeams(
      [disabled, enabled],
      new Map(),
      "",
      "enabled",
      "name",
    ).map((item) => item.name),
    ["Enabled Team"],
  );

  assert.deepEqual(
    getVisibleTeams(
      [enabled, disabled],
      new Map(),
      "",
      "disabled",
      "name",
    ).map((item) => item.name),
    ["Disabled Team"],
  );
});
