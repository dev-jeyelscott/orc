import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

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
import { createAgent } from "./agent-service.js";
import { createDepartment } from "./department-service.js";
import { replaceTeamMembers } from "./team-membership.js";
import { createTeam } from "./team-service.js";
import {
  upsertProjectTeamAssignment,
} from "./project-team-assignment-service.js";
import {
  createTask,
} from "./workflow-service.js";

const workspaceParent = os.tmpdir();
const project: Project = {
  id: "project-assignment-workflow",
  name: "project-assignment-workflow",
  path: path.join(workspaceParent, `project-assignment-workflow-${crypto.randomUUID()}`),
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
const createdRoots: string[] = [];

async function makeConfigRoot(): Promise<string> {
  // `project.path`'s parent must equal the canonical workspace root so
  // `upsertProjectTeamAssignment`'s path-containment check passes; actual
  // filesystem discovery is mocked below, only the containment math is real.
  const configRoot = await fs.mkdtemp(path.join(os.tmpdir(), "orc-project-assignment-wf-config-"));
  createdRoots.push(configRoot);
  await fs.writeFile(
    path.join(configRoot, "orc.yaml"),
    `version: 1\nworkspaceRoot: ${JSON.stringify(workspaceParent)}\n`,
    "utf8",
  );
  return configRoot;
}

async function createRunnableTeam(configRoot: string, label: string) {
  const department = await createDepartment(
    {
      slug: `assignment-workflow-department-${label}-${crypto.randomUUID()}`,
      name: `Assignment Workflow Department ${label}`,
      role: "Worker",
      harness: "codex" as const,
      defaultModel: "default",
      defaultReasoning: "low",
      systemPrompt: "Perform the task.",
    },
    configRoot,
  );
  created.departmentIds.add(department.id);

  const agent = await createAgent(
    {
      departmentId: department.id,
      slug: `assignment-workflow-agent-${label}-${crypto.randomUUID()}`,
      name: `Assignment Workflow Agent ${label}`,
      enabled: true,
      additionalPrompt: "",
    },
    configRoot,
  );
  created.agentIds.add(agent.id);

  const team = await createTeam(
    {
      slug: `assignment-workflow-${label}-${crypto.randomUUID()}`,
      name: `Assignment Workflow ${label}`,
      description: "",
      enabled: true,
    },
    configRoot,
  );
  created.teamIds.add(team.id);
  await replaceTeamMembers(team.id, [agent.id], null, configRoot);
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

  for (const root of createdRoots.splice(0)) {
    await fs.rm(root, { recursive: true, force: true });
  }
});

describe.sequential("Project assignment Task ownership", () => {
  it("uses an assigned Team by default, permits explicit Team selection when unassigned, and preserves old Task ownership after reassignment", async () => {
    const configRoot = await makeConfigRoot();
    const assignedTeam = await createRunnableTeam(configRoot, "assigned");
    const replacementTeam = await createRunnableTeam(configRoot, "replacement");
    const explicitTeam = await createRunnableTeam(configRoot, "explicit");

    const unassigned = await createTask({ projectId: project.id, teamId: explicitTeam.id, title: "Explicit unassigned Task", instruction: "Use the explicit Team." });
    created.taskIds.add(unassigned.id);
    expect(unassigned.teamId).toBe(explicitTeam.id);

    await upsertProjectTeamAssignment(project.path, { teamId: assignedTeam.id, notionDataSourceId: null, autoModeEnabled: false }, configRoot);
    const assigned = await createTask({ projectId: project.id, title: "Assigned Task", instruction: "Use the assigned Team." });
    created.taskIds.add(assigned.id);
    expect(assigned.teamId).toBe(assignedTeam.id);

    await upsertProjectTeamAssignment(project.path, { teamId: replacementTeam.id, notionDataSourceId: null, autoModeEnabled: false }, configRoot);
    const [historical] = await db.select({ teamId: tasks.teamId }).from(tasks).where(eq(tasks.id, assigned.id));
    expect(historical.teamId).toBe(assignedTeam.id);
  });
});
