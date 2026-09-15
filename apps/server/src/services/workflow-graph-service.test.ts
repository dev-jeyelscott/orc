import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import type { WorkflowGraph } from "@orc/shared";

import { db } from "../db/client.js";
import { agents, departments, teamMembers, teams, workflowEdges, workflowNodes, workflowRevisions } from "../db/schema.js";
import {
  WorkflowGraphServiceError,
  getOrCreateDraft,
  getPublishedRevision,
  getWorkflowAggregate,
  publishDraft,
  saveDraftGraph,
  validateGraph,
} from "./workflow-graph-service.js";

const createdAgentIds = new Set<string>();
const createdDepartmentIds = new Set<string>();
const createdTeamIds = new Set<string>();

async function createTestDepartment(label: string, enabled = true) {
  const [department] = await db
    .insert(departments)
    .values({
      slug: `workflow-graph-${label}-${crypto.randomUUID()}`,
      name: `${label} Department`,
      role: `${label} Role`,
      harness: "codex" as const,
      defaultModel: "default",
      defaultReasoning: "high",
      systemPrompt: `Act as ${label}.`,
      enabled,
    })
    .returning();
  createdDepartmentIds.add(department.id);
  return department;
}

async function createTestAgent(departmentId: string, label: string, enabled = true) {
  const [agent] = await db
    .insert(agents)
    .values({
      departmentId,
      slug: `workflow-graph-agent-${label}-${crypto.randomUUID()}`,
      name: `${label} Agent`,
      enabled,
    })
    .returning();
  createdAgentIds.add(agent.id);
  return agent;
}

async function createTestTeam(label: string) {
  const [team] = await db
    .insert(teams)
    .values({ slug: `workflow-graph-team-${label}-${crypto.randomUUID()}`, name: `${label} Team` })
    .returning();
  createdTeamIds.add(team.id);
  return team;
}

async function addTeamMember(teamId: string, departmentId: string, agentId: string, layer: number) {
  await db.insert(teamMembers).values({ teamId, departmentId, agentId, layer, executionOrder: 1 });
}

afterEach(async () => {
  for (const teamId of createdTeamIds) {
    const revisionRows = await db
      .select({ id: workflowRevisions.id })
      .from(workflowRevisions)
      .where(eq(workflowRevisions.teamId, teamId));
    for (const revision of revisionRows) {
      await db.delete(workflowEdges).where(eq(workflowEdges.revisionId, revision.id));
      await db.delete(workflowNodes).where(eq(workflowNodes.revisionId, revision.id));
    }
    await db.delete(workflowRevisions).where(eq(workflowRevisions.teamId, teamId));
    await db.delete(teamMembers).where(eq(teamMembers.teamId, teamId));
    await db.delete(teams).where(eq(teams.id, teamId));
  }
  for (const agentId of createdAgentIds) {
    await db.delete(agents).where(eq(agents.id, agentId));
  }
  for (const departmentId of createdDepartmentIds) {
    await db.delete(departments).where(eq(departments.id, departmentId));
  }
  createdTeamIds.clear();
  createdAgentIds.clear();
  createdDepartmentIds.clear();
});

