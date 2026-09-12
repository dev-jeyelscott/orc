import {
  eq,
} from "drizzle-orm";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type {
  Project,
} from "@orc/shared";

const discoveryMocks = vi.hoisted(() => ({
  getProject: vi.fn(),
  getProjectByPath: vi.fn(),
}));

vi.mock("./project-discovery.js", () => discoveryMocks);

import {
  db,
} from "../db/client.js";
import {
  agents,
  departments,
  projectTeamAssignments,
  tasks,
  teamMembers,
  teams,
} from "../db/schema.js";
import {
  upsertProjectTeamAssignment,
} from "./project-team-assignment-service.js";
import {
  createTask,
} from "./workflow-service.js";

const project: Project = {
  id: "project-assignment-workflow",
  name: "project-assignment-workflow",
  path: `/tmp/project-assignment-workflow-${crypto.randomUUID()}`,
  branch: "main",
  gitState: "clean",
  primaryFiles: ["package.json"],
  packageManager: "pnpm",
  stack: "node",
};

const created = {
  teamIds: new Set<string>(),
  departmentIds: new Set<string>(),
  agentIds: new Set<string>(),
  taskIds: new Set<string>(),
};

async function createRunnableTeam(label: string) {
  const [team] = await db.insert(teams).values({
    slug: `assignment-workflow-${label}-${crypto.randomUUID()}`,
    name: `Assignment Workflow ${label}`,
    description: "",
    enabled: true,
  }).returning();
  created.teamIds.add(team.id);

  const [department] = await db.insert(departments).values({
    slug: `assignment-workflow-department-${label}-${crypto.randomUUID()}`,
    name: `Assignment Workflow Department ${label}`,
    role: "Worker",
    harness: "codex",
    defaultModel: "default",
    defaultReasoning: "low",
    systemPrompt: "Perform the task.",
  }).returning();
  created.departmentIds.add(department.id);

  const [agent] = await db.insert(agents).values({
    departmentId: department.id,
    slug: `assignment-workflow-agent-${label}-${crypto.randomUUID()}`,
    name: `Assignment Workflow Agent ${label}`,
    enabled: true,
  }).returning();
  created.agentIds.add(agent.id);
  await db.insert(teamMembers).values({ teamId: team.id, departmentId: department.id, agentId: agent.id, layer: 1, executionOrder: 1 });
  return team;
}

beforeEach(() => {
  discoveryMocks.getProject.mockReset();
  discoveryMocks.getProjectByPath.mockReset();
  discoveryMocks.getProject.mockResolvedValue(project);
  discoveryMocks.getProjectByPath.mockResolvedValue(project);
});

afterEach(async () => {
  for (const taskId of created.taskIds) await db.delete(tasks).where(eq(tasks.id, taskId));
  await db.delete(projectTeamAssignments).where(eq(projectTeamAssignments.projectPath, project.path));
  for (const agentId of created.agentIds) await db.delete(teamMembers).where(eq(teamMembers.agentId, agentId));
  for (const agentId of created.agentIds) await db.delete(agents).where(eq(agents.id, agentId));
  for (const departmentId of created.departmentIds) await db.delete(departments).where(eq(departments.id, departmentId));
  for (const teamId of created.teamIds) await db.delete(teams).where(eq(teams.id, teamId));
  Object.values(created).forEach((ids) => ids.clear());
});

describe.sequential("Project assignment Task ownership", () => {
  it("uses an assigned Team by default, permits explicit Team selection when unassigned, and preserves old Task ownership after reassignment", async () => {
    const assignedTeam = await createRunnableTeam("assigned");
    const replacementTeam = await createRunnableTeam("replacement");
    const explicitTeam = await createRunnableTeam("explicit");

    const unassigned = await createTask({ projectId: project.id, teamId: explicitTeam.id, title: "Explicit unassigned Task", instruction: "Use the explicit Team." });
    created.taskIds.add(unassigned.id);
    expect(unassigned.teamId).toBe(explicitTeam.id);

    await upsertProjectTeamAssignment(project.path, { teamId: assignedTeam.id, notionDataSourceId: null, autoModeEnabled: false });
    const assigned = await createTask({ projectId: project.id, title: "Assigned Task", instruction: "Use the assigned Team." });
    created.taskIds.add(assigned.id);
    expect(assigned.teamId).toBe(assignedTeam.id);

    await upsertProjectTeamAssignment(project.path, { teamId: replacementTeam.id, notionDataSourceId: null, autoModeEnabled: false });
    const [historical] = await db.select({ teamId: tasks.teamId }).from(tasks).where(eq(tasks.id, assigned.id));
    expect(historical.teamId).toBe(assignedTeam.id);
  });
});
