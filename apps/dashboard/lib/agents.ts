import {
  agentListResponseSchema,
  agentMonitoringOverviewSchema,
  agentObservabilitySchema,
  agentWithRoutesSchema,
  type Agent,
  type AgentMonitoringOverview,
  type AgentMonitoringRange,
  type AgentObservability,
  type AgentWithRoutes,
  type CreateAgent,
  type CreateAgentRoute,
  type UpdateAgent,
  type UpdateAgentRoute,
} from "@orc/shared";

const SERVER_URL =
  process.env
    .NEXT_PUBLIC_SERVER_URL ??
  "http://localhost:4000";

/**
 * Reads a backend error payload and produces a stable client-facing message.
 */
async function readErrorMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  const body =
    (await response
      .json()
      .catch(
        () => null,
      )) as {
      error?: string;
    } | null;

  return (
    body?.error ??
    fallback
  );
}

/**
 * Executes an API request and validates its JSON response with the supplied schema.
 */
async function request<T>(
  path: string,
  options: RequestInit,
  schema: {
    parse: (
      value: unknown,
    ) => T;
  },
): Promise<T> {
  const response =
    await fetch(
      `${SERVER_URL}${path}`,
      {
        ...options,
        headers: {
          "content-type":
            "application/json",
          ...options.headers,
        },
      },
    );

  if (!response.ok) {
    throw new Error(
      await readErrorMessage(
        response,
        `Request failed: ${response.status}`,
      ),
    );
  }

  return schema.parse(
    await response.json(),
  );
}

/**
 * Executes an API request whose successful response has no body.
 */
async function requestNoContent(
  path: string,
  options: RequestInit,
): Promise<void> {
  const response =
    await fetch(
      `${SERVER_URL}${path}`,
      options,
    );

  if (!response.ok) {
    throw new Error(
      await readErrorMessage(
        response,
        `Request failed: ${response.status}`,
      ),
    );
  }
}

/**
 * Loads all configured agents using deterministic workflow order.
 */
export async function getAgents(): Promise<
  Agent[]
> {
  return (
    await request(
      "/api/agents",
      {},
      agentListResponseSchema,
    )
  ).agents;
}

/**
 * Loads one full agent configuration including persisted routes.
 */
export function getAgent(
  id: string,
): Promise<AgentWithRoutes> {
  return request(
    `/api/agents/${id}`,
    {},
    agentWithRoutesSchema,
  );
}

/**
 * Loads the complete Agents command-center read model without browser caching.
 */
export function getAgentMonitoringOverview(
  range:
    AgentMonitoringRange,
  signal?: AbortSignal,
): Promise<AgentMonitoringOverview> {
  return request(
    `/api/agents/monitoring?range=${encodeURIComponent(range)}`,
    {
      cache: "no-store",
      signal,
    },
    agentMonitoringOverviewSchema,
  );
}

/**
 * Loads persisted observability for one selected agent without browser caching.
 */
export function getAgentObservability(
  id: string,
  range:
    AgentMonitoringRange,
  signal?: AbortSignal,
): Promise<AgentObservability> {
  return request(
    `/api/agents/${id}/observability?range=${encodeURIComponent(range)}`,
    {
      cache: "no-store",
      signal,
    },
    agentObservabilitySchema,
  );
}

/**
 * Creates a worker-agent configuration.
 */
export function createAgent(
  input: CreateAgent,
): Promise<Agent> {
  return request(
    "/api/agents",
    {
      method: "POST",
      body:
        JSON.stringify(
          input,
        ),
    },
    {
      parse: (
        value,
      ) =>
        agentWithRoutesSchema
          .omit({
            routes: true,
          })
          .parse(value),
    },
  );
}

/**
 * Updates an existing worker-agent configuration.
 */
export function updateAgent(
  id: string,
  input: UpdateAgent,
): Promise<Agent> {
  return request(
    `/api/agents/${id}`,
    {
      method: "PATCH",
      body:
        JSON.stringify(
          input,
        ),
    },
    {
      parse: (
        value,
      ) =>
        agentWithRoutesSchema
          .omit({
            routes: true,
          })
          .parse(value),
    },
  );
}

/**
 * Permanently deletes an agent when the backend determines deletion is safe.
 */
export function deleteAgent(
  id: string,
): Promise<void> {
  return requestNoContent(
    `/api/agents/${id}`,
    {
      method: "DELETE",
    },
  );
}

/**
 * Creates an explicit outcome route for one agent.
 */
export function createAgentRoute(
  agentId: string,
  input: CreateAgentRoute,
) {
  return request(
    `/api/agents/${agentId}/routes`,
    {
      method: "POST",
      body:
        JSON.stringify(
          input,
        ),
    },
    {
      parse: (
        value,
      ) =>
        agentWithRoutesSchema
          .shape.routes
          .element.parse(
            value,
          ),
    },
  );
}

/**
 * Updates one existing outcome route in place.
 */
export function updateAgentRoute(
  agentId: string,
  routeId: string,
  input: UpdateAgentRoute,
) {
  return request(
    `/api/agents/${agentId}/routes/${routeId}`,
    {
      method: "PATCH",
      body:
        JSON.stringify(
          input,
        ),
    },
    {
      parse: (
        value,
      ) =>
        agentWithRoutesSchema
          .shape.routes
          .element.parse(
            value,
          ),
    },
  );
}

/**
 * Removes one persisted outcome route.
 */
export function deleteAgentRoute(
  agentId: string,
  routeId: string,
): Promise<void> {
  return requestNoContent(
    `/api/agents/${agentId}/routes/${routeId}`,
    {
      method: "DELETE",
    },
  );
}
