import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { postConversationMessageSchema } from "@orc/shared";
import { getConversation, getOrCreateConversation, postConversationMessage } from "../services/conversation-service.js";

const idParams = z.object({ id: z.string().uuid() });
const projectQuery = z.object({ projectPath: z.string().min(1) });
export async function conversationRoutes(app: FastifyInstance) {
  app.post("/api/conversations", async (request, reply) => { const parsed = projectQuery.safeParse(request.body); if (!parsed.success) return reply.status(400).send({ error: "projectPath is required" }); return reply.status(201).send(await getOrCreateConversation(parsed.data.projectPath)); });
  app.get("/api/conversations/:id", async (request, reply) => { const parsed = idParams.safeParse(request.params); if (!parsed.success) return reply.status(400).send({ error: "invalid_conversation_id" }); const value = await getConversation(parsed.data.id); return value ?? reply.status(404).send({ error: "conversation_not_found" }); });
  app.post("/api/conversations/:id/messages", async (request, reply) => { const params = idParams.safeParse(request.params); const body = postConversationMessageSchema.safeParse(request.body); if (!params.success || !body.success) return reply.status(400).send({ error: "invalid_message" }); try { const value = await postConversationMessage(params.data.id, body.data.content); return value ?? reply.status(404).send({ error: "conversation_not_found" }); } catch (error) { return reply.status(400).send({ error: error instanceof Error ? error.message : "conversation_failed" }); } });
}
