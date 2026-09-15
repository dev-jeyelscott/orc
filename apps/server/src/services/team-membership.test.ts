import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { db } from "../db/client.js";
import { agents, departments, teamMemberRoutes, teamMembers, teams, workflowEdges, workflowNodes, workflowRevisions } from "../db/schema.js";
import { getOrCreateDraft, getWorkflowAggregate } from "./workflow-graph-service.js";
import {
  TeamMembershipServiceError,
  getTeamMembers,
  replaceTeamMembers,
} from "./team-membership.js";

const createdAgentIds = new Set<string>();
const createdDepartmentIds = new Set<string>();
const createdTeamIds = new Set<string>();

async function createTestDepartment(label: string) {
  const [department] = await db
    .insert(departments)
    .values({
      slug: `team-membership-${label}-${crypto.randomUUID()}`,
      name: `${label} Department`,
      role: `${label} Role`,
      harness: "codex" as const,
      defaultModel: "default",
      defaultReasoning: "high",
      systemPrompt: `Act as ${label}.`,
    })
    .returning();
  createdDepartmentIds.add(department.id);
  return department;
}

async function createTestAgent(departmentId: string, label: string) {
  const [agent] = await db
    .insert(agents)
    .values({ departmentId, slug: `team-membership-agent-${label}-${crypto.randomUUID()}`, name: `${label} Agent` })
    .returning();
  createdAgentIds.add(agent.id);
  return agent;
}

async function createTestTeam(label: string) {
  const [team] = await db
    .insert(teams)
    .values({ slug: `team-membership-team-${label}-${crypto.randomUUID()}`, name: `${label} Team` })
    .returning();
  createdTeamIds.add(team.id);
  return team;
}

afterEach(async () => {
  for (const teamId of createdTeamIds) {
    const memberRows = await db.select({ id: teamMembers.id }).from(teamMembers).where(eq(teamMembers.teamId, teamId));
    for (const member of memberRows) {
      await db.delete(teamMemberRoutes).where(eq(teamMemberRoutes.sourceTeamMemberId, member.id));
    }
    await db.delete(teamMembers).where(eq(teamMembers.teamId, teamId));

    const revisionRows = await db.select({ id: workflowRevisions.id }).from(workflowRevisions).where(eq(workflowRevisions.teamId, teamId));
    for (const revision of revisionRows) {
      await db.delete(workflowEdges).where(eq(workflowEdges.revisionId, revision.id));
      await db.delete(workflowNodes).where(eq(workflowNodes.revisionId, revision.id));
    }
    await db.delete(workflowRevisions).where(eq(workflowRevisions.teamId, teamId));

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

describe("getTeamMembers / replaceTeamMembers", () => {
  it("adds a member with no layer/order/route input", async () => {
    const team = await createTestTeam("add");
    const department = await createTestDepartment("add");
    const agent = await createTestAgent(department.id, "add");

    const membership = await replaceTeamMembers(team.id, [agent.id]);

    expect(membership.members).toHaveLength(1);
    expect(membership.members[0].agentId).toBe(agent.id);
  });

  it("removes a member", async () => {
    const team = await createTestTeam("remove");
    const department = await createTestDepartment("remove");
    const agent = await createTestAgent(department.id, "remove");

    await replaceTeamMembers(team.id, [agent.id]);
    const membership = await replaceTeamMembers(team.id, []);

    expect(membership.members).toHaveLength(0);
  });

  it("rejects an Agent that already belongs to another Team", async () => {
    const teamA = await createTestTeam("cross-a");
    const teamB = await createTestTeam("cross-b");
    const department = await createTestDepartment("cross");
    const agent = await createTestAgent(department.id, "cross");

    await replaceTeamMembers(teamA.id, [agent.id]);

    await expect(replaceTeamMembers(teamB.id, [agent.id])).rejects.toBeInstanceOf(TeamMembershipServiceError);
  });

  it("rejects two Agents from the same Department", async () => {
    const team = await createTestTeam("dup-dept");
    const department = await createTestDepartment("dup-dept");
    const agentA = await createTestAgent(department.id, "dup-dept-a");
    const agentB = await createTestAgent(department.id, "dup-dept-b");

    await expect(replaceTeamMembers(team.id, [agentA.id, agentB.id])).rejects.toBeInstanceOf(
      TeamMembershipServiceError,
    );
  });

  it("never writes any workflow_nodes/workflow_edges row on a membership change", async () => {
    const team = await createTestTeam("no-graph-write");
    const department = await createTestDepartment("no-graph-write");
    const agent = await createTestAgent(department.id, "no-graph-write");

    await getOrCreateDraft(team.id);
    await replaceTeamMembers(team.id, [agent.id]);

    const nodeRows = await db
      .select()
      .from(workflowNodes)
      .innerJoin(workflowRevisions, eq(workflowRevisions.id, workflowNodes.revisionId))
      .where(eq(workflowRevisions.teamId, team.id));

    // Only the four system nodes seeded by getOrCreateDraft should exist --
    // the membership change must not have added an Agent node.
    expect(nodeRows).toHaveLength(4);
    expect(nodeRows.every((row) => row.workflow_nodes.kind !== "agent")).toBe(true);
  });

  it("makes an enabled member's absence from the Draft visible as validation, without mutating the graph", async () => {
    const team = await createTestTeam("validation-visibility");
    const department = await createTestDepartment("validation-visibility");
    const agent = await createTestAgent(department.id, "validation-visibility");

    await getOrCreateDraft(team.id);
    await replaceTeamMembers(team.id, [agent.id]);

    const aggregate = await getWorkflowAggregate(team.id);
    expect(aggregate?.validation.errors.some((issue) => issue.code === "missing_team_agent_node")).toBe(true);

    // The Agent node is still absent -- validation surfaced it, nothing auto-added it.
    expect(aggregate?.draft.graph.nodes.some((node) => node.kind === "agent")).toBe(false);
  });

  it("returns null for a nonexistent Team", async () => {
    expect(await getTeamMembers(crypto.randomUUID())).toBeNull();
  });
});
