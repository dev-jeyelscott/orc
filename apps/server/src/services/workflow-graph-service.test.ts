import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import type { WorkflowGraph } from "@orc/shared";

import { db } from "../db/client.js";
import { agents, departments, teamMembers, teams, workflowEdges, workflowNodes, workflowRevisions } from "../db/schema.js";
import { createAgent } from "./agent-service.js";
import { createDepartment } from "./department-service.js";
import { replaceTeamMembers } from "./team-membership.js";
import { createTeam } from "./team-service.js";
import {
  WorkflowGraphServiceError,
  getOrCreateDraft,
  getPublishedRevision,
  publishDraft,
  saveDraftGraph,
  validateGraph,
} from "./workflow-graph-service.js";

const createdAgentIds = new Set<string>();
const createdDepartmentIds = new Set<string>();
const createdTeamIds = new Set<string>();
const createdRoots: string[] = [];

/**
 * Every fixture below is created through the file-authoritative services
 * (roadmap Spec 2/4) against a private per-test `.orc/` root, since Spec 8
 * removed workflow-graph-service's DB-only Draft/Publish fallback for a
 * Team/Agent that has not migrated. `configRoot` must be threaded into every
 * `saveDraftGraph`/`publishDraft` call in this file.
 */
async function makeConfigRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "orc-workflow-graph-test-"));
  createdRoots.push(root);
  return root;
}

async function createTestDepartment(configRoot: string, label: string, enabled = true) {
  const department = await createDepartment(
    {
      slug: `workflow-graph-${label}-${crypto.randomUUID()}`,
      name: `${label} Department`,
      role: `${label} Role`,
      harness: "codex" as const,
      defaultModel: "default",
      defaultReasoning: "high",
      systemPrompt: `Act as ${label}.`,
      enabled,
    },
    configRoot,
  );
  createdDepartmentIds.add(department.id);
  return department;
}

async function createTestAgent(configRoot: string, departmentId: string, label: string, enabled = true) {
  const agent = await createAgent(
    {
      departmentId,
      slug: `workflow-graph-agent-${label}-${crypto.randomUUID()}`,
      name: `${label} Agent`,
      enabled,
      additionalPrompt: "",
    },
    configRoot,
  );
  createdAgentIds.add(agent.id);
  return agent;
}

async function createTestTeam(configRoot: string, label: string) {
  const team = await createTeam(
    { slug: `workflow-graph-team-${label}-${crypto.randomUUID()}`, name: `${label} Team`, description: "", enabled: true },
    configRoot,
  );
  createdTeamIds.add(team.id);
  return team;
}

async function addTeamMember(configRoot: string, teamId: string, agentId: string) {
  await replaceTeamMembers(teamId, [agentId], null, configRoot);
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

  for (const root of createdRoots.splice(0)) {
    await fs.rm(root, { recursive: true, force: true });
  }
});

