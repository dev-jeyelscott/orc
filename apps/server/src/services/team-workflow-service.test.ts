import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { db } from "../db/client.js";
import {
  agents,
  departments,
  teamMemberRoutes,
  teamMembers,
  teams,
} from "../db/schema.js";
import {
  getTeamWorkflow,
  replaceTeamWorkflow,
  TeamWorkflowServiceError,
} from "./team-workflow-service.js";

const createdAgentIds = new Set<string>();
const createdDepartmentIds = new Set<string>();
const createdTeamIds = new Set<string>();

const departmentInput = (label: string) => ({
  slug: `team-workflow-${label}-${crypto.randomUUID()}`,
  name: `${label} Department`,
  role: `${label} Role`,
  harness: "codex" as const,
  defaultModel: "default",
  defaultReasoning: "high",
  systemPrompt: `Act as ${label}.`,
  canWrite: false,
  canRunCommands: true,
  canCommit: false,
});

async function createTestDepartment(label: string) {
  const [department] = await db
    .insert(departments)
    .values(departmentInput(label))
    .returning();

  createdDepartmentIds.add(department.id);

  return department;
}

async function createTestAgent(departmentId: string, label: string) {
  const [agent] = await db
    .insert(agents)
    .values({
      departmentId,
      slug: `team-workflow-agent-${label}-${crypto.randomUUID()}`,
      name: `${label} Agent`,
      enabled: true,
    })
    .returning();

  createdAgentIds.add(agent.id);

  return agent;
}

async function createTestTeam(label: string) {
  const [team] = await db
    .insert(teams)
    .values({
      slug: `team-workflow-team-${label}-${crypto.randomUUID()}`,
      name: `${label} Team`,
    })
    .returning();

  createdTeamIds.add(team.id);

  return team;
}

const fullRoutes = (targetAgentId: string | null) => [
  {
    outcome: "changes_requested" as const,
    targetAgentId,
    terminalAction: targetAgentId ? null : ("block_run" as const),
  },
  {
    outcome: "blocked" as const,
    targetAgentId: null,
    terminalAction: "block_run" as const,
  },
  {
    outcome: "failed" as const,
    targetAgentId: null,
    terminalAction: "fail_run" as const,
  },
];

afterEach(async () => {
  for (const id of createdTeamIds) {
    const memberRows = await db
      .select({ id: teamMembers.id })
      .from(teamMembers)
      .where(eq(teamMembers.teamId, id));

    for (const member of memberRows) {
      await db
        .delete(teamMemberRoutes)
        .where(eq(teamMemberRoutes.sourceTeamMemberId, member.id));
    }

    await db.delete(teamMembers).where(eq(teamMembers.teamId, id));
    await db.delete(teams).where(eq(teams.id, id));
  }

  createdTeamIds.clear();

  for (const id of createdAgentIds) {
    await db.delete(agents).where(eq(agents.id, id));
  }

  createdAgentIds.clear();

  for (const id of createdDepartmentIds) {
    await db.delete(departments).where(eq(departments.id, id));
  }

  createdDepartmentIds.clear();
});

