import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { db } from "./client.js";
import {
  agents,
  departments,
  teams,
  workflowEdges,
  workflowNodes,
  workflowRevisions,
} from "./schema.js";

const createdTeamIds = new Set<string>();
const createdDepartmentIds = new Set<string>();
const createdAgentIds = new Set<string>();
const createdRevisionIds = new Set<string>();

async function createTestTeam() {
  const [team] = await db
    .insert(teams)
    .values({ slug: `workflow-graph-${crypto.randomUUID()}`, name: "Workflow Graph Team" })
    .returning();
  createdTeamIds.add(team.id);
  return team;
}

async function createTestAgent() {
  const [department] = await db
    .insert(departments)
    .values({
      slug: `workflow-graph-department-${crypto.randomUUID()}`,
      name: "Workflow Graph Department",
      role: "Test",
      harness: "codex",
      defaultModel: "default",
      defaultReasoning: "high",
      systemPrompt: "Validate the workflow graph schema.",
    })
    .returning();
  createdDepartmentIds.add(department.id);

  const [agent] = await db
    .insert(agents)
    .values({
      departmentId: department.id,
      slug: `workflow-graph-agent-${crypto.randomUUID()}`,
      name: "Workflow Graph Agent",
    })
    .returning();
  createdAgentIds.add(agent.id);

  return agent;
}

async function createDraftRevision(teamId: string) {
  const [revision] = await db
    .insert(workflowRevisions)
    .values({ teamId, state: "draft" })
    .returning();
  createdRevisionIds.add(revision.id);
  return revision;
}

afterEach(async () => {
  for (const revisionId of createdRevisionIds) {
    await db.delete(workflowEdges).where(eq(workflowEdges.revisionId, revisionId));
    await db.delete(workflowNodes).where(eq(workflowNodes.revisionId, revisionId));
    await db.delete(workflowRevisions).where(eq(workflowRevisions.id, revisionId));
  }
  for (const agentId of createdAgentIds) {
    await db.delete(agents).where(eq(agents.id, agentId));
  }
  for (const departmentId of createdDepartmentIds) {
    await db.delete(departments).where(eq(departments.id, departmentId));
  }
  for (const teamId of createdTeamIds) {
    await db.delete(teams).where(eq(teams.id, teamId));
  }
  createdRevisionIds.clear();
  createdAgentIds.clear();
  createdDepartmentIds.clear();
  createdTeamIds.clear();
});

describe("workflow_revisions schema", () => {
  it("allows only one Draft revision per Team", async () => {
    const team = await createTestTeam();
    await createDraftRevision(team.id);

    await expect(createDraftRevision(team.id)).rejects.toThrow();
  });

  it("enforces unique Published version per Team", async () => {
    const team = await createTestTeam();
    const [first] = await db
      .insert(workflowRevisions)
      .values({ teamId: team.id, state: "published", version: 1, publishedAt: new Date() })
      .returning();
    createdRevisionIds.add(first.id);

    await expect(
      db.insert(workflowRevisions).values({
        teamId: team.id,
        state: "published",
        version: 1,
        publishedAt: new Date(),
      }),
    ).rejects.toThrow();
  });

  it("rejects a Draft revision with a version set", async () => {
    const team = await createTestTeam();
    await expect(
      db.insert(workflowRevisions).values({ teamId: team.id, state: "draft", version: 1 }),
    ).rejects.toThrow();
  });

  it("rejects a Published revision without publishedAt", async () => {
    const team = await createTestTeam();
    await expect(
      db.insert(workflowRevisions).values({ teamId: team.id, state: "published", version: 1 }),
    ).rejects.toThrow();
  });
});

