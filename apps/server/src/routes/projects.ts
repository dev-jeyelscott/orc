import type { FastifyInstance } from "fastify";
import type { Project, ProjectListResponse } from "@orc/shared";
import { upsertProjectTeamAssignmentSchema } from "@orc/shared";
import { z } from "zod";

import { env } from "../config/env.js";
import { getProject, listProjects } from "../services/project-discovery.js";
import {
  ProjectTeamAssignmentError,
  deleteProjectTeamAssignment,
  getProjectTeamAssignmentByPath,
  getProjectTeamAssignmentsByPaths,
  upsertProjectTeamAssignment,
} from "../services/project-team-assignment-service.js";

const projectIdParams = z.object({ projectId: z.string().trim().min(1) });

async function enrichProject(project: Project): Promise<Project> {
  return { ...project, assignment: await getProjectTeamAssignmentByPath(project.path) };
}

function assignmentError(error: unknown, reply: { status: (code: number) => { send: (body: unknown) => unknown } }) {
  if (error instanceof ProjectTeamAssignmentError) return reply.status(error.statusCode).send({ error: error.message });
  throw error;
}

export async function projectRoutes(app: FastifyInstance) {
  app.get("/api/projects", async (): Promise<ProjectListResponse> => {
    const result = await listProjects(env.WORKSPACE_ROOT);
    const assignments = await getProjectTeamAssignmentsByPaths(result.projects.map((project) => project.path));
    return { ...result, projects: result.projects.map((project) => ({ ...project, assignment: assignments.get(project.path) ?? null })) };
  });

  app.get<{ Params: { projectId: string } }>(
    "/api/projects/:projectId",
    async (request, reply): Promise<Project | { error: string }> => {
      const project = await getProject(env.WORKSPACE_ROOT, request.params.projectId);

      if (!project) {
        return reply.status(404).send({ error: "project_not_found" });
      }

      return enrichProject(project);
    },
  );

  app.get<{ Params: { projectId: string } }>("/api/projects/:projectId/team-assignment", async (request, reply) => {
    const parsed = projectIdParams.safeParse(request.params);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_project_id" });
    const project = await getProject(env.WORKSPACE_ROOT, parsed.data.projectId);
    if (!project) return reply.status(404).send({ error: "project_not_found" });
    const assignment = await getProjectTeamAssignmentByPath(project.path);
    return assignment ?? reply.status(404).send({ error: "project_team_assignment_not_found" });
  });

  app.put<{ Params: { projectId: string } }>("/api/projects/:projectId/team-assignment", async (request, reply) => {
    const params = projectIdParams.safeParse(request.params);
    const input = upsertProjectTeamAssignmentSchema.safeParse(request.body);
    if (!params.success) return reply.status(400).send({ error: "invalid_project_id" });
    if (!input.success) return reply.status(400).send({ error: input.error.issues.map((issue) => issue.message).join(", ") });
    const project = await getProject(env.WORKSPACE_ROOT, params.data.projectId);
    if (!project) return reply.status(404).send({ error: "project_not_found" });
    try {
      return reply.status(200).send(await upsertProjectTeamAssignment(project.path, input.data));
    } catch (error) {
      return assignmentError(error, reply);
    }
  });

  app.delete<{ Params: { projectId: string } }>("/api/projects/:projectId/team-assignment", async (request, reply) => {
    const parsed = projectIdParams.safeParse(request.params);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_project_id" });
    const project = await getProject(env.WORKSPACE_ROOT, parsed.data.projectId);
    if (!project) return reply.status(404).send({ error: "project_not_found" });
    await deleteProjectTeamAssignment(project.path);
    return reply.status(204).send();
  });
}