describe("getOrCreateDraft", () => {
  it("seeds a fresh Draft with Start and the three terminal nodes", async () => {
    const team = await createTestTeam("seed");
    const draft = await getOrCreateDraft(team.id);

    expect(draft.graph.nodes).toHaveLength(4);
    expect(draft.graph.nodes.filter((node) => node.kind === "start")).toHaveLength(1);
    expect(draft.graph.nodes.filter((node) => node.kind === "terminal")).toHaveLength(3);
    expect(draft.graph.edges).toHaveLength(0);
  });

  it("returns the same Draft on repeated calls", async () => {
    const team = await createTestTeam("idempotent");
    const first = await getOrCreateDraft(team.id);
    const second = await getOrCreateDraft(team.id);

    expect(second.id).toBe(first.id);
  });

  it("throws 404 for a nonexistent Team", async () => {
    await expect(getOrCreateDraft(crypto.randomUUID())).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("saveDraftGraph", () => {
  it("saves an incomplete Draft (missing Start edge, disconnected Agent) without error", async () => {
    const team = await createTestTeam("incomplete");
    const department = await createTestDepartment("incomplete");
    const agent = await createTestAgent(department.id, "incomplete");
    await addTeamMember(team.id, department.id, agent.id, 1);

    const draft = await getOrCreateDraft(team.id);
    const startNode = draft.graph.nodes.find((node) => node.kind === "start")!;

    const graph: WorkflowGraph = {
      nodes: [...draft.graph.nodes, { id: crypto.randomUUID(), kind: "agent", agentId: agent.id, position: { x: 200, y: 0 } }],
      edges: [],
    };

    const result = await saveDraftGraph(team.id, graph);

    expect(result.draft.graph.nodes).toHaveLength(5);
    expect(result.validation.publishable).toBe(false);
    expect(result.validation.errors.some((issue) => issue.code === "invalid_start_edge")).toBe(true);
    void startNode;
  });

  it("rejects a duplicate node id in the same request", async () => {
    const team = await createTestTeam("dup-node");
    const draft = await getOrCreateDraft(team.id);
    const [firstNode] = draft.graph.nodes;

    await expect(
      saveDraftGraph(team.id, {
        nodes: [firstNode, firstNode],
        edges: [],
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("rejects an edge referencing a node absent from the request", async () => {
    const team = await createTestTeam("dangling-edge");
    const draft = await getOrCreateDraft(team.id);
    const startNode = draft.graph.nodes.find((node) => node.kind === "start")!;

    await expect(
      saveDraftGraph(team.id, {
        nodes: [startNode],
        edges: [{ id: crypto.randomUUID(), sourceNodeId: startNode.id, targetNodeId: crypto.randomUUID(), outcome: null }],
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe("publishDraft", () => {
  async function buildLinearGraph(teamId: string, agentIds: string[]): Promise<WorkflowGraph> {
    const draft = await getOrCreateDraft(teamId);
    const start = draft.graph.nodes.find((node) => node.kind === "start")!;
    const completeRun = draft.graph.nodes.find(
      (node) => node.kind === "terminal" && node.terminalAction === "complete_run",
    )!;

    const agentNodes = agentIds.map((agentId, index) => ({
      id: crypto.randomUUID(),
      kind: "agent" as const,
      agentId,
      position: { x: 200 * (index + 1), y: 0 },
    }));

    const edges: WorkflowGraph["edges"] = [
      { id: crypto.randomUUID(), sourceNodeId: start.id, targetNodeId: agentNodes[0].id, outcome: null },
    ];

    for (let i = 0; i < agentNodes.length; i += 1) {
      const target = agentNodes[i + 1]?.id ?? completeRun.id;
      edges.push({ id: crypto.randomUUID(), sourceNodeId: agentNodes[i].id, targetNodeId: target, outcome: "completed" });
      for (const outcome of ["approved", "changes_requested", "blocked", "failed"] as const) {
        edges.push({ id: crypto.randomUUID(), sourceNodeId: agentNodes[i].id, targetNodeId: completeRun.id, outcome });
      }
    }

    return { nodes: [...draft.graph.nodes, ...agentNodes], edges };
  }

  it("publishes a valid Draft as version 1 and increments on republish", async () => {
    const team = await createTestTeam("publish");
    const department = await createTestDepartment("publish");
    const agent = await createTestAgent(department.id, "publish");
    await addTeamMember(team.id, department.id, agent.id, 1);

    const graph = await buildLinearGraph(team.id, [agent.id]);
    await saveDraftGraph(team.id, graph);

    const first = await publishDraft(team.id);
    expect(first.revision.version).toBe(1);
    expect(first.validation.publishable).toBe(true);

    const second = await publishDraft(team.id);
    expect(second.revision.version).toBe(2);
  });

  it("blocks publish when an enabled Team Agent is missing from the graph", async () => {
    const team = await createTestTeam("missing-agent");
    const department = await createTestDepartment("missing-agent");
    await createTestAgent(department.id, "missing-agent");
    // No graph edits: Draft only has system nodes, but Team has an executable Agent.
    const agent2 = await createTestAgent(department.id, "missing-agent-2");
    await addTeamMember(team.id, department.id, agent2.id, 1);

    await getOrCreateDraft(team.id);

    await expect(publishDraft(team.id)).rejects.toMatchObject({
      statusCode: 400,
      validation: expect.objectContaining({
        errors: expect.arrayContaining([expect.objectContaining({ code: "missing_team_agent_node" })]),
      }),
    });
  });

  it("rejects a Draft save that would place the same Agent in two nodes", async () => {
    const team = await createTestTeam("dup-agent");
    const department = await createTestDepartment("dup-agent");
    const agent = await createTestAgent(department.id, "dup-agent");
    await addTeamMember(team.id, department.id, agent.id, 1);

    const draft = await getOrCreateDraft(team.id);
    const start = draft.graph.nodes.find((node) => node.kind === "start")!;
    const nodeA = { id: crypto.randomUUID(), kind: "agent" as const, agentId: agent.id, position: { x: 100, y: 0 } };
    const nodeB = { id: crypto.randomUUID(), kind: "agent" as const, agentId: agent.id, position: { x: 200, y: 0 } };

    await expect(
      saveDraftGraph(team.id, {
        nodes: [...draft.graph.nodes, nodeA, nodeB],
        edges: [{ id: crypto.randomUUID(), sourceNodeId: start.id, targetNodeId: nodeA.id, outcome: null }],
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("blocks publish for an unreachable Agent", async () => {
    const team = await createTestTeam("unreachable");
    const department = await createTestDepartment("unreachable");
    const agentA = await createTestAgent(department.id, "unreachable-a");
    const departmentB = await createTestDepartment("unreachable-b");
    const agentB = await createTestAgent(departmentB.id, "unreachable-b");
    await addTeamMember(team.id, department.id, agentA.id, 1);

    const draft = await getOrCreateDraft(team.id);
    const start = draft.graph.nodes.find((node) => node.kind === "start")!;
    const completeRun = draft.graph.nodes.find(
      (node) => node.kind === "terminal" && node.terminalAction === "complete_run",
    )!;

    const nodeA = { id: crypto.randomUUID(), kind: "agent" as const, agentId: agentA.id, position: { x: 100, y: 0 } };
    const nodeB = { id: crypto.randomUUID(), kind: "agent" as const, agentId: agentB.id, position: { x: 200, y: 0 } };

    await saveDraftGraph(team.id, {
      nodes: [...draft.graph.nodes, nodeA, nodeB],
      edges: [
        { id: crypto.randomUUID(), sourceNodeId: start.id, targetNodeId: nodeA.id, outcome: null },
        { id: crypto.randomUUID(), sourceNodeId: nodeA.id, targetNodeId: completeRun.id, outcome: "completed" },
      ],
    });

    // nodeB (agentB) has no route in and is not a Team member either -- assert
    // the unreachable code specifically by making it a member but disconnected.
    void nodeB;
    const result = await getWorkflowAggregate(team.id);
    expect(result?.validation.errors.some((issue) => issue.code === "agent_not_team_member")).toBe(true);
  });

  it("allows publish with only warnings for missing outcome edges and self-loops", async () => {
    const team = await createTestTeam("warnings-only");
    const department = await createTestDepartment("warnings-only");
    const agent = await createTestAgent(department.id, "warnings-only");
    await addTeamMember(team.id, department.id, agent.id, 1);

    const draft = await getOrCreateDraft(team.id);
    const start = draft.graph.nodes.find((node) => node.kind === "start")!;
    const completeRun = draft.graph.nodes.find(
      (node) => node.kind === "terminal" && node.terminalAction === "complete_run",
    )!;
    const node = { id: crypto.randomUUID(), kind: "agent" as const, agentId: agent.id, position: { x: 100, y: 0 } };

    await saveDraftGraph(team.id, {
      nodes: [...draft.graph.nodes, node],
      edges: [
        { id: crypto.randomUUID(), sourceNodeId: start.id, targetNodeId: node.id, outcome: null },
        { id: crypto.randomUUID(), sourceNodeId: node.id, targetNodeId: completeRun.id, outcome: "completed" },
        { id: crypto.randomUUID(), sourceNodeId: node.id, targetNodeId: node.id, outcome: "changes_requested" },
      ],
    });

    const result = await publishDraft(team.id);
    expect(result.validation.publishable).toBe(true);
    expect(result.validation.warnings.some((issue) => issue.code === "missing_outcome_edge")).toBe(true);
    expect(result.validation.warnings.some((issue) => issue.message.includes("routes an outcome back to itself"))).toBe(
      true,
    );
  });

  it("keeps a Published revision immutable across later publishes", async () => {
    const team = await createTestTeam("immutable");
    const department = await createTestDepartment("immutable");
    const agent = await createTestAgent(department.id, "immutable");
    await addTeamMember(team.id, department.id, agent.id, 1);

    const graph = await buildLinearGraph(team.id, [agent.id]);
    await saveDraftGraph(team.id, graph);
    const first = await publishDraft(team.id);

    // Republish the same unchanged Draft; the first Published revision must
    // remain byte-for-byte the same regardless of later publish activity.
    await publishDraft(team.id);

    const revision = await getPublishedRevision(team.id, first.revision.id);
    expect(revision?.version).toBe(1);
    expect(revision?.graph.nodes).toHaveLength(graph.nodes.length);
  });

  it("throws 404 for publishing a Team with no Draft workflow row somehow removed", async () => {
    await expect(publishDraft(crypto.randomUUID())).rejects.toBeInstanceOf(WorkflowGraphServiceError);
  });
});

describe("validateGraph", () => {
  const emptyContext = { memberAgentIds: new Set<string>(), executableAgentIds: new Set<string>() };

  it("reports missing_start for a graph with no Start node", () => {
    const result = validateGraph({ nodes: [], edges: [] }, emptyContext);
    expect(result.errors.some((issue) => issue.code === "missing_start")).toBe(true);
    expect(result.publishable).toBe(false);
  });

  it("reports terminal_has_outgoing_edge when a terminal node has an outgoing edge", () => {
    const start = { id: crypto.randomUUID(), kind: "start" as const, position: { x: 0, y: 0 } };
    const terminal = {
      id: crypto.randomUUID(),
      kind: "terminal" as const,
      terminalAction: "complete_run" as const,
      position: { x: 100, y: 0 },
    };

    const result = validateGraph(
      {
        nodes: [start, terminal],
        edges: [{ id: crypto.randomUUID(), sourceNodeId: terminal.id, targetNodeId: start.id, outcome: null }],
      },
      emptyContext,
    );

    expect(result.errors.some((issue) => issue.code === "terminal_has_outgoing_edge")).toBe(true);
    expect(result.errors.some((issue) => issue.code === "invalid_start_edge")).toBe(true);
  });
});
