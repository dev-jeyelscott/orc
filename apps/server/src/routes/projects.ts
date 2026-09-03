import type { FastifyInstance } from "fastify";
import type { Project, ProjectListResponse } from "@orc/shared";

import { env } from "../config/env.js";
import { getProject, listProjects } from "../services/project-discovery.js";

export async function projectRoutes(app: FastifyInstance) {
  app.get("/api/projects", async (): Promise<ProjectListResponse> => {
    return listProjects(env.WORKSPACE_ROOT);
  });

  app.get<{ Params: { projectId: string } }>(
    "/api/projects/:projectId",
    async (request, reply): Promise<Project | { error: string }> => {
      const project = await getProject(env.WORKSPACE_ROOT, request.params.projectId);

      if (!project) {
        return reply.status(404).send({ error: "project_not_found" });
      }

      return project;
    },
  );
}
