import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createAgentRouteSchema, createAgentSchema, updateAgentRouteSchema, updateAgentSchema } from "@orc/shared";

import { AgentServiceError, createAgent, createAgentRoute, deleteAgentRoute, getAgent, listAgents, updateAgent, updateAgentRoute } from "../services/agent-service.js";

const idParams = z.object({ agentId: z.string().uuid() });
const routeParams = idParams.extend({ routeId: z.string().uuid() });

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new AgentServiceError(parsed.error.issues.map((issue) => issue.message).join(", "), 400);
  return parsed.data;
}

function sendError(error: unknown, reply: { status: (code: number) => { send: (body: unknown) => unknown } }) {
  if (error instanceof AgentServiceError) return reply.status(error.statusCode).send({ error: error.message });
  throw error;
}

export async function agentRoutes(app: FastifyInstance) {
  app.get("/api/agents", async () => ({ agents: await listAgents() }));
  app.get("/api/agents/:agentId", async (request, reply) => {
    const { agentId } = parse(idParams, request.params);
    const agent = await getAgent(agentId);
    return agent ?? reply.status(404).send({ error: "agent_not_found" });
  });
  app.post("/api/agents", async (request, reply) => {
    try {
      const input = parse(createAgentSchema, request.body);
      return reply.status(201).send(await createAgent({ ...input, description: input.description ?? "", enabled: input.enabled ?? true, canWrite: input.canWrite ?? false, canRunCommands: input.canRunCommands ?? false, canCommit: input.canCommit ?? false }));
    } catch (error) { return sendError(error, reply); }
  });
  app.patch("/api/agents/:agentId", async (request, reply) => {
    try {
      const { agentId } = parse(idParams, request.params);
      const agent = await updateAgent(agentId, parse(updateAgentSchema, request.body));
      return agent ?? reply.status(404).send({ error: "agent_not_found" });
    } catch (error) { return sendError(error, reply); }
  });
  app.post("/api/agents/:agentId/routes", async (request, reply) => {
    try {
      const { agentId } = parse(idParams, request.params);
      const input = parse(createAgentRouteSchema, request.body);
      return reply.status(201).send(await createAgentRoute(agentId, { ...input, targetAgentId: input.targetAgentId ?? null, terminalAction: input.terminalAction ?? null, enabled: input.enabled ?? true }));
    } catch (error) { return sendError(error, reply); }
  });
  app.patch("/api/agents/:agentId/routes/:routeId", async (request, reply) => {
    try { const { agentId, routeId } = parse(routeParams, request.params); const route = await updateAgentRoute(agentId, routeId, parse(updateAgentRouteSchema, request.body)); return route ?? reply.status(404).send({ error: "route_not_found" }); } catch (error) { return sendError(error, reply); }
  });
  app.delete("/api/agents/:agentId/routes/:routeId", async (request, reply) => {
    const { agentId, routeId } = parse(routeParams, request.params);
    return (await deleteAgentRoute(agentId, routeId)) ? reply.status(204).send() : reply.status(404).send({ error: "route_not_found" });
  });
}