describe("team-workflow-service", () => {
  it("persists composition, layer/order, and routing through GET/PUT", async () => {
    const team = await createTestTeam("lifecycle");
    const departmentA = await createTestDepartment("lifecycle-a");
    const departmentB = await createTestDepartment("lifecycle-b");
    const agentA = await createTestAgent(departmentA.id, "lifecycle-a");
    const agentB = await createTestAgent(departmentB.id, "lifecycle-b");

    const saved = await replaceTeamWorkflow(team.id, {
      members: [
        {
          agentId: agentA.id,
          layer: 1,
          executionOrder: 1,
          routes: fullRoutes(null),
        },
        {
          agentId: agentB.id,
          layer: 2,
          executionOrder: 1,
          routes: fullRoutes(agentA.id),
        },
      ],
    });

    expect(saved.members).toHaveLength(2);
    expect(saved.members[0]?.agentId).toBe(agentA.id);
    expect(saved.members[1]?.agentId).toBe(agentB.id);

    const loaded = await getTeamWorkflow(team.id);

    expect(loaded?.members.map((member) => member.agentId)).toEqual([
      agentA.id,
      agentB.id,
    ]);

    const secondMemberRoutes = loaded?.members[1]?.routes ?? [];

    expect(
      secondMemberRoutes.find((route) => route.outcome === "changes_requested")
        ?.targetAgentId,
    ).toBe(agentA.id);
  });

  it("rejects a Team may only select one Agent from each Department", async () => {
    const team = await createTestTeam("dup-department");
    const department = await createTestDepartment("dup-department");
    const agentA = await createTestAgent(department.id, "dup-department-a");
    const agentB = await createTestAgent(department.id, "dup-department-b");

    await expect(
      replaceTeamWorkflow(team.id, {
        members: [
          { agentId: agentA.id, layer: 1, executionOrder: 1, routes: fullRoutes(null) },
          { agentId: agentB.id, layer: 2, executionOrder: 1, routes: fullRoutes(null) },
        ],
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("rejects duplicate layer/execution-order placement", async () => {
    const team = await createTestTeam("dup-placement");
    const departmentA = await createTestDepartment("dup-placement-a");
    const departmentB = await createTestDepartment("dup-placement-b");
    const agentA = await createTestAgent(departmentA.id, "dup-placement-a");
    const agentB = await createTestAgent(departmentB.id, "dup-placement-b");

    await expect(
      replaceTeamWorkflow(team.id, {
        members: [
          { agentId: agentA.id, layer: 1, executionOrder: 1, routes: fullRoutes(null) },
          { agentId: agentB.id, layer: 1, executionOrder: 1, routes: fullRoutes(null) },
        ],
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("rejects an Agent already assigned to another Team", async () => {
    const teamOne = await createTestTeam("exclusive-one");
    const teamTwo = await createTestTeam("exclusive-two");
    const department = await createTestDepartment("exclusive");
    const agent = await createTestAgent(department.id, "exclusive");

    await replaceTeamWorkflow(teamOne.id, {
      members: [
        { agentId: agent.id, layer: 1, executionOrder: 1, routes: fullRoutes(null) },
      ],
    });

    await expect(
      replaceTeamWorkflow(teamTwo.id, {
        members: [
          { agentId: agent.id, layer: 1, executionOrder: 1, routes: fullRoutes(null) },
        ],
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("rejects a save missing an explicit exceptional-outcome route", async () => {
    const team = await createTestTeam("missing-route");
    const department = await createTestDepartment("missing-route");
    const agent = await createTestAgent(department.id, "missing-route");

    await expect(
      replaceTeamWorkflow(team.id, {
        members: [
          {
            agentId: agent.id,
            layer: 1,
            executionOrder: 1,
            routes: [
              { outcome: "blocked", targetAgentId: null, terminalAction: "block_run" },
            ],
          },
        ],
      }),
    ).rejects.toBeInstanceOf(TeamWorkflowServiceError);
  });

  it("rejects a route target outside the desired Team composition", async () => {
    const team = await createTestTeam("bad-target");
    const department = await createTestDepartment("bad-target");
    const outsideDepartment = await createTestDepartment("bad-target-outside");
    const agent = await createTestAgent(department.id, "bad-target");
    const outsideAgent = await createTestAgent(
      outsideDepartment.id,
      "bad-target-outside",
    );

    await expect(
      replaceTeamWorkflow(team.id, {
        members: [
          {
            agentId: agent.id,
            layer: 1,
            executionOrder: 1,
            routes: fullRoutes(outsideAgent.id),
          },
        ],
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("atomically replaces a full workflow, dropping removed members and their routes", async () => {
    const team = await createTestTeam("replace");
    const departmentA = await createTestDepartment("replace-a");
    const departmentB = await createTestDepartment("replace-b");
    const agentA = await createTestAgent(departmentA.id, "replace-a");
    const agentB = await createTestAgent(departmentB.id, "replace-b");

    await replaceTeamWorkflow(team.id, {
      members: [
        { agentId: agentA.id, layer: 1, executionOrder: 1, routes: fullRoutes(null) },
        { agentId: agentB.id, layer: 2, executionOrder: 1, routes: fullRoutes(null) },
      ],
    });

    const replaced = await replaceTeamWorkflow(team.id, {
      members: [
        { agentId: agentA.id, layer: 1, executionOrder: 1, routes: fullRoutes(null) },
      ],
    });

    expect(replaced.members).toHaveLength(1);
    expect(replaced.members[0]?.agentId).toBe(agentA.id);

    const reloaded = await getTeamWorkflow(team.id);

    expect(reloaded?.members).toHaveLength(1);
  });

  it("returns null for a Team that does not exist", async () => {
    expect(
      await getTeamWorkflow("00000000-0000-4000-9000-000000009999"),
    ).toBeNull();
  });
});
