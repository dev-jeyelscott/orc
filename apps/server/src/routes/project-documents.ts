import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { createProjectDocumentRequestSchema } from "@orc/shared";

import {
  createProjectDocument,
  listProjectDocuments,
  ProjectDocumentServiceError,
} from "../services/project-document-service.js";

const listQuerySchema = z.object({
  projectPath: z.string().trim().min(1),
  teamId: z.string().uuid(),
});

/**
 * Sends a known project document service error with its intended HTTP status.
 */
function sendError(
  error: unknown,
  reply: {
    status: (code: number) => { send: (body: unknown) => unknown };
  },
) {
  if (error instanceof ProjectDocumentServiceError) {
    return reply.status(error.statusCode).send({ error: error.message });
  }

  throw error;
}

/**
 * Registers Project document listing and upload routes.
 */
export async function projectDocumentRoutes(app: FastifyInstance) {
  app.get("/api/project-documents", async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query);

    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "projectPath and teamId are required" });
    }

    try {
      return {
        documents: await listProjectDocuments(
          parsed.data.teamId,
          parsed.data.projectPath,
        ),
      };
    } catch (error) {
      return sendError(error, reply);
    }
  });

  app.post("/api/project-documents", async (request, reply) => {
    const parsed = createProjectDocumentRequestSchema.safeParse(
      request.body,
    );

    if (!parsed.success) {
      return reply.status(400).send({
        error: parsed.error.issues.map((issue) => issue.message).join(", "),
      });
    }

    try {
      const result = await createProjectDocument(parsed.data);

      return reply.status(201).send(result);
    } catch (error) {
      return sendError(error, reply);
    }
  });
}
