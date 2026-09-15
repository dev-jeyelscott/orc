import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { saveWorkflowDraftSchema } from "@orc/shared";

import {
  WorkflowGraphServiceError,
  getPublishedRevision,
  getWorkflowAggregate,
  publishDraft,
  saveDraftGraph,
} from "../services/workflow-graph-service.js";

const idParams = z.object({ teamId: z.string().uuid() });
const revisionParams = z.object({ teamId: z.string().uuid(), revisionId: z.string().uuid() });

function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, value: unknown): T {
  const parsed = schema.safeParse(value);

  if (!parsed.success) {
    throw new WorkflowGraphServiceError(parsed.error.issues.map((issue) => issue.message).join(", "), 400);
  }

  return parsed.data;
}

function sendError(
  error: unknown,
  reply: { status: (code: number) => { send: (body: unknown) => unknown } },
) {
  if (error instanceof WorkflowGraphServiceError) {
    return reply
      .status(error.statusCode)
      .send({ error: error.message, ...(error.validation ? { validation: error.validation } : {}) });
  }

  throw error;
}

/**
 * Registers the additive explicit-node workflow graph API alongside the
 * legacy `GET`/`PUT /api/teams/:teamId/workflow` layer/order resource,
 * which stays untouched until the dashboard cuts over.
 */
export async function teamWorkflowGraphRoutes(app: FastifyInstance) {
  app.get("/api/teams/:teamId/workflow/graph", async (request, reply) => {
    try {
      const { teamId } = parse(idParams, request.params);
      const aggregate = await getWorkflowAggregate(teamId);

      return aggregate ?? reply.status(404).send({ error: "team_not_found" });
    } catch (error) {
      return sendError(error, reply);
    }
  });

  app.put("/api/teams/:teamId/workflow/draft", async (request, reply) => {
    try {
      const { teamId } = parse(idParams, request.params);
      const graph = parse(saveWorkflowDraftSchema, request.body);

      return await saveDraftGraph(teamId, graph);
    } catch (error) {
      return sendError(error, reply);
    }
  });

  app.post("/api/teams/:teamId/workflow/publish", async (request, reply) => {
    try {
      const { teamId } = parse(idParams, request.params);

      return await publishDraft(teamId);
    } catch (error) {
      return sendError(error, reply);
    }
  });

  app.get("/api/teams/:teamId/workflow/revisions/:revisionId", async (request, reply) => {
    try {
      const { teamId, revisionId } = parse(revisionParams, request.params);
      const revision = await getPublishedRevision(teamId, revisionId);

      return revision ?? reply.status(404).send({ error: "revision_not_found" });
    } catch (error) {
      return sendError(error, reply);
    }
  });
}
