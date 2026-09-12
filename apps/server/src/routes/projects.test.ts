import Fastify from "fastify";
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
  ProjectTeamAssignment,
} from "@orc/shared";

const PROJECT_ID = "discovered-project";
const PROJECT_PATH = "/workspace/discovered-project";
const TEAM_ID = "00000000-0000-4000-9000-000000000001";

const project: Project = {
  id: PROJECT_ID,
  name: "discovered-project",
  path: PROJECT_PATH,
  branch: "main",
  gitState: "clean",
  primaryFiles: ["package.json"],
  packageManager: "pnpm",
  stack: "node",
};

const assignment: ProjectTeamAssignment = {
  projectPath: PROJECT_PATH,
  teamId: TEAM_ID,
  teamName: "Platform",
  notionDataSourceId: "notion-project-source",
  autoModeEnabled: true,
  createdAt: "2026-09-12T00:00:00.000Z",
  updatedAt: "2026-09-12T00:00:00.000Z",
};

const discoveryMocks = vi.hoisted(() => ({
  getProject: vi.fn(),
  listProjects: vi.fn(),
}));

const assignmentMocks = vi.hoisted(() => ({
  getProjectTeamAssignmentByPath: vi.fn(),
  getProjectTeamAssignmentsByPaths: vi.fn(),
  upsertProjectTeamAssignment: vi.fn(),
  deleteProjectTeamAssignment: vi.fn(),
}));

vi.mock("../config/env.js", () => ({ env: { WORKSPACE_ROOT: "/workspace" } }));
vi.mock("../services/project-discovery.js", () => discoveryMocks);
vi.mock("../services/project-team-assignment-service.js", () => ({
  ProjectTeamAssignmentError: class ProjectTeamAssignmentError extends Error {
    constructor(message: string, readonly statusCode: number) {
      super(message);
    }
  },
  ...assignmentMocks,
}));

const { projectRoutes } = await import("./projects.js");

let app: ReturnType<typeof Fastify>;

beforeEach(async () => {
  Object.values(discoveryMocks).forEach((mock) => mock.mockReset());
  Object.values(assignmentMocks).forEach((mock) => mock.mockReset());
  discoveryMocks.listProjects.mockResolvedValue({
    projects: [project],
    workspaceRoot: "/workspace",
    error: null,
  });
  discoveryMocks.getProject.mockResolvedValue(project);
  assignmentMocks.getProjectTeamAssignmentByPath.mockResolvedValue(assignment);
  assignmentMocks.getProjectTeamAssignmentsByPaths.mockResolvedValue(new Map([[PROJECT_PATH, assignment]]));
  app = Fastify();
  await app.register(projectRoutes);
});

afterEach(async () => {
  await app.close();
});

describe("Project Team assignment routes", () => {
  it("joins assignment metadata only onto currently discovered Projects", async () => {
    const response = await app.inject({ method: "GET", url: "/api/projects" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      projects: [{ ...project, assignment }],
      workspaceRoot: "/workspace",
      error: null,
    });
    expect(assignmentMocks.getProjectTeamAssignmentsByPaths).toHaveBeenCalledWith([PROJECT_PATH]);
  });

  it("rejects assignment writes for a Project no longer found by filesystem discovery", async () => {
    discoveryMocks.getProject.mockResolvedValue(null);

    const response = await app.inject({
      method: "PUT",
      url: `/api/projects/${PROJECT_ID}/team-assignment`,
      payload: { teamId: TEAM_ID, notionDataSourceId: "notion-project-source", autoModeEnabled: true },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "project_not_found" });
    expect(assignmentMocks.upsertProjectTeamAssignment).not.toHaveBeenCalled();
  });

  it("persists assignment using the resolved discovered path and permits unassignment", async () => {
    assignmentMocks.upsertProjectTeamAssignment.mockResolvedValue(assignment);
    assignmentMocks.deleteProjectTeamAssignment.mockResolvedValue(true);

    const put = await app.inject({
      method: "PUT",
      url: `/api/projects/${PROJECT_ID}/team-assignment`,
      payload: { teamId: TEAM_ID, notionDataSourceId: "notion-project-source", autoModeEnabled: true },
    });
    const deleted = await app.inject({ method: "DELETE", url: `/api/projects/${PROJECT_ID}/team-assignment` });

    expect(put.statusCode).toBe(200);
    expect(put.json()).toEqual(assignment);
    expect(assignmentMocks.upsertProjectTeamAssignment).toHaveBeenCalledWith(PROJECT_PATH, {
      teamId: TEAM_ID,
      notionDataSourceId: "notion-project-source",
      autoModeEnabled: true,
    });
    expect(deleted.statusCode).toBe(204);
    expect(assignmentMocks.deleteProjectTeamAssignment).toHaveBeenCalledWith(PROJECT_PATH);
  });
});
