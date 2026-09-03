import { agentExecutionSchema, type AgentExecution } from "@orc/shared";

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

export function getAgentExecution(id: string): Promise<AgentExecution> {
  return request(`/api/agent-executions/${id}`, {}, agentExecutionSchema);
}

export function getAgentExecutionTerminalUrl(id: string): string {
  const wsUrl = SERVER_URL.replace(/^http/, "ws");
  return `${wsUrl}/api/agent-executions/${id}/terminal`;
}
