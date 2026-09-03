import { and, asc, eq, or } from "drizzle-orm";

import type { Agent, AgentRoute, AgentWithRoutes, CreateAgent, CreateAgentRoute, UpdateAgent, UpdateAgentRoute } from "@orc/shared";

import { db } from "../db/client.js";
import { agents, agentRoutes } from "../db/schema.js";

export class AgentServiceError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
  }
}

function serializeAgent(row: typeof agents.$inferSelect): Agent {
  return { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

function serializeRoute(row: typeof agentRoutes.$inferSelect): AgentRoute {
  return { ...row, targetAgentId: row.targetAgentId ?? null, terminalAction: row.terminalAction ?? null, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

function translateDatabaseError(error: unknown): never {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: string }).code;
    if (code === "23505") throw new AgentServiceError("An agent slug, layer/order, or route outcome already exists", 409);
    if (code === "23503") throw new AgentServiceError("The referenced agent does not exist", 400);
    if (code === "23514") throw new AgentServiceError("The agent or route configuration is invalid", 400);
  }
  throw error;
}

export async function listAgents(): Promise<Agent[]> {
  return (await db.select().from(agents).orderBy(asc(agents.layer), asc(agents.executionOrder))).map(serializeAgent);
}

export async function getAgent(id: string): Promise<AgentWithRoutes | null> {
  const [agent] = await db.select().from(agents).where(eq(agents.id, id));
  if (!agent) return null;
  const routes = await db.select().from(agentRoutes).where(eq(agentRoutes.sourceAgentId, id));
  return { ...serializeAgent(agent), routes: routes.map(serializeRoute) };
}

export async function createAgent(input: CreateAgent): Promise<Agent> {
  try {
    const [agent] = await db.insert(agents).values(input).returning();
    return serializeAgent(agent);
  } catch (error) {
    return translateDatabaseError(error);
  }
}

export async function updateAgent(id: string, input: UpdateAgent): Promise<Agent | null> {
  try {
    const values = { ...input, updatedAt: new Date() };
    const updated = await db.transaction(async (tx) => {
      const [agent] = await tx.update(agents).set(values).where(eq(agents.id, id)).returning();
      if (agent && input.enabled === false) {
        await tx.update(agentRoutes).set({ enabled: false, updatedAt: new Date() }).where(or(eq(agentRoutes.sourceAgentId, id), eq(agentRoutes.targetAgentId, id)));
      }
      return agent;
    });
    return updated ? serializeAgent(updated) : null;
  } catch (error) {
    return translateDatabaseError(error);
  }
}

async function assertEnabledTarget(targetAgentId: string | null) {
  if (!targetAgentId) return;
  const [target] = await db.select({ enabled: agents.enabled }).from(agents).where(eq(agents.id, targetAgentId));
  if (!target) throw new AgentServiceError("The target agent does not exist", 400);
  if (!target.enabled) throw new AgentServiceError("Routes cannot target a disabled agent", 400);
}

export async function createAgentRoute(sourceAgentId: string, input: CreateAgentRoute): Promise<AgentRoute> {
  try {
    const [source] = await db.select({ enabled: agents.enabled }).from(agents).where(eq(agents.id, sourceAgentId));
    if (!source) throw new AgentServiceError("The source agent does not exist", 404);
    if (!source.enabled && input.enabled) throw new AgentServiceError("Enable the source agent before enabling a route", 400);
    await assertEnabledTarget(input.targetAgentId);
    const [route] = await db.insert(agentRoutes).values({ ...input, sourceAgentId }).returning();
    return serializeRoute(route);
  } catch (error) {
    return translateDatabaseError(error);
  }
}

export async function updateAgentRoute(agentId: string, routeId: string, input: UpdateAgentRoute): Promise<AgentRoute | null> {
  try {
    const [existing] = await db.select().from(agentRoutes).where(and(eq(agentRoutes.id, routeId), eq(agentRoutes.sourceAgentId, agentId)));
    if (!existing) return null;
    const merged = { ...existing, ...input };
    if ((merged.targetAgentId === null) === (merged.terminalAction === null)) throw new AgentServiceError("Set exactly one target agent or terminal action", 400);
    await assertEnabledTarget(merged.targetAgentId);
    const [route] = await db.update(agentRoutes).set({ ...input, updatedAt: new Date() }).where(eq(agentRoutes.id, routeId)).returning();
    return serializeRoute(route);
  } catch (error) {
    return translateDatabaseError(error);
  }
}

export async function deleteAgentRoute(agentId: string, routeId: string): Promise<boolean> {
  const deleted = await db.delete(agentRoutes).where(and(eq(agentRoutes.id, routeId), eq(agentRoutes.sourceAgentId, agentId))).returning({ id: agentRoutes.id });
  return deleted.length > 0;
}

export async function listEnabledAgentsForFutureRuns(): Promise<Agent[]> {
  return (await db.select().from(agents).where(eq(agents.enabled, true)).orderBy(asc(agents.layer), asc(agents.executionOrder))).map(serializeAgent);
}
