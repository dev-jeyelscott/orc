import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import type { WorkflowGraph, WorkflowGraphNode } from "@orc/shared";

import { getTeamWorkflowRevision } from "../config/config-mutation-service.js";
import { loadConfigGraph } from "../config/loader.js";
import { db } from "../db/client.js";
import { agents, departments, teamMembers, teams, workflowEdges, workflowNodes, workflowRevisions } from "../db/schema.js";
import { createAgent } from "./agent-service.js";
import { createDepartment } from "./department-service.js";
import { createTeam } from "./team-service.js";
import { replaceTeamMembers } from "./team-membership.js";
import {
  getOrCreateDraft,
  publishDraft,
  reconstructTeamWorkflowProjection,
  saveDraftGraph,
} from "./workflow-graph-service.js";

const createdAgentIds = new Set<string>();
const createdDepartmentIds = new Set<string>();
const createdTeamIds = new Set<string>();
const createdRoots: string[] = [];

async function makeConfigRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "orc-workflow-config-test-"));
  createdRoots.push(root);
  return root;
}

async function setupTeamWithAgent(root: string, label: string) {
  const department = await createDepartment(
    {
      slug: `workflow-cfg-${label}-${crypto.randomUUID()}`,
      name: `${label} Department`,
      role: `${label} Role`,
      harness: "codex" as const,
      defaultModel: "default",
      defaultReasoning: "high",
      systemPrompt: `Act as ${label}.`,
    },
    root,
  );
  createdDepartmentIds.add(department.id);

  const agent = await createAgent(
    {
      departmentId: department.id,
      slug: `workflow-cfg-agent-${label}-${crypto.randomUUID()}`,
      name: `${label} Agent`,
      enabled: true,
      additionalPrompt: "",
    },
    root,
  );
  createdAgentIds.add(agent.id);

  const team = await createTeam(
    {
      slug: `workflow-cfg-team-${label}-${crypto.randomUUID()}`,
      name: `${label} Team`,
      description: "",
      enabled: true,
    },
    root,
  );
  createdTeamIds.add(team.id);

  await replaceTeamMembers(team.id, [agent.id], null, root);

  return { department, agent, team };
}

function buildGraphForAgent(agentId: string, draft: Awaited<ReturnType<typeof getOrCreateDraft>>): WorkflowGraph {
  const start = draft.graph.nodes.find((node): node is Extract<WorkflowGraphNode, { kind: "start" }> => node.kind === "start")!;
  const completeRun = draft.graph.nodes.find(
    (node): node is Extract<WorkflowGraphNode, { kind: "terminal" }> => node.kind === "terminal" && node.terminalAction === "complete_run",
  )!;

  const agentNode: Extract<WorkflowGraphNode, { kind: "agent" }> = {
    id: crypto.randomUUID(),
    kind: "agent",
    agentId,
    position: { x: 0, y: 240 },
  };

  return {
    nodes: [...draft.graph.nodes, agentNode],
    edges: [
      { id: crypto.randomUUID(), sourceNodeId: start.id, targetNodeId: agentNode.id, outcome: null },
      { id: crypto.randomUUID(), sourceNodeId: agentNode.id, targetNodeId: completeRun.id, outcome: "completed" },
      { id: crypto.randomUUID(), sourceNodeId: agentNode.id, targetNodeId: completeRun.id, outcome: "approved" },
    ],
  };
}