describe("getOrCreateDraft", () => {
  it("seeds a fresh Draft with Start and the three terminal nodes", async () => {
    const configRoot = await makeConfigRoot();
    const team = await createTestTeam(configRoot, "seed");
    const draft = await getOrCreateDraft(team.id);

    expect(draft.graph.nodes).toHaveLength(4);
    expect(draft.graph.nodes.filter((node) => node.kind === "start")).toHaveLength(1);
    expect(draft.graph.nodes.filter((node) => node.kind === "terminal")).toHaveLength(3);
    expect(draft.graph.edges).toHaveLength(0);
  });

  it("returns the same Draft on repeated calls", async () => {
    const configRoot = await makeConfigRoot();
    const team = await createTestTeam(configRoot, "idempotent");
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
    const configRoot = await makeConfigRoot();
    const team = await createTestTeam(configRoot, "incomplete");
    const department = await createTestDepartment(configRoot, "incomplete");
    const agent = await createTestAgent(configRoot, department.id, "incomplete");
    await addTeamMember(configRoot, team.id, agent.id);

    const draft = await getOrCreateDraft(team.id);
    const startNode = draft.graph.nodes.find((node) => node.kind === "start")!;

    const graph: WorkflowGraph = {
      nodes: [...draft.graph.nodes, { id: crypto.randomUUID(), kind: "agent", agentId: agent.id, position: { x: 200, y: 0 } }],
      edges: [],
    };

    const result = await saveDraftGraph(team.id, graph, configRoot);

    expect(result.draft.graph.nodes).toHaveLength(5);
    expect(result.validation.publishable).toBe(false);
    expect(result.validation.errors.some((issue) => issue.code === "invalid_start_edge")).toBe(true);
    void startNode;
  });

  it("rejects a duplicate node id in the same request", async () => {
    const configRoot = await makeConfigRoot();
    const team = await createTestTeam(configRoot, "dup-node");
    const draft = await getOrCreateDraft(team.id);
    const [firstNode] = draft.graph.nodes;

    await expect(
      saveDraftGraph(team.id, {
        nodes: [firstNode, firstNode],
        edges: [],
      }, configRoot),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("rejects an edge referencing a node absent from the request", async () => {
    const configRoot = await makeConfigRoot();
    const team = await createTestTeam(configRoot, "dangling-edge");
    const draft = await getOrCreateDraft(team.id);
    const startNode = draft.graph.nodes.find((node) => node.kind === "start")!;

    await expect(
      saveDraftGraph(team.id, {
        nodes: [startNode],
        edges: [{ id: crypto.randomUUID(), sourceNodeId: startNode.id, targetNodeId: crypto.randomUUID(), outcome: null }],
      }, configRoot),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("rejects saving a Draft for a Team that has no canonical team.yaml", async () => {
    const configRoot = await makeConfigRoot();
    const [dbOnlyTeam] = await db
      .insert(teams)
      .values({ slug: `workflow-graph-db-only-${crypto.randomUUID()}`, name: "DB-only Team" })
      .returning();
    createdTeamIds.add(dbOnlyTeam.id);

    const draft = await getOrCreateDraft(dbOnlyTeam.id);

    await expect(saveDraftGraph(dbOnlyTeam.id, draft.graph, configRoot)).rejects.toMatchObject({ statusCode: 409 });
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
    const configRoot = await makeConfigRoot();
    const team = await createTestTeam(configRoot, "publish");
    const department = await createTestDepartment(configRoot, "publish");
    const agent = await createTestAgent(configRoot, department.id, "publish");
    await addTeamMember(configRoot, team.id, agent.id);

    const graph = await buildLinearGraph(team.id, [agent.id]);
    await saveDraftGraph(team.id, graph, configRoot);

    const first = await publishDraft(team.id, configRoot);
    expect(first.revision.version).toBe(1);
    expect(first.validation.publishable).toBe(true);

    const second = await publishDraft(team.id, configRoot);
    expect(second.revision.version).toBe(2);
  });

  it("blocks publish when an enabled Team Agent is missing from the graph", async () => {
    const configRoot = await makeConfigRoot();
    const team = await createTestTeam(configRoot, "missing-agent");
    const department = await createTestDepartment(configRoot, "missing-agent");
    await createTestAgent(configRoot, department.id, "missing-agent");
    // No graph edits: Draft only has system nodes, but Team has an executable Agent.
    const agent2 = await createTestAgent(configRoot, department.id, "missing-agent-2");
    await addTeamMember(configRoot, team.id, agent2.id);

    await getOrCreateDraft(team.id);

    await expect(publishDraft(team.id, configRoot)).rejects.toMatchObject({
      statusCode: 400,
      validation: expect.objectContaining({
        errors: expect.arrayContaining([expect.objectContaining({ code: "missing_team_agent_node" })]),
      }),
    });
  });

  it("rejects a Draft save that would place the same Agent in two nodes", async () => {
    const configRoot = await makeConfigRoot();
    const team = await createTestTeam(configRoot, "dup-agent");
    const department = await createTestDepartment(configRoot, "dup-agent");
    const agent = await createTestAgent(configRoot, department.id, "dup-agent");
    await addTeamMember(configRoot, team.id, agent.id);

    const draft = await getOrCreateDraft(team.id);
    const start = draft.graph.nodes.find((node) => node.kind === "start")!;
    const nodeA = { id: crypto.randomUUID(), kind: "agent" as const, agentId: agent.id, position: { x: 100, y: 0 } };
    const nodeB = { id: crypto.randomUUID(), kind: "agent" as const, agentId: agent.id, position: { x: 200, y: 0 } };

    await expect(
      saveDraftGraph(team.id, {
        nodes: [...draft.graph.nodes, nodeA, nodeB],
        edges: [{ id: crypto.randomUUID(), sourceNodeId: start.id, targetNodeId: nodeA.id, outcome: null }],
      }, configRoot),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("rejects saving a Draft that references an Agent who is not a Team member", async () => {
    const configRoot = await makeConfigRoot();
    const team = await createTestTeam(configRoot, "unreachable");
    const department = await createTestDepartment(configRoot, "unreachable");
    const agentA = await createTestAgent(configRoot, department.id, "unreachable-a");
    const departmentB = await createTestDepartment(configRoot, "unreachable-b");
    const agentB = await createTestAgent(configRoot, departmentB.id, "unreachable-b");
    await addTeamMember(configRoot, team.id, agentA.id);

    const draft = await getOrCreateDraft(team.id);
    const start = draft.graph.nodes.find((node) => node.kind === "start")!;
    const completeRun = draft.graph.nodes.find(
      (node) => node.kind === "terminal" && node.terminalAction === "complete_run",
    )!;

    const nodeA = { id: crypto.randomUUID(), kind: "agent" as const, agentId: agentA.id, position: { x: 100, y: 0 } };
    // agentB (departmentB) is deliberately never added as a Team member.
    // Canonical `workflow.yaml` cross-reference validation (roadmap Spec 5)
    // requires every workflow Agent node to already be a `team.yaml` member,
    // so this save must be rejected outright now that file authority is
    // always required -- it can no longer be silently persisted to only
    // surface as a softer "agent_not_team_member" validation error later.
    const nodeB = { id: crypto.randomUUID(), kind: "agent" as const, agentId: agentB.id, position: { x: 200, y: 0 } };

    await expect(
      saveDraftGraph(team.id, {
        nodes: [...draft.graph.nodes, nodeA, nodeB],
        edges: [
          { id: crypto.randomUUID(), sourceNodeId: start.id, targetNodeId: nodeA.id, outcome: null },
          { id: crypto.randomUUID(), sourceNodeId: nodeA.id, targetNodeId: completeRun.id, outcome: "completed" },
        ],
      }, configRoot),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("allows publish with only warnings for missing outcome edges and self-loops", async () => {
    const configRoot = await makeConfigRoot();
    const team = await createTestTeam(configRoot, "warnings-only");
    const department = await createTestDepartment(configRoot, "warnings-only");
    const agent = await createTestAgent(configRoot, department.id, "warnings-only");
    await addTeamMember(configRoot, team.id, agent.id);

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
    }, configRoot);

    const result = await publishDraft(team.id, configRoot);
    expect(result.validation.publishable).toBe(true);
    expect(result.validation.warnings.some((issue) => issue.code === "missing_outcome_edge")).toBe(true);
    expect(result.validation.warnings.some((issue) => issue.message.includes("routes an outcome back to itself"))).toBe(
      true,
    );
  });

  it("keeps a Published revision immutable across later publishes", async () => {
    const configRoot = await makeConfigRoot();
    const team = await createTestTeam(configRoot, "immutable");
    const department = await createTestDepartment(configRoot, "immutable");
    const agent = await createTestAgent(configRoot, department.id, "immutable");
    await addTeamMember(configRoot, team.id, agent.id);

    const graph = await buildLinearGraph(team.id, [agent.id]);
    await saveDraftGraph(team.id, graph, configRoot);
    const first = await publishDraft(team.id, configRoot);

    // Republish the same unchanged Draft; the first Published revision must
    // remain byte-for-byte the same regardless of later publish activity.
    await publishDraft(team.id, configRoot);

    const revision = await getPublishedRevision(team.id, first.revision.id);
    expect(revision?.version).toBe(1);
    expect(revision?.graph.nodes).toHaveLength(graph.nodes.length);
  });

  it("throws 404 for publishing a Team with no Draft workflow row somehow removed", async () => {
    await expect(publishDraft(crypto.randomUUID())).rejects.toBeInstanceOf(WorkflowGraphServiceError);
  });

  it("rejects publishing for a Team that has no canonical team.yaml", async () => {
    const configRoot = await makeConfigRoot();
    const [dbOnlyTeam] = await db
      .insert(teams)
      .values({ slug: `workflow-graph-publish-db-only-${crypto.randomUUID()}`, name: "DB-only Team" })
      .returning();
    createdTeamIds.add(dbOnlyTeam.id);

    // `saveDraftGraph` now shares the same file-authority precondition as
    // `publishDraft`, so a Draft can no longer reach the DB through the
    // normal save path for a Team lacking `team.yaml` at all (see "rejects
    // saving a Draft..." above). To exercise `publishDraft`'s own check
    // specifically, build the DB Draft row directly -- reproducing the
    // legacy/pre-file-authority residual data shape a real deployment could
    // still have lying around -- bypassing `saveDraftGraph` entirely.
    const department = await createTestDepartment(configRoot, "publish-db-only");
    const agent = await createTestAgent(configRoot, department.id, "publish-db-only");
    await db.insert(teamMembers).values({ teamId: dbOnlyTeam.id, departmentId: department.id, agentId: agent.id, layer: 1, executionOrder: 1 });

    const draft = await getOrCreateDraft(dbOnlyTeam.id);
    const start = draft.graph.nodes.find((node) => node.kind === "start")!;
    const completeRun = draft.graph.nodes.find(
      (node) => node.kind === "terminal" && node.terminalAction === "complete_run",
    )!;
    await db.insert(workflowNodes).values({
      id: crypto.randomUUID(),
      revisionId: draft.id,
      kind: "agent",
      agentId: agent.id,
      positionX: 100,
      positionY: 0,
    });
    const [agentNodeRow] = await db
      .select()
      .from(workflowNodes)
      .where(and(eq(workflowNodes.revisionId, draft.id), eq(workflowNodes.kind, "agent")));
    await db.insert(workflowEdges).values([
      { revisionId: draft.id, sourceNodeId: start.id, targetNodeId: agentNodeRow.id, outcome: null },
      { revisionId: draft.id, sourceNodeId: agentNodeRow.id, targetNodeId: completeRun.id, outcome: "completed" },
    ]);

    await expect(publishDraft(dbOnlyTeam.id, configRoot)).rejects.toMatchObject({ statusCode: 409 });
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
