import {
  agentListResponseSchema,
  agentWithRoutesSchema,
  type Agent,
  type AgentWithRoutes,
  type CreateAgent,
  type CreateAgentRoute,
  type UpdateAgent,
  type UpdateAgentRoute,
} from "@orc/shared";

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:4000";

async function request<T>(path: string, options: RequestInit, schema: { parse: (value: unknown) => T }): Promise<T> {
  const response = await fetch(`${SERVER_URL}${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...options.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed: ${response.status}`);
  }
  return schema.parse(await response.json());
}

export async function getAgents(): Promise<Agent[]> {
  return (await request("/api/agents", {}, agentListResponseSchema)).agents;
}

export function getAgent(id: string): Promise<AgentWithRoutes> {
  return request(`/api/agents/${id}`, {}, agentWithRoutesSchema);
}

export function createAgent(input: CreateAgent): Promise<Agent> {
  return request("/api/agents", { method: "POST", body: JSON.stringify(input) }, { parse: (value) => agentWithRoutesSchema.omit({ routes: true }).parse(value) });
}

export function updateAgent(id: string, input: UpdateAgent): Promise<Agent> {
  return request(`/api/agents/${id}`, { method: "PATCH", body: JSON.stringify(input) }, { parse: (value) => agentWithRoutesSchema.omit({ routes: true }).parse(value) });
}

export function createAgentRoute(agentId: string, input: CreateAgentRoute) {
  return request(`/api/agents/${agentId}/routes`, { method: "POST", body: JSON.stringify(input) }, { parse: (value) => agentWithRoutesSchema.shape.routes.element.parse(value) });
}

export function updateAgentRoute(agentId: string, routeId: string, input: UpdateAgentRoute) {
  return request(`/api/agents/${agentId}/routes/${routeId}`, { method: "PATCH", body: JSON.stringify(input) }, { parse: (value) => agentWithRoutesSchema.shape.routes.element.parse(value) });
}

export async function deleteAgentRoute(agentId: string, routeId: string) {
  const response = await fetch(`${SERVER_URL}/api/agents/${agentId}/routes/${routeId}`, { method: "DELETE" });
  if (!response.ok) throw new Error("Unable to remove route");
}