afterEach(async () => {
  for (const teamId of createdTeamIds) {
    const revisionRows = await db.select({ id: workflowRevisions.id }).from(workflowRevisions).where(eq(workflowRevisions.teamId, teamId));
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

describe("workflow.yaml canonical projection (Vertical Spec 5)", () => {
  it("writes the canonical Draft graph with symbolic Agent keys on Draft save", async () => {
    const root = await makeConfigRoot();
    const { agent, team } = await setupTeamWithAgent(root, "draft");

    const draft = await getOrCreateDraft(team.id);
    const graph = buildGraphForAgent(agent.id, draft);

    await saveDraftGraph(team.id, graph, root);

    const configGraph = await loadConfigGraph(root);
    const teamResource = configGraph.teams.find((resource) => resource.data.slug === team.slug);

    expect(teamResource?.workflow?.data.draft.nodes.some((node) => node.kind === "agent" && node.agent === agent.slug)).toBe(true);
    expect(teamResource?.workflow?.data.published).toBeNull();
    expect(await getTeamWorkflowRevision(root, team.slug)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("publishes the canonical Published graph and increments the canonical version, leaving Draft untouched", async () => {
    const root = await makeConfigRoot();
    const { agent, team } = await setupTeamWithAgent(root, "publish");

    const draft = await getOrCreateDraft(team.id);
    const graph = buildGraphForAgent(agent.id, draft);
    await saveDraftGraph(team.id, graph, root);

    const result = await publishDraft(team.id, root);
    expect(result.revision.version).toBe(1);

    const configGraph = await loadConfigGraph(root);
    const teamResource = configGraph.teams.find((resource) => resource.data.slug === team.slug);

    expect(teamResource?.workflow?.data.published?.version).toBe(1);
    expect(teamResource?.workflow?.data.published?.graph.nodes.some((node) => node.kind === "agent" && node.agent === agent.slug)).toBe(
      true,
    );
    // Draft remains present after publish (never cleared).
    expect(teamResource?.workflow?.data.draft.nodes.some((node) => node.kind === "agent")).toBe(true);

    const [publishedRow] = await db
      .select()
      .from(workflowRevisions)
      .where(and(eq(workflowRevisions.teamId, team.id), eq(workflowRevisions.state, "published")));
    expect(publishedRow.version).toBe(1);

    // Publishing again increments the canonical file version and creates a new immutable DB revision.
    const second = await publishDraft(team.id, root);
    expect(second.revision.version).toBe(2);

    const configGraphAfterSecond = await loadConfigGraph(root);
    expect(configGraphAfterSecond.teams.find((resource) => resource.data.slug === team.slug)?.workflow?.data.published?.version).toBe(2);
  });

  it("reconstructs a missing Published DB revision from the canonical file (fresh-DB recovery)", async () => {
    const root = await makeConfigRoot();
    const { agent, team } = await setupTeamWithAgent(root, "recover-published");

    const draft = await getOrCreateDraft(team.id);
    const graph = buildGraphForAgent(agent.id, draft);
    await saveDraftGraph(team.id, graph, root);
    await publishDraft(team.id, root);

    // Simulate a fresh database: drop the Published revision's rows only.
    const [publishedRow] = await db
      .select()
      .from(workflowRevisions)
      .where(and(eq(workflowRevisions.teamId, team.id), eq(workflowRevisions.state, "published")));
    await db.delete(workflowEdges).where(eq(workflowEdges.revisionId, publishedRow.id));
    await db.delete(workflowNodes).where(eq(workflowNodes.revisionId, publishedRow.id));
    await db.delete(workflowRevisions).where(eq(workflowRevisions.id, publishedRow.id));

    const [missing] = await db
      .select()
      .from(workflowRevisions)
      .where(and(eq(workflowRevisions.teamId, team.id), eq(workflowRevisions.state, "published")));
    expect(missing).toBeUndefined();

    await reconstructTeamWorkflowProjection(team.id, root);

    const [reconstructed] = await db
      .select()
      .from(workflowRevisions)
      .where(and(eq(workflowRevisions.teamId, team.id), eq(workflowRevisions.state, "published")));
    expect(reconstructed.version).toBe(1);

    const nodeRows = await db.select().from(workflowNodes).where(eq(workflowNodes.revisionId, reconstructed.id));
    expect(nodeRows.some((row) => row.kind === "agent" && row.agentId === agent.id)).toBe(true);
  });

  it("reconstructs the Draft graph from the canonical file (fresh-DB recovery)", async () => {
    const root = await makeConfigRoot();
    const { agent, team } = await setupTeamWithAgent(root, "recover-draft");

    const draft = await getOrCreateDraft(team.id);
    const graph = buildGraphForAgent(agent.id, draft);
    await saveDraftGraph(team.id, graph, root);

    const [draftRow] = await db
      .select()
      .from(workflowRevisions)
      .where(and(eq(workflowRevisions.teamId, team.id), eq(workflowRevisions.state, "draft")));
    await db.delete(workflowEdges).where(eq(workflowEdges.revisionId, draftRow.id));
    await db.delete(workflowNodes).where(eq(workflowNodes.revisionId, draftRow.id));

    await reconstructTeamWorkflowProjection(team.id, root);

    const nodeRows = await db.select().from(workflowNodes).where(eq(workflowNodes.revisionId, draftRow.id));
    expect(nodeRows.some((row) => row.kind === "agent" && row.agentId === agent.id)).toBe(true);
  });
});
