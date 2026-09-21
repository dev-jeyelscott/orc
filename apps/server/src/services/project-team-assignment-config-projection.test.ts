import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { getProjectRevision } from "../config/config-mutation-service.js";
import { loadConfigGraph } from "../config/loader.js";
import { db } from "../db/client.js";
import { projectTeamAssignments, teams } from "../db/schema.js";
import { createTeam } from "./team-service.js";
import {
  deleteProjectTeamAssignment,
  getProjectTeamAssignmentByPath,
  upsertProjectTeamAssignment,
} from "./project-team-assignment-service.js";

const createdTeamIds = new Set<string>();
const createdRoots: string[] = [];
const createdWorkspaces: string[] = [];

async function makeConfigRoot(): Promise<{ configRoot: string; workspaceRoot: string; projectPath: string }> {
  const configRoot = await fs.mkdtemp(path.join(os.tmpdir(), "orc-project-assignment-config-"));
  createdRoots.push(configRoot);
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "orc-project-assignment-workspace-"));
  createdWorkspaces.push(workspaceRoot);

  await fs.writeFile(
    path.join(configRoot, "orc.yaml"),
    `version: 1\nworkspaceRoot: ${JSON.stringify(workspaceRoot)}\n`,
    "utf8",
  );

  const projectPath = path.join(workspaceRoot, "demo-project");
  await fs.mkdir(path.join(projectPath, ".git"), { recursive: true });

  return { configRoot, workspaceRoot, projectPath };
}

async function createTestTeam(configRoot: string, label: string) {
  const team = await createTeam(
    {
      slug: `project-assignment-cfg-${label}-${crypto.randomUUID()}`,
      name: `${label} Team`,
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

describe("Project assignment canonical file projection (Vertical Spec 6)", () => {
  it("writes a workspace-relative canonical Project file once the Team is file-backed and the path is discovered", async () => {
    const { configRoot, projectPath } = await makeConfigRoot();
    const team = await createTestTeam(configRoot, "write");

    const assignment = await upsertProjectTeamAssignment(
      projectPath,
      { teamId: team.id, notionDataSourceId: null, autoModeEnabled: false },
      configRoot,
    );

    expect(assignment.teamId).toBe(team.id);

    const graph = await loadConfigGraph(configRoot);
    const projectResource = graph.projects.find((resource) => resource.data.slug === "demo-project");

    expect(projectResource?.data.path).toBe("demo-project");
    expect(projectResource?.data.resolutionTeam).toBe(team.slug);
    expect(await getProjectRevision(configRoot, "demo-project")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("updates the canonical file's team reference on reassignment", async () => {
    const { configRoot, projectPath } = await makeConfigRoot();
    const teamA = await createTestTeam(configRoot, "reassign-a");
    const teamB = await createTestTeam(configRoot, "reassign-b");

    await upsertProjectTeamAssignment(projectPath, { teamId: teamA.id, notionDataSourceId: null, autoModeEnabled: false }, configRoot);
    await upsertProjectTeamAssignment(projectPath, { teamId: teamB.id, notionDataSourceId: null, autoModeEnabled: false }, configRoot);

    const graph = await loadConfigGraph(configRoot);
    const projectResource = graph.projects.find((resource) => resource.data.slug === "demo-project");
    expect(projectResource?.data.resolutionTeam).toBe(teamB.slug);

    const assignment = await getProjectTeamAssignmentByPath(projectPath);
    expect(assignment?.teamId).toBe(teamB.id);
  });

  it("never fabricates a Project for an undiscovered path -- rejects the mutation with an explicit configuration error", async () => {
    const { configRoot, workspaceRoot } = await makeConfigRoot();
    const team = await createTestTeam(configRoot, "undiscovered");
    const undiscoveredPath = path.join(workspaceRoot, "not-a-real-project");

    await expect(
      upsertProjectTeamAssignment(
        undiscoveredPath,
        { teamId: team.id, notionDataSourceId: null, autoModeEnabled: false },
        configRoot,
      ),
    ).rejects.toMatchObject({ statusCode: 409 });

    const graph = await loadConfigGraph(configRoot);
    expect(graph.projects).toHaveLength(0);

    const [row] = await db.select().from(projectTeamAssignments).where(eq(projectTeamAssignments.projectPath, path.resolve(undiscoveredPath)));
    expect(row).toBeUndefined();
  });

  it("rejects the mutation when the selected Team has no canonical team.yaml", async () => {
    const { configRoot, projectPath } = await makeConfigRoot();
    const [dbOnlyTeam] = await db
      .insert(teams)
      .values({ slug: `project-assignment-cfg-db-only-${crypto.randomUUID()}`, name: "DB-only Team", description: "", enabled: true })
      .returning();
    createdTeamIds.add(dbOnlyTeam.id);

    await expect(
      upsertProjectTeamAssignment(
        projectPath,
        { teamId: dbOnlyTeam.id, notionDataSourceId: null, autoModeEnabled: false },
        configRoot,
      ),
    ).rejects.toMatchObject({ statusCode: 409 });

    const graph = await loadConfigGraph(configRoot);
    expect(graph.projects).toHaveLength(0);
  });

  it("deletes the canonical file and projection row together", async () => {
    const { configRoot, projectPath } = await makeConfigRoot();
    const team = await createTestTeam(configRoot, "delete");

    await upsertProjectTeamAssignment(projectPath, { teamId: team.id, notionDataSourceId: null, autoModeEnabled: false }, configRoot);
    expect(await deleteProjectTeamAssignment(projectPath, configRoot)).toBe(true);

    const graph = await loadConfigGraph(configRoot);
    expect(graph.projects).toHaveLength(0);
    expect(await getProjectTeamAssignmentByPath(projectPath)).toBeNull();
  });
});
