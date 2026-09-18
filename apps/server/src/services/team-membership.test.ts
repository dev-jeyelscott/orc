import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { db } from "../db/client.js";
import { agents, departments, teamMemberRoutes, teamMembers, teams, workflowEdges, workflowNodes, workflowRevisions } from "../db/schema.js";
import { createAgent } from "./agent-service.js";
import { createDepartment } from "./department-service.js";
import { createTeam } from "./team-service.js";
import { getOrCreateDraft, getWorkflowAggregate } from "./workflow-graph-service.js";
import {
  TeamMembershipServiceError,
  getTeamMembers,
  replaceTeamMembers,
} from "./team-membership.js";

const createdAgentIds = new Set<string>();
const createdDepartmentIds = new Set<string>();
const createdTeamIds = new Set<string>();
const createdRoots: string[] = [];

async function makeConfigRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "orc-team-membership-test-"));
  createdRoots.push(root);
  return root;
}

async function createTestDepartment(root: string, label: string) {
  const department = await createDepartment(
    {
      slug: `team-membership-${label}-${crypto.randomUUID()}`,
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
  return department;
}

async function createTestAgent(root: string, departmentId: string, label: string) {
  const agent = await createAgent(
    {
      departmentId,
      slug: `team-membership-agent-${label}-${crypto.randomUUID()}`,
      name: `${label} Agent`,
      enabled: true,
      additionalPrompt: "",
    },
    root,
  );
  createdAgentIds.add(agent.id);
  return agent;
}

async function createTestTeam(root: string, label: string) {
  const team = await createTeam(
    {
      slug: `team-membership-team-${label}-${crypto.randomUUID()}`,
      name: `${label} Team`,
      description: "",
      enabled: true,
    },
    root,
  );
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

  for (const root of createdRoots.splice(0)) {
    await fs.rm(root, { recursive: true, force: true });
  }
});

describe("getTeamMembers / replaceTeamMembers", () => {
  it("adds a member with no layer/order/route input", async () => {
    const root = await makeConfigRoot();
    const team = await createTestTeam(root, "add");
    const department = await createTestDepartment(root, "add");
    const agent = await createTestAgent(root, department.id, "add");

    const membership = await replaceTeamMembers(team.id, [agent.id], null, root);

    expect(membership.members).toHaveLength(1);
    expect(membership.members[0].agentId).toBe(agent.id);
    expect(membership.configRevision).toMatch(/^[0-9a-f]{64}$/);
  });

  it("removes a member", async () => {
    const root = await makeConfigRoot();
    const team = await createTestTeam(root, "remove");
    const department = await createTestDepartment(root, "remove");
    const agent = await createTestAgent(root, department.id, "remove");

    await replaceTeamMembers(team.id, [agent.id], null, root);
    const membership = await replaceTeamMembers(team.id, [], null, root);

    expect(membership.members).toHaveLength(0);
  });

  it("rejects an Agent that already belongs to another Team", async () => {
    const root = await makeConfigRoot();
    const teamA = await createTestTeam(root, "cross-a");
    const teamB = await createTestTeam(root, "cross-b");
    const department = await createTestDepartment(root, "cross");
    const agent = await createTestAgent(root, department.id, "cross");

    await replaceTeamMembers(teamA.id, [agent.id], null, root);

    await expect(replaceTeamMembers(teamB.id, [agent.id], null, root)).rejects.toBeInstanceOf(TeamMembershipServiceError);
  });

  it("rejects two Agents from the same Department", async () => {
    const root = await makeConfigRoot();
    const team = await createTestTeam(root, "dup-dept");
    const department = await createTestDepartment(root, "dup-dept");
    const agentA = await createTestAgent(root, department.id, "dup-dept-a");
    const agentB = await createTestAgent(root, department.id, "dup-dept-b");

    await expect(replaceTeamMembers(team.id, [agentA.id, agentB.id], null, root)).rejects.toBeInstanceOf(
      TeamMembershipServiceError,
    );
  });

  it("never writes any workflow_nodes/workflow_edges row on a membership change", async () => {
    const root = await makeConfigRoot();
    const team = await createTestTeam(root, "no-graph-write");
    const department = await createTestDepartment(root, "no-graph-write");
    const agent = await createTestAgent(root, department.id, "no-graph-write");

    await getOrCreateDraft(team.id);
    await replaceTeamMembers(team.id, [agent.id], null, root);

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
    const root = await makeConfigRoot();
    const team = await createTestTeam(root, "validation-visibility");
    const department = await createTestDepartment(root, "validation-visibility");
    const agent = await createTestAgent(root, department.id, "validation-visibility");

    await getOrCreateDraft(team.id);
    await replaceTeamMembers(team.id, [agent.id], null, root);

    const aggregate = await getWorkflowAggregate(team.id);
    expect(aggregate?.validation.errors.some((issue) => issue.code === "missing_team_agent_node")).toBe(true);

    // The Agent node is still absent -- validation surfaced it, nothing auto-added it.
    expect(aggregate?.draft.graph.nodes.some((node) => node.kind === "agent")).toBe(false);
  });

  it("rejects a membership save against a stale configRevision", async () => {
    const root = await makeConfigRoot();
    const team = await createTestTeam(root, "stale");
    const department = await createTestDepartment(root, "stale");
    const agent = await createTestAgent(root, department.id, "stale");

    await replaceTeamMembers(team.id, [agent.id], null, root);

    await expect(
      replaceTeamMembers(team.id, [], "not-the-current-revision", root),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("returns null for a nonexistent Team", async () => {
    expect(await getTeamMembers(crypto.randomUUID())).toBeNull();
  });
});
