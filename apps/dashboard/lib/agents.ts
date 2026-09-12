import {
  agentListResponseSchema,
  agentSchema,
  type Agent,
  type CreateAgent,
  type UpdateAgent,
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
 * Loads all configured agents.
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
 * Loads one agent configuration.
 */
export function getAgent(
  id: string,
): Promise<Agent> {
  return request(
    `/api/agents/${id}`,
    {},
    agentSchema,
  );
}

/**
 * Creates a Department-scoped worker-agent configuration.
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
    agentSchema,
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
    agentSchema,
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