describe("workflow_nodes schema", () => {
  it("rejects a start node with a non-null agentId", async () => {
    const team = await createTestTeam();
    const revision = await createDraftRevision(team.id);
    const agent = await createTestAgent();

    await expect(
      db.insert(workflowNodes).values({
        revisionId: revision.id,
        kind: "start",
        agentId: agent.id,
        positionX: 0,
        positionY: 0,
      }),
    ).rejects.toThrow();
  });

  it("rejects an agent node with a null agentId", async () => {
    const team = await createTestTeam();
    const revision = await createDraftRevision(team.id);

    await expect(
      db.insert(workflowNodes).values({
        revisionId: revision.id,
        kind: "agent",
        positionX: 0,
        positionY: 0,
      }),
    ).rejects.toThrow();
  });

  it("rejects a terminal node without a terminalAction", async () => {
    const team = await createTestTeam();
    const revision = await createDraftRevision(team.id);

    await expect(
      db.insert(workflowNodes).values({
        revisionId: revision.id,
        kind: "terminal",
        positionX: 0,
        positionY: 0,
      }),
    ).rejects.toThrow();
  });

  it("enforces one node per Agent per revision", async () => {
    const team = await createTestTeam();
    const revision = await createDraftRevision(team.id);
    const agent = await createTestAgent();

    await db.insert(workflowNodes).values({
      revisionId: revision.id,
      kind: "agent",
      agentId: agent.id,
      positionX: 0,
      positionY: 0,
    });

    await expect(
      db.insert(workflowNodes).values({
        revisionId: revision.id,
        kind: "agent",
        agentId: agent.id,
        positionX: 10,
        positionY: 10,
      }),
    ).rejects.toThrow();
  });

  it("enforces one node per terminal action per revision", async () => {
    const team = await createTestTeam();
    const revision = await createDraftRevision(team.id);

    await db.insert(workflowNodes).values({
      revisionId: revision.id,
      kind: "terminal",
      terminalAction: "complete_run",
      positionX: 0,
      positionY: 0,
    });

    await expect(
      db.insert(workflowNodes).values({
        revisionId: revision.id,
        kind: "terminal",
        terminalAction: "complete_run",
        positionX: 10,
        positionY: 10,
      }),
    ).rejects.toThrow();
  });
});

describe("workflow_edges schema", () => {
  it("rejects an edge whose source and target belong to different revisions", async () => {
    const team = await createTestTeam();
    const revisionA = await createDraftRevision(team.id);
    const [publishedRevision] = await db
      .insert(workflowRevisions)
      .values({ teamId: team.id, state: "published", version: 1, publishedAt: new Date() })
      .returning();
    createdRevisionIds.add(publishedRevision.id);

    const [startInA] = await db
      .insert(workflowNodes)
      .values({ revisionId: revisionA.id, kind: "start", positionX: 0, positionY: 0 })
      .returning();
    const [terminalInB] = await db
      .insert(workflowNodes)
      .values({
        revisionId: publishedRevision.id,
        kind: "terminal",
        terminalAction: "complete_run",
        positionX: 0,
        positionY: 0,
      })
      .returning();

    await expect(
      db.insert(workflowEdges).values({
        revisionId: revisionA.id,
        sourceNodeId: startInA.id,
        targetNodeId: terminalInB.id,
        outcome: null,
      }),
    ).rejects.toThrow();
  });

  it("allows only one Start-style (null outcome) edge per source node", async () => {
    const team = await createTestTeam();
    const revision = await createDraftRevision(team.id);
    const [start] = await db
      .insert(workflowNodes)
      .values({ revisionId: revision.id, kind: "start", positionX: 0, positionY: 0 })
      .returning();
    const [agentNodeA] = await db
      .insert(workflowNodes)
      .values({
        revisionId: revision.id,
        kind: "agent",
        agentId: (await createTestAgent()).id,
        positionX: 100,
        positionY: 0,
      })
      .returning();
    const [agentNodeB] = await db
      .insert(workflowNodes)
      .values({
        revisionId: revision.id,
        kind: "agent",
        agentId: (await createTestAgent()).id,
        positionX: 200,
        positionY: 0,
      })
      .returning();

    await db.insert(workflowEdges).values({
      revisionId: revision.id,
      sourceNodeId: start.id,
      targetNodeId: agentNodeA.id,
      outcome: null,
    });

    await expect(
      db.insert(workflowEdges).values({
        revisionId: revision.id,
        sourceNodeId: start.id,
        targetNodeId: agentNodeB.id,
        outcome: null,
      }),
    ).rejects.toThrow();
  });

  it("allows only one edge per (source, outcome) pair", async () => {
    const team = await createTestTeam();
    const revision = await createDraftRevision(team.id);
    const agentA = await createTestAgent();
    const [agentNode] = await db
      .insert(workflowNodes)
      .values({
        revisionId: revision.id,
        kind: "agent",
        agentId: agentA.id,
        positionX: 0,
        positionY: 0,
      })
      .returning();
    const [terminal1] = await db
      .insert(workflowNodes)
      .values({
        revisionId: revision.id,
        kind: "terminal",
        terminalAction: "complete_run",
        positionX: 100,
        positionY: 0,
      })
      .returning();
    const [terminal2] = await db
      .insert(workflowNodes)
      .values({
        revisionId: revision.id,
        kind: "terminal",
        terminalAction: "fail_run",
        positionX: 200,
        positionY: 0,
      })
      .returning();

    await db.insert(workflowEdges).values({
      revisionId: revision.id,
      sourceNodeId: agentNode.id,
      targetNodeId: terminal1.id,
      outcome: "completed",
    });

    await expect(
      db.insert(workflowEdges).values({
        revisionId: revision.id,
        sourceNodeId: agentNode.id,
        targetNodeId: terminal2.id,
        outcome: "completed",
      }),
    ).rejects.toThrow();
  });
});
