import assert from "node:assert/strict";

import type {
  AgentRoute,
  AgentWithRoutes,
} from "@orc/shared";

import {
  calculateApprovalRate,
  calculateRouteHealth,
  deriveWorkflowEdges,
  filterAgents,
  getAvailableAgentRouteTargets,
  groupAgentsByLayer,
  scopeAgentsToTeam,
} from "./agent-presentation";

const TEST_TEAM_ID =
  "00000000-0000-4000-9000-000000000001";

const OTHER_TEAM_ID =
  "00000000-0000-4000-9000-000000000002";

/**
 * Creates a generic Agent with deterministic test defaults.
 */
function createAgent(
  input: Partial<
    AgentWithRoutes
  > = {},
): AgentWithRoutes {
  const id =
    input.id ??
    crypto.randomUUID();

  return {
    id,
    teamId:
      TEST_TEAM_ID,
    slug:
      `worker-${id.slice(
        0,
        8,
      )}`,
    name:
      "Generic Worker",
    role:
      "Generic Role",
    description: "",
    layer: 1,
    executionOrder: 1,
    harness: "codex",
    model: "default",
    reasoning: "high",
    systemPrompt:
      "Perform generic work.",
    enabled: true,
    canWrite: false,
    canRunCommands: true,
    canCommit: false,
    createdAt:
      "2026-09-04T00:00:00.000Z",
    updatedAt:
      "2026-09-04T00:00:00.000Z",
    routes: [],
    ...input,
  };
}

/**
 * Creates one persisted-style explicit route for presentation tests.
 */
function createRoute(
  sourceAgentId: string,
  input: Partial<
    AgentRoute
  > = {},
): AgentRoute {
  return {
    id:
      crypto.randomUUID(),
    sourceAgentId,
    outcome:
      "changes_requested",
    targetAgentId: null,
    terminalAction:
      "block_run",
    enabled: true,
    createdAt:
      "2026-09-04T00:00:00.000Z",
    updatedAt:
      "2026-09-04T00:00:00.000Z",
    ...input,
  };
}

/**
 * Verifies grouping remains numeric and deterministic.
 */
function testGrouping(): void {
  const layerTwo =
    createAgent({
      name:
        "Worker B",
      layer: 2,
      executionOrder: 2,
    });

  const layerOne =
    createAgent({
      name:
        "Worker A",
      layer: 1,
      executionOrder: 1,
    });

  const groups =
    groupAgentsByLayer([
      layerTwo,
      layerOne,
    ]);

  assert.deepEqual(
    groups.map(
      (group) =>
        group.layer,
    ),
    [1, 2],
  );

  assert.equal(
    groups[0].agents[0].id,
    layerOne.id,
  );
}

/**
 * Verifies search, status, and layer filters use generic configuration fields.
 */
function testFiltering(): void {
  const enabled =
    createAgent({
      name:
        "Search Worker",
      role:
        "Implementation",
      slug:
        "search-worker",
      layer: 3,
      enabled: true,
    });

  const disabled =
    createAgent({
      name:
        "Other Worker",
      role:
        "Review",
      slug:
        "other-worker",
      layer: 4,
      enabled: false,
    });

  assert.deepEqual(
    filterAgents(
      [
        enabled,
        disabled,
      ],
      "implementation",
      null,
      "all",
    ).map(
      (agent) =>
        agent.id,
    ),
    [enabled.id],
  );

  assert.deepEqual(
    filterAgents(
      [
        enabled,
        disabled,
      ],
      "",
      4,
      "disabled",
    ).map(
      (agent) =>
        agent.id,
    ),
    [disabled.id],
  );
}

/**
 * Verifies explicit Team scoping excludes every Agent belonging to another Team.
 */
function testTeamScoping(): void {
  const owned =
    createAgent();

  const other =
    createAgent({
      teamId:
        OTHER_TEAM_ID,
    });

  assert.deepEqual(
    scopeAgentsToTeam(
      [
        owned,
        other,
      ],
      TEST_TEAM_ID,
    ).map(
      (agent) =>
        agent.id,
    ),
    [
      owned.id,
    ],
  );
}

