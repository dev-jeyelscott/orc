import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { db } from "../db/client.js";
import {
  agents,
  departments,
  teamMemberRoutes,
  teamMembers,
  teams,
  workflowEdges,
  workflowNodes,
  workflowRevisions,
} from "../db/schema.js";
import { createAgent } from "./agent-service.js";
import { createDepartment } from "./department-service.js";
import { createTeam } from "./team-service.js";
import { getPublishedRevision } from "./workflow-graph-service.js";
import { backfillTeamWorkflow } from "./workflow-backfill-service.js";

const createdAgentIds = new Set<string>();
const createdDepartmentIds = new Set<string>();
const createdTeamIds = new Set<string>();
const createdMemberIds = new Set<string>();
const createdRoots: string[] = [];

/**
 * `backfillTeamWorkflow` now requires canonical file authority (the owning
 * Team's `team.yaml` + every referenced Agent's `agent.yaml`) before it can
 * save/publish the converted graph, so Team/Department/Agent *identity* is
 * created through the file-authoritative services against a private
 * per-test `.orc/` root. Team membership + `team_member_routes` stay
 * inserted directly (as before): that's the legacy layer/order/routing data
 * this backfill reads FROM, not canonical config, and `team.yaml`'s
 * `members` list plays no part in `backfillTeamWorkflow`'s precondition
 * check or its DB-driven conversion logic.
 */
async function makeConfigRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "orc-workflow-backfill-test-"));
  createdRoots.push(root);
  return root;
}

