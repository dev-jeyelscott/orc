import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  eq,
} from "drizzle-orm";
import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  db,
} from "../db/client.js";
import {
  projectTeamAssignments,
  teams,
} from "../db/schema.js";
import { createTeam } from "./team-service.js";
import {
  getProjectTeamAssignmentByPath,
  upsertProjectTeamAssignment,
} from "./project-team-assignment-service.js";

const createdTeamIds = new Set<string>();
const createdRoots: string[] = [];
const createdWorkspaces: string[] = [];

async function makeConfigRoot(): Promise<{ configRoot: string; workspaceRoot: string }> {
  const configRoot = await fs.mkdtemp(path.join(os.tmpdir(), "orc-project-assignment-persist-config-"));
  createdRoots.push(configRoot);
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "orc-project-assignment-persist-workspace-"));
  createdWorkspaces.push(workspaceRoot);

  await fs.writeFile(
    path.join(configRoot, "orc.yaml"),
    `version: 1\nworkspaceRoot: ${JSON.stringify(workspaceRoot)}\n`,
    "utf8",
  );

  return { configRoot, workspaceRoot };
}

async function makeDiscoveredProject(workspaceRoot: string, name: string): Promise<string> {
  const projectPath = path.join(workspaceRoot, name);
  await fs.mkdir(path.join(projectPath, ".git"), { recursive: true });
  return projectPath;
}

async function createTestTeam(configRoot: string, label: string) {
  const team = await createTeam(
    {
      slug: `project-assignment-persist-${label}-${crypto.randomUUID()}`,
      name: `Project Assignment ${label}`,
      description: "",
      enabled: true,
    },
    configRoot,
  );
  createdTeamIds.add(team.id);
  return team;
}

afterEach(async () => {
  for (const teamId of createdTeamIds) {
    await db.delete(projectTeamAssignments).where(eq(projectTeamAssignments.resolutionTeamId, teamId));
    await db.delete(teams).where(eq(teams.id, teamId));
  }
  createdTeamIds.clear();

  for (const root of createdRoots.splice(0)) {
    await fs.rm(root, { recursive: true, force: true });
  }
  for (const workspace of createdWorkspaces.splice(0)) {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

describe.sequential("Project Team assignment persistence", () => {
  it("keeps one assignment per Project path while allowing one Team to serve several Projects", async () => {
    const { configRoot, workspaceRoot } = await makeConfigRoot();
    const firstTeam = await createTestTeam(configRoot, "first");
    const sharedTeam = await createTestTeam(configRoot, "shared");
    const firstPath = await makeDiscoveredProject(workspaceRoot, "project-a");
    const secondPath = await makeDiscoveredProject(workspaceRoot, "project-b");
    const firstSource = `assignment-source-${crypto.randomUUID()}`;
    const secondSource = `assignment-source-${crypto.randomUUID()}`;

    await upsertProjectTeamAssignment(firstPath, {
      teamId: firstTeam.id,
      notionDataSourceId: firstSource,
      autoModeEnabled: false,
    }, configRoot);
    const reassigned = await upsertProjectTeamAssignment(firstPath, {
      teamId: sharedTeam.id,
      notionDataSourceId: firstSource,
      autoModeEnabled: true,
    }, configRoot);
    const second = await upsertProjectTeamAssignment(secondPath, {
      teamId: sharedTeam.id,
      notionDataSourceId: secondSource,
      autoModeEnabled: false,
    }, configRoot);

    expect(reassigned).toMatchObject({
      projectPath: path.resolve(firstPath),
      teamId: sharedTeam.id,
      notionDataSourceId: firstSource,
      autoModeEnabled: true,
    });
    expect(second).toMatchObject({
      projectPath: path.resolve(secondPath),
      teamId: sharedTeam.id,
      notionDataSourceId: secondSource,
      autoModeEnabled: false,
    });
    expect(await getProjectTeamAssignmentByPath(firstPath)).toMatchObject({ teamId: sharedTeam.id });
  });
});
