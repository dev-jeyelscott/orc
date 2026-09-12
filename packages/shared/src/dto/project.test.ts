import {
  describe,
  expect,
  it,
} from "vitest";

import {
  projectSchema,
  upsertProjectTeamAssignmentSchema,
} from "./project.js";

const TEAM_ID = "00000000-0000-4000-9000-000000000001";

describe("Project assignment DTO contracts", () => {
  it("accepts a discovered Project enriched with independent assignment automation", () => {
    const timestamp = "2026-09-12T00:00:00.000Z";

    expect(projectSchema.parse({
      id: "project-a",
      name: "project-a",
      path: "/workspace/project-a",
      branch: "main",
      gitState: "clean",
      primaryFiles: ["package.json"],
      packageManager: "pnpm",
      stack: "node",
      assignment: {
        projectPath: "/workspace/project-a",
        teamId: TEAM_ID,
        teamName: "Platform",
        notionDataSourceId: "project-a-source",
        autoModeEnabled: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    }).assignment).toMatchObject({
      teamId: TEAM_ID,
      notionDataSourceId: "project-a-source",
      autoModeEnabled: true,
    });
  });

  it("bounds assignment fields before server-side automation validation", () => {
    expect(upsertProjectTeamAssignmentSchema.parse({
      teamId: TEAM_ID,
      notionDataSourceId: "  project-source  ",
      autoModeEnabled: true,
    })).toEqual({
      teamId: TEAM_ID,
      notionDataSourceId: "project-source",
      autoModeEnabled: true,
    });

    expect(upsertProjectTeamAssignmentSchema.safeParse({
      teamId: TEAM_ID,
      notionDataSourceId: "x".repeat(256),
      autoModeEnabled: false,
    }).success).toBe(false);
  });
});