async function createTestDepartment(configRoot: string, label: string, enabled = true) {
  const department = await createDepartment(
    {
      slug: `backfill-${label}-${crypto.randomUUID()}`,
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
      slug: `backfill-agent-${label}-${crypto.randomUUID()}`,
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
    { slug: `backfill-team-${label}-${crypto.randomUUID()}`, name: `${label} Team`, description: "", enabled: true },
    configRoot,
  );
  createdTeamIds.add(team.id);
  return team;
}

async function addMember(teamId: string, departmentId: string, agentId: string, layer: number, executionOrder = 1) {
  const [member] = await db
    .insert(teamMembers)
    .values({ teamId, departmentId, agentId, layer, executionOrder })
    .returning();
  createdMemberIds.add(member.id);
  return member;
}

async function addRoute(
  sourceTeamMemberId: string,
  outcome: "completed" | "approved" | "changes_requested" | "blocked" | "failed",
  target: { targetTeamMemberId?: string; terminalAction?: "complete_run" | "block_run" | "fail_run" },
) {
  await db.insert(teamMemberRoutes).values({
    sourceTeamMemberId,
    outcome,
    targetTeamMemberId: target.targetTeamMemberId ?? null,
    terminalAction: target.terminalAction ?? null,
  });
}

async function getPublishedRevisionRow(teamId: string) {
  const rows = await db
    .select()
    .from(workflowRevisions)
    .where(and(eq(workflowRevisions.teamId, teamId), eq(workflowRevisions.state, "published")));
  return rows[0];
}

afterEach(async () => {
  for (const memberId of createdMemberIds) {
    await db.delete(teamMemberRoutes).where(eq(teamMemberRoutes.sourceTeamMemberId, memberId));
  }
  for (const memberId of createdMemberIds) {
    await db.delete(teamMembers).where(eq(teamMembers.id, memberId));
  }

  for (const teamId of createdTeamIds) {
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
  createdMemberIds.clear();
  createdTeamIds.clear();
  createdAgentIds.clear();
  createdDepartmentIds.clear();

  for (const root of createdRoots.splice(0)) {
    await fs.rm(root, { recursive: true, force: true });
  }
});

describe("backfillTeamWorkflow", () => {
  it("skips a Team with no executable Agents", async () => {
    const configRoot = await makeConfigRoot();
    const team = await createTestTeam(configRoot, "empty");
    const result = await backfillTeamWorkflow(team.id, configRoot);
    expect(result).toEqual({ teamId: team.id, status: "skipped_no_agents" });
  });

  it("converts a single-Agent Team: Start -> Agent -> Complete Run", async () => {
    const configRoot = await makeConfigRoot();
    const team = await createTestTeam(configRoot, "single");
    const department = await createTestDepartment(configRoot, "single");
    const agent = await createTestAgent(configRoot, department.id, "single");
    await addMember(team.id, department.id, agent.id, 1);

    const result = await backfillTeamWorkflow(team.id, configRoot);
    expect(result.status).toBe("converted");
    if (result.status !== "converted") return;

    const publishedRow = await getPublishedRevisionRow(team.id);
    const published = await getPublishedRevision(team.id, publishedRow.id);
    expect(published).not.toBeNull();
    const agentNode = published!.graph.nodes.find((node) => node.kind === "agent")!;
    const start = published!.graph.nodes.find((node) => node.kind === "start")!;
    const completeRun = published!.graph.nodes.find((node) => node.kind === "terminal" && node.terminalAction === "complete_run")!;

    expect(published!.graph.edges.some((edge) => edge.sourceNodeId === start.id && edge.targetNodeId === agentNode.id && edge.outcome === null)).toBe(true);
    expect(published!.graph.edges.some((edge) => edge.sourceNodeId === agentNode.id && edge.targetNodeId === completeRun.id && edge.outcome === "completed")).toBe(true);
    expect(published!.graph.edges.some((edge) => edge.sourceNodeId === agentNode.id && edge.targetNodeId === completeRun.id && edge.outcome === "approved")).toBe(true);
  });

  it("converts a multi-layer Team, materializing default completed progression in order", async () => {
    const configRoot = await makeConfigRoot();
    const team = await createTestTeam(configRoot, "multi-layer");
    const department = await createTestDepartment(configRoot, "multi-layer");
    const agentA = await createTestAgent(configRoot, department.id, "multi-layer-a");
    const departmentB = await createTestDepartment(configRoot, "multi-layer-b");
    const agentB = await createTestAgent(configRoot, departmentB.id, "multi-layer-b");
    await addMember(team.id, department.id, agentA.id, 1);
    await addMember(team.id, departmentB.id, agentB.id, 2);

    const result = await backfillTeamWorkflow(team.id, configRoot);
    expect(result.status).toBe("converted");

    const publishedRow = await getPublishedRevisionRow(team.id);
    const revision = await getPublishedRevision(team.id, publishedRow.id);
    const nodeA = revision!.graph.nodes.find((node) => node.kind === "agent" && node.agentId === agentA.id)!;
    const nodeB = revision!.graph.nodes.find((node) => node.kind === "agent" && node.agentId === agentB.id)!;

    expect(revision!.graph.edges.some((edge) => edge.sourceNodeId === nodeA.id && edge.targetNodeId === nodeB.id && edge.outcome === "completed")).toBe(true);
  });

  it("respects an explicit completed override over default next-Agent progression", async () => {
    const configRoot = await makeConfigRoot();
    const team = await createTestTeam(configRoot, "explicit-override");
    const departmentA = await createTestDepartment(configRoot, "explicit-override-a");
    const agentA = await createTestAgent(configRoot, departmentA.id, "explicit-override-a");
    const departmentB = await createTestDepartment(configRoot, "explicit-override-b");
    const agentB = await createTestAgent(configRoot, departmentB.id, "explicit-override-b");
    const departmentC = await createTestDepartment(configRoot, "explicit-override-c");
    const agentC = await createTestAgent(configRoot, departmentC.id, "explicit-override-c");

    const memberA = await addMember(team.id, departmentA.id, agentA.id, 1);
    await addMember(team.id, departmentB.id, agentB.id, 2);
    const memberC = await addMember(team.id, departmentC.id, agentC.id, 3);

    // A's default next would be B (layer 2), but an explicit route sends it to C instead.
    await addRoute(memberA.id, "completed", { targetTeamMemberId: memberC.id });

    const result = await backfillTeamWorkflow(team.id, configRoot);
    expect(result.status).toBe("converted");

    const publishedRow = await getPublishedRevisionRow(team.id);
    const revision = await getPublishedRevision(team.id, publishedRow.id);
    const nodeA = revision!.graph.nodes.find((node) => node.kind === "agent" && node.agentId === agentA.id)!;
    const nodeB = revision!.graph.nodes.find((node) => node.kind === "agent" && node.agentId === agentB.id)!;
    const nodeC = revision!.graph.nodes.find((node) => node.kind === "agent" && node.agentId === agentC.id)!;

    expect(revision!.graph.edges.some((edge) => edge.sourceNodeId === nodeA.id && edge.outcome === "completed" && edge.targetNodeId === nodeC.id)).toBe(true);
    expect(revision!.graph.edges.some((edge) => edge.sourceNodeId === nodeA.id && edge.outcome === "completed" && edge.targetNodeId === nodeB.id)).toBe(false);
  });

  it("preserves a backward changes_requested loop and blocked/failed terminal routes", async () => {
    const configRoot = await makeConfigRoot();
    const team = await createTestTeam(configRoot, "loop-terminal");
    const departmentA = await createTestDepartment(configRoot, "loop-terminal-a");
    const agentA = await createTestAgent(configRoot, departmentA.id, "loop-terminal-a");
    const departmentB = await createTestDepartment(configRoot, "loop-terminal-b");
    const agentB = await createTestAgent(configRoot, departmentB.id, "loop-terminal-b");

    const memberA = await addMember(team.id, departmentA.id, agentA.id, 1);
    const memberB = await addMember(team.id, departmentB.id, agentB.id, 2);

    await addRoute(memberA.id, "changes_requested", { terminalAction: "block_run" });
    await addRoute(memberA.id, "blocked", { terminalAction: "block_run" });
    await addRoute(memberA.id, "failed", { terminalAction: "fail_run" });
    await addRoute(memberB.id, "changes_requested", { targetTeamMemberId: memberA.id });
    await addRoute(memberB.id, "blocked", { terminalAction: "block_run" });
    await addRoute(memberB.id, "failed", { terminalAction: "fail_run" });

    const result = await backfillTeamWorkflow(team.id, configRoot);
    expect(result.status).toBe("converted");

    const publishedRow = await getPublishedRevisionRow(team.id);
    const revision = await getPublishedRevision(team.id, publishedRow.id);
    const nodeA = revision!.graph.nodes.find((node) => node.kind === "agent" && node.agentId === agentA.id)!;
    const nodeB = revision!.graph.nodes.find((node) => node.kind === "agent" && node.agentId === agentB.id)!;
    const blockRun = revision!.graph.nodes.find((node) => node.kind === "terminal" && node.terminalAction === "block_run")!;
    const failRun = revision!.graph.nodes.find((node) => node.kind === "terminal" && node.terminalAction === "fail_run")!;

    // Backward loop preserved: B.changes_requested -> A.
    expect(revision!.graph.edges.some((edge) => edge.sourceNodeId === nodeB.id && edge.outcome === "changes_requested" && edge.targetNodeId === nodeA.id)).toBe(true);
    // A's own changes_requested was routed to Block Run explicitly.
    expect(revision!.graph.edges.some((edge) => edge.sourceNodeId === nodeA.id && edge.outcome === "changes_requested" && edge.targetNodeId === blockRun.id)).toBe(true);
    expect(revision!.graph.edges.some((edge) => edge.sourceNodeId === nodeA.id && edge.outcome === "failed" && edge.targetNodeId === failRun.id)).toBe(true);
  });

  it("filters out a disabled Agent exactly as the legacy runtime does", async () => {
    const configRoot = await makeConfigRoot();
    const team = await createTestTeam(configRoot, "disabled-filter");
    const departmentA = await createTestDepartment(configRoot, "disabled-filter-a");
    const agentA = await createTestAgent(configRoot, departmentA.id, "disabled-filter-a");
    const departmentB = await createTestDepartment(configRoot, "disabled-filter-b");
    const agentB = await createTestAgent(configRoot, departmentB.id, "disabled-filter-b", false);

    await addMember(team.id, departmentA.id, agentA.id, 1);
    await addMember(team.id, departmentB.id, agentB.id, 2);

    const result = await backfillTeamWorkflow(team.id, configRoot);
    expect(result.status).toBe("converted");

    const publishedRow = await getPublishedRevisionRow(team.id);
    const revision = await getPublishedRevision(team.id, publishedRow.id);
    const agentNodes = revision!.graph.nodes.filter((node) => node.kind === "agent");

    expect(agentNodes).toHaveLength(1);
    expect(agentNodes[0].kind === "agent" && agentNodes[0].agentId).toBe(agentA.id);
  });

  it("leaves an unrouted exceptional outcome unconfigured rather than inventing a fallback edge", async () => {
    const configRoot = await makeConfigRoot();
    const team = await createTestTeam(configRoot, "missing-exceptional");
    const department = await createTestDepartment(configRoot, "missing-exceptional");
    const agent = await createTestAgent(configRoot, department.id, "missing-exceptional");
    await addMember(team.id, department.id, agent.id, 1);
    // No route rows at all for changes_requested/blocked/failed.

    const result = await backfillTeamWorkflow(team.id, configRoot);
    expect(result.status).toBe("converted");

    const publishedRow = await getPublishedRevisionRow(team.id);
    const revision = await getPublishedRevision(team.id, publishedRow.id);
    const agentNode = revision!.graph.nodes.find((node) => node.kind === "agent")!;

    for (const outcome of ["changes_requested", "blocked", "failed"] as const) {
      expect(revision!.graph.edges.some((edge) => edge.sourceNodeId === agentNode.id && edge.outcome === outcome)).toBe(false);
    }
  });
});