/**
 * Verifies route destinations contain only enabled Agents in the source Team and never the source itself.
 */
function testRouteTargetScoping(): void {
  const source =
    createAgent();

  const valid =
    createAgent();

  const disabled =
    createAgent({
      enabled:
        false,
    });

  const otherTeam =
    createAgent({
      teamId:
        OTHER_TEAM_ID,
    });

  assert.deepEqual(
    getAvailableAgentRouteTargets(
      [
        source,
        valid,
        disabled,
        otherTeam,
      ],
      source,
    ).map(
      (agent) =>
        agent.id,
    ),
    [
      valid.id,
    ],
  );
}

/**
 * Verifies approval rate follows the approved versus changes-requested denominator.
 */
function testApprovalRate(): void {
  assert.equal(
    calculateApprovalRate(
      3,
      1,
    ),
    75,
  );

  assert.equal(
    calculateApprovalRate(
      0,
      0,
    ),
    null,
  );
}

/**
 * Verifies route-health categories remain mutually exclusive.
 */
function testRouteHealth(): void {
  const source =
    createAgent();

  const target =
    createAgent();

  source.routes = [
    createRoute(
      source.id,
      {
        targetAgentId:
          target.id,
        terminalAction:
          null,
      },
    ),
    createRoute(
      source.id,
      {
        outcome:
          "failed",
        terminalAction:
          "fail_run",
      },
    ),
    createRoute(
      source.id,
      {
        outcome:
          "blocked",
        enabled: false,
        terminalAction:
          "block_run",
      },
    ),
  ];

  assert.deepEqual(
    calculateRouteHealth([
      source,
      target,
    ]),
    {
      enabledAgentTargets:
        1,
      enabledTerminalRoutes:
        1,
      disabledRoutes:
        1,
      total:
        3,
    },
  );
}

/**
 * Verifies workflow edges derive from ordering and persisted routes rather than worker names.
 */
function testWorkflowEdges(): void {
  const first =
    createAgent({
      name:
        "Worker One",
      layer: 1,
      executionOrder: 1,
    });

  const disabled =
    createAgent({
      name:
        "Worker Disabled",
      layer: 2,
      executionOrder: 1,
      enabled: false,
    });

  const third =
    createAgent({
      name:
        "Worker Three",
      layer: 3,
      executionOrder: 1,
    });

  first.routes = [
    createRoute(
      first.id,
      {
        targetAgentId:
          third.id,
        terminalAction:
          null,
      },
    ),
  ];

  const edges =
    deriveWorkflowEdges([
      third,
      disabled,
      first,
    ]);

  const defaultEdge =
    edges.find(
      (edge) =>
        edge.kind ===
        "default",
    );

  assert.equal(
    defaultEdge
      ?.sourceAgentId,
    first.id,
  );

  assert.equal(
    defaultEdge
      ?.targetAgentId,
    third.id,
  );

  const explicit =
    edges.find(
      (edge) =>
        edge.kind ===
        "explicit",
    );

  assert.equal(
    explicit
      ?.targetAgentId,
    third.id,
  );
}

/**
 * Verifies a malformed route cannot render a graph edge into an Agent outside the supplied Team scope.
 */
function testCrossTeamGraphIsolation(): void {
  const source =
    createAgent();

  const outside =
    createAgent({
      teamId:
        OTHER_TEAM_ID,
    });

  source.routes = [
    createRoute(
      source.id,
      {
        targetAgentId:
          outside.id,
        terminalAction:
          null,
      },
    ),
  ];

  const edges =
    deriveWorkflowEdges([
      source,
    ]);

  assert.equal(
    edges.some(
      (edge) =>
        edge.targetAgentId ===
        outside.id,
    ),
    false,
  );
}

testGrouping();
testFiltering();
testTeamScoping();
testRouteTargetScoping();
testApprovalRate();
testRouteHealth();
testWorkflowEdges();
testCrossTeamGraphIsolation();

console.log(
  "agent-presentation helper tests passed",
);
