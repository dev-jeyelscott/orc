import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  createAgentSchema,
  updateAgentSchema,
} from "@orc/shared";

import {
  AgentServiceError,
  createAgent,
  deleteAgent,
  getAgent,
  listAgents,
  updateAgent,
} from "../services/agent-service.js";

const idParams = z.object({ agentId: z.string().uuid() });

/**
 * Parses and validates route or request payload data with a shared Zod schema.
 */
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);

  if (!parsed.success) {
    throw new AgentServiceError(
      parsed.error.issues.map((issue) => issue.message).join(", "),
      400,
    );
  }

  return parsed.data;
}

/**
 * Converts known service errors into stable API responses.
 */
function sendError(
  error: unknown,
  reply: {
    status: (code: number) => {
      send: (body: unknown) => unknown;
    };
  },
) {
  if (error instanceof AgentServiceError) {
    return reply.status(error.statusCode).send({ error: error.message });
  }

  throw error;
}

/**
 * Registers Agent CRUD endpoints. Team placement is managed exclusively
 * through the Team workflow resource, not here.
 */
export async function agentRoutes(app: FastifyInstance) {
  app.get("/api/agents", async () => ({
    agents: await listAgents(),
  }));

  app.get("/api/agents/:agentId", async (request, reply) => {
    const { agentId } = parse(idParams, request.params);
    const agent = await getAgent(agentId);

    return (
      agent ??
      reply.status(404).send({
        error: "agent_not_found",
      })
    );
  });

  app.post("/api/agents", async (request, reply) => {
    try {
      const input = parse(createAgentSchema, request.body);

      return reply.status(201).send(
        await createAgent({
          ...input,
          enabled: input.enabled ?? true,
          additionalPrompt: input.additionalPrompt ?? "",
        }),
      );
    } catch (error) {
      return sendError(error, reply);
    }
  });

  app.patch("/api/agents/:agentId", async (request, reply) => {
    try {
      const { agentId } = parse(idParams, request.params);
      const agent = await updateAgent(
        agentId,
        parse(updateAgentSchema, request.body),
      );

      return (
        agent ??
        reply.status(404).send({
          error: "agent_not_found",
        })
      );
    } catch (error) {
      return sendError(error, reply);
    }
  });

  app.delete("/api/agents/:agentId", async (request, reply) => {
    try {
      const { agentId } = parse(idParams, request.params);
      const deleted = await deleteAgent(agentId);

      return deleted
        ? reply.status(204).send()
        : reply.status(404).send({ error: "agent_not_found" });
    } catch (error) {
      return sendError(error, reply);
    }
  });
}
