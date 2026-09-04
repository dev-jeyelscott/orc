import assert from "node:assert/strict";

import type {
  AgentRoute,
  AgentWithRoutes,
  TerminalAction,
} from "@orc/shared";

import {
  deriveWorkflowEdges,
} from "./agent-presentation";
import {
  buildAgentWorkflowLayout,
  terminalWorkflowNodeId,
} from "./agent-workflow-layout";

const AGENT_IDS = {
  first:
    "00000000-0000-4000-8000-000000000001",
  second:
    "00000000-0000-4000-8000-000000000002",
  third:
    "00000000-0000-4000-8000-000000000003",
  fourth:
    "00000000-0000-4000-8000-000000000004",
} as const;

/**
 * Builds one deterministic generic agent fixture for workflow-layout tests.
 */
function createAgent(
  id: string,
  input: Partial<AgentWithRoutes> = {},
): AgentWithRoutes {
  return {
    id,
    slug:
      `worker-${id.slice(
        -4,
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
 * Builds one deterministic persisted-style route fixture.
 */
function createRoute(
  id: string,
  sourceAgentId: string,
  input: Partial<AgentRoute> = {},
): AgentRoute {
  return {
    id,
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
 * Returns one rendered node by identifier and fails clearly when it is absent.
 */
function requireNode(
  nodes:
    ReturnType<
      typeof buildAgentWorkflowLayout
    >["nodes"],
  id: string,
) {
  const node =
    nodes.find(
      (candidate) =>
        candidate.id === id,
    );

  assert.ok(
    node,
    `Expected workflow node ${id}`,
  );

  return node;
}

/**
 * Verifies sequential layers progress from top to bottom.
 */
function testSequentialLayers(): void {
  const first =
    createAgent(
      AGENT_IDS.first,
      {
        layer: 1,
      },
    );

  const second =
    createAgent(
      AGENT_IDS.second,
      {
        layer: 2,
      },
    );

  const third =
    createAgent(
      AGENT_IDS.third,
      {
        layer: 3,
      },
    );

  const agents = [
    first,
    second,
    third,
  ];

  const layout =
    buildAgentWorkflowLayout(
      agents,
      deriveWorkflowEdges(
        agents,
      ),
    );

  const firstNode =
    requireNode(
      layout.nodes,
      first.id,
    );

  const secondNode =
    requireNode(
      layout.nodes,
      second.id,
    );

  const thirdNode =
    requireNode(
      layout.nodes,
      third.id,
    );

  assert.ok(
    firstNode.position.y <
      secondNode.position.y,
  );

  assert.ok(
    secondNode.position.y <
      thirdNode.position.y,
  );
}

/**
 * Verifies same-layer agents align horizontally in execution order.
 */
function testSameLayerOrdering(): void {
  const first =
    createAgent(
      AGENT_IDS.first,
      {
        layer: 2,
        executionOrder: 1,
      },
    );

  const second =
    createAgent(
      AGENT_IDS.second,
      {
        layer: 2,
        executionOrder: 2,
      },
    );

  const agents = [
    second,
    first,
  ];

  const layout =
    buildAgentWorkflowLayout(
      agents,
      deriveWorkflowEdges(
        agents,
      ),
    );

  const firstNode =
    requireNode(
      layout.nodes,
      first.id,
    );

  const secondNode =
    requireNode(
      layout.nodes,
      second.id,
    );

  assert.equal(
    firstNode.position.y,
    secondNode.position.y,
  );

  assert.ok(
    firstNode.position.x <
      secondNode.position.x,
  );

  const defaultEdge =
    layout.edges.find(
      (edge) =>
        edge.data
          ?.kind ===
        "default",
    );

  assert.equal(
    defaultEdge
      ?.sourceHandle,
    "right-source",
  );

  assert.equal(
    defaultEdge
      ?.targetHandle,
    "left-target",
  );
}

/**
 * Verifies disabled agents remain visible while default progression still follows enabled agents only.
 */
function testDisabledAgentPresentation(): void {
  const first =
    createAgent(
      AGENT_IDS.first,
      {
        layer: 1,
      },
    );

  const disabled =
    createAgent(
      AGENT_IDS.second,
      {
        layer: 2,
        enabled: false,
      },
    );

  const third =
    createAgent(
      AGENT_IDS.third,
      {
        layer: 3,
      },
    );

  const agents = [
    first,
    disabled,
    third,
  ];

  const layout =
    buildAgentWorkflowLayout(
      agents,
      deriveWorkflowEdges(
        agents,
      ),
    );

  assert.ok(
    layout.nodes.some(
      (node) =>
        node.id ===
        disabled.id,
    ),
  );

  const defaultEdges =
    layout.edges.filter(
      (edge) =>
        edge.data
          ?.kind ===
        "default",
    );

  assert.equal(
    defaultEdges.length,
    1,
  );

  assert.equal(
    defaultEdges[0]
      ?.source,
    first.id,
  );

  assert.equal(
    defaultEdges[0]
      ?.target,
    third.id,
  );
}

/**
 * Verifies backward explicit routes are preserved and use side handles for readable routing.
 */
function testBackwardExplicitRoute(): void {
  const first =
    createAgent(
      AGENT_IDS.first,
      {
        layer: 1,
      },
    );

  const second =
    createAgent(
      AGENT_IDS.second,
      {
        layer: 2,
      },
    );

  second.routes = [
    createRoute(
      "10000000-0000-4000-8000-000000000001",
      second.id,
      {
        targetAgentId:
          first.id,
        terminalAction:
          null,
      },
    ),
  ];

  const agents = [
    first,
    second,
  ];

  const layout =
    buildAgentWorkflowLayout(
      agents,
      deriveWorkflowEdges(
        agents,
      ),
    );

  const explicit =
    layout.edges.find(
      (edge) =>
        edge.data
          ?.kind ===
        "explicit",
    );

  assert.equal(
    explicit?.source,
    second.id,
  );

  assert.equal(
    explicit?.target,
    first.id,
  );

  assert.equal(
    explicit
      ?.sourceHandle,
    "right-source",
  );

  assert.equal(
    explicit
      ?.targetHandle,
    "right-target",
  );
}

/**
 * Verifies an explicit terminal route creates a dedicated terminal destination node.
 */
function testTerminalRoute(): void {
  const first =
    createAgent(
      AGENT_IDS.first,
    );

  first.routes = [
    createRoute(
      "10000000-0000-4000-8000-000000000002",
      first.id,
      {
        outcome:
          "approved",
        terminalAction:
          "complete_run",
      },
    ),
  ];

  const layout =
    buildAgentWorkflowLayout(
      [first],
      deriveWorkflowEdges(
        [first],
      ),
    );

  const terminalId =
    terminalWorkflowNodeId(
      "complete_run",
    );

  assert.ok(
    layout.nodes.some(
      (node) =>
        node.id ===
        terminalId,
    ),
  );

  assert.ok(
    layout.edges.some(
      (edge) =>
        edge.target ===
        terminalId,
    ),
  );
}

/**
 * Verifies multiple persisted terminal actions receive unique graph nodes.
 */
function testMultipleTerminalActions(): void {
  const actions:
    TerminalAction[] = [
      "complete_run",
      "block_run",
      "fail_run",
    ];

  const agents =
    actions.map(
      (
        action,
        index,
      ) => {
        const ids = [
          AGENT_IDS.first,
          AGENT_IDS.second,
          AGENT_IDS.third,
        ];

        const agent =
          createAgent(
            ids[index]!,
            {
              layer:
                index + 1,
            },
          );

        agent.routes = [
          createRoute(
            `20000000-0000-4000-8000-00000000000${
              index + 1
            }`,
            agent.id,
            {
              outcome:
                action ===
                "complete_run"
                  ? "approved"
                  : action ===
                      "fail_run"
                    ? "failed"
                    : "blocked",
              terminalAction:
                action,
            },
          ),
        ];

        return agent;
      },
    );

  const layout =
    buildAgentWorkflowLayout(
      agents,
      deriveWorkflowEdges(
        agents,
      ),
    );

  for (
    const action of
    actions
  ) {
    assert.ok(
      layout.nodes.some(
        (node) =>
          node.id ===
          terminalWorkflowNodeId(
            action,
          ),
      ),
    );
  }
}

/**
 * Verifies equivalent input produces stable node coordinates and topology regardless of source-array ordering.
 */
function testDeterministicLayout(): void {
  const first =
    createAgent(
      AGENT_IDS.first,
      {
        layer: 1,
      },
    );

  const second =
    createAgent(
      AGENT_IDS.second,
      {
        layer: 2,
      },
    );

  const third =
    createAgent(
      AGENT_IDS.third,
      {
        layer: 3,
      },
    );

  const forward = [
    first,
    second,
    third,
  ];

  const reversed = [
    third,
    second,
    first,
  ];

  const forwardLayout =
    buildAgentWorkflowLayout(
      forward,
      deriveWorkflowEdges(
        forward,
      ),
    );

  const reversedLayout =
    buildAgentWorkflowLayout(
      reversed,
      deriveWorkflowEdges(
        reversed,
      ),
    );

  assert.deepEqual(
    forwardLayout.nodes.map(
      (node) => ({
        id: node.id,
        position:
          node.position,
      }),
    ),
    reversedLayout.nodes.map(
      (node) => ({
        id: node.id,
        position:
          node.position,
      }),
    ),
  );

  assert.deepEqual(
    forwardLayout.edges.map(
      (edge) => ({
        id: edge.id,
        source:
          edge.source,
        target:
          edge.target,
      }),
    ),
    reversedLayout.edges.map(
      (edge) => ({
        id: edge.id,
        source:
          edge.source,
        target:
          edge.target,
      }),
    ),
  );
}

/**
 * Verifies role names do not affect workflow positioning or edge topology.
 */
function testRoleIndependence(): void {
  const first =
    createAgent(
      AGENT_IDS.first,
      {
        role:
          "Arbitrary Role A",
        layer: 1,
      },
    );

  const second =
    createAgent(
      AGENT_IDS.second,
      {
        role:
          "Arbitrary Role B",
        layer: 2,
      },
    );

  const original = [
    first,
    second,
  ];

  const renamed =
    original.map(
      (
        agent,
        index,
      ) => ({
        ...agent,
        name:
          `Renamed ${index}`,
        role:
          `Different Role ${index}`,
      }),
    );

  const originalLayout =
    buildAgentWorkflowLayout(
      original,
      deriveWorkflowEdges(
        original,
      ),
    );

  const renamedLayout =
    buildAgentWorkflowLayout(
      renamed,
      deriveWorkflowEdges(
        renamed,
      ),
    );

  assert.deepEqual(
    originalLayout.nodes.map(
      (node) => ({
        id: node.id,
        position:
          node.position,
      }),
    ),
    renamedLayout.nodes.map(
      (node) => ({
        id: node.id,
        position:
          node.position,
      }),
    ),
  );

  assert.deepEqual(
    originalLayout.edges.map(
      (edge) => ({
        id: edge.id,
        source:
          edge.source,
        target:
          edge.target,
      }),
    ),
    renamedLayout.edges.map(
      (edge) => ({
        id: edge.id,
        source:
          edge.source,
        target:
          edge.target,
      }),
    ),
  );
}

testSequentialLayers();
testSameLayerOrdering();
testDisabledAgentPresentation();
testBackwardExplicitRoute();
testTerminalRoute();
testMultipleTerminalActions();
testDeterministicLayout();
testRoleIndependence();

console.log(
  "agent workflow layout tests passed",
);
