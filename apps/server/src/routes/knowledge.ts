import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  createKnowledgeCategorySchema,
  updateKnowledgeCategorySchema,
} from "@orc/shared";

import {
  KnowledgeCategoryServiceError,
  createKnowledgeCategory,
  deleteKnowledgeCategory,
  getKnowledgeCategory,
  getKnowledgeCategoryFileContent,
  listKnowledgeCategories,
  listKnowledgeCategoryFiles,
  updateKnowledgeCategory,
} from "../services/knowledge-category-service.js";

const idParams = z.object({ categoryId: z.string().uuid() });

const fileContentQuery = z.object({
  path: z.string().trim().min(1).max(1_024),
});

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);

  if (!parsed.success) {
    throw new KnowledgeCategoryServiceError(
      parsed.error.issues.map((issue) => issue.message).join(", "),
      400,
    );
  }

  return parsed.data;
}

function sendError(
  error: unknown,
  reply: { status: (code: number) => { send: (body: unknown) => unknown } },
) {
  if (error instanceof KnowledgeCategoryServiceError) {
    return reply.status(error.statusCode).send({ error: error.message });
  }

  throw error;
}

/**
 * Registers the read-only Knowledge Catalog and Vault Browser endpoints plus basic
 * Knowledge Category configuration CRUD. No endpoint in this slice can mutate the
 * Git-backed vault; file endpoints only ever read Markdown already present there.
 */
export async function knowledgeRoutes(app: FastifyInstance) {
  app.get("/api/knowledge", async () => ({
    categories: await listKnowledgeCategories(),
  }));

  app.get("/api/knowledge/:categoryId", async (request, reply) => {
    const { categoryId } = parse(idParams, request.params);
    const category = await getKnowledgeCategory(categoryId);

    return category ?? reply.status(404).send({ error: "knowledge_category_not_found" });
  });

  app.post("/api/knowledge", async (request, reply) => {
    try {
      const input = parse(createKnowledgeCategorySchema, request.body);

      return reply.status(201).send(
        await createKnowledgeCategory({
          ...input,
          description: input.description ?? "",
          enabled: input.enabled ?? true,
        }),
      );
    } catch (error) {
      return sendError(error, reply);
    }
  });

  app.patch("/api/knowledge/:categoryId", async (request, reply) => {
    try {
      const { categoryId } = parse(idParams, request.params);
      const category = await updateKnowledgeCategory(
        categoryId,
        parse(updateKnowledgeCategorySchema, request.body),
      );

      return category ?? reply.status(404).send({ error: "knowledge_category_not_found" });
    } catch (error) {
      return sendError(error, reply);
    }
  });

  app.delete("/api/knowledge/:categoryId", async (request, reply) => {
    try {
      const { categoryId } = parse(idParams, request.params);
      const deleted = await deleteKnowledgeCategory(categoryId);

      return deleted
        ? reply.status(204).send()
        : reply.status(404).send({ error: "knowledge_category_not_found" });
    } catch (error) {
      return sendError(error, reply);
    }
  });

  app.get("/api/knowledge/:categoryId/files", async (request, reply) => {
    const { categoryId } = parse(idParams, request.params);
    const result = await listKnowledgeCategoryFiles(categoryId);

    return result ?? reply.status(404).send({ error: "knowledge_category_not_found" });
  });

  app.get(
    "/api/knowledge/:categoryId/files/content",
    async (request, reply) => {
      const { categoryId } = parse(idParams, request.params);
      const { path } = parse(fileContentQuery, request.query);
      const result = await getKnowledgeCategoryFileContent(categoryId, path);

      return result ?? reply.status(404).send({ error: "knowledge_category_not_found" });
    },
  );
}
