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
import {
  getProjectTeamAssignmentByPath,
  upsertProjectTeamAssignment,
} from "./project-team-assignment-service.js";

const createdPaths = new Set<string>();
const createdTeamIds = new Set<string>();

async function createTeam(label: string) {
  const [team] = await db.insert(teams).values({
    slug: `project-assignment-${label}-${crypto.randomUUID()}`,
    name: `Project Assignment ${label}`,
    description: "",
    enabled: true,
  }).returning();
  createdTeamIds.add(team.id);
  return team;
}

afterEach(async () => {
  for (const projectPath of createdPaths) {
    await db.delete(projectTeamAssignments).where(eq(projectTeamAssignments.projectPath, projectPath));
  }
  for (const teamId of createdTeamIds) {
    await db.delete(teams).where(eq(teams.id, teamId));
  }
  createdPaths.clear();
  createdTeamIds.clear();
});

describe.sequential("Project Team assignment persistence", () => {
  it("keeps one assignment per Project path while allowing one Team to serve several Projects", async () => {
    const firstTeam = await createTeam("first");
    const sharedTeam = await createTeam("shared");
    const firstPath = `/tmp/project-assignment-${crypto.randomUUID()}-a`;
    const secondPath = `/tmp/project-assignment-${crypto.randomUUID()}-b`;
    const firstSource = `assignment-source-${crypto.randomUUID()}`;
    const secondSource = `assignment-source-${crypto.randomUUID()}`;
    createdPaths.add(firstPath);
    createdPaths.add(secondPath);

    await upsertProjectTeamAssignment(firstPath, {
      teamId: firstTeam.id,
      notionDataSourceId: firstSource,
      autoModeEnabled: false,
    });
    const reassigned = await upsertProjectTeamAssignment(firstPath, {
      teamId: sharedTeam.id,
      notionDataSourceId: firstSource,
      autoModeEnabled: true,
    });
    const second = await upsertProjectTeamAssignment(secondPath, {
      teamId: sharedTeam.id,
      notionDataSourceId: secondSource,
      autoModeEnabled: false,
    });

    expect(reassigned).toMatchObject({
      projectPath: firstPath,
      teamId: sharedTeam.id,
      notionDataSourceId: firstSource,
      autoModeEnabled: true,
    });
    expect(second).toMatchObject({
      projectPath: secondPath,
      teamId: sharedTeam.id,
      notionDataSourceId: secondSource,
      autoModeEnabled: false,
    });
    expect(await getProjectTeamAssignmentByPath(firstPath)).toMatchObject({ teamId: sharedTeam.id });
  });
});
