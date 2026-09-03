import {
  agentExecutionSchema,
  type AgentExecution,
} from "@orc/shared";

const SERVER_URL =
  process.env.NEXT_PUBLIC_SERVER_URL ??
  "http://localhost:4000";

/** Performs one validated request against the orchestration backend. */
async function request<T>(
  path: string,
  options: RequestInit,
  schema: {
    parse: (value: unknown) => T;
  },
): Promise<T> {
  const response = await fetch(
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
    const body = (await response
      .json()
      .catch(() => null)) as {
      error?: string;
    } | null;

    throw new Error(
      body?.error ??
        `Request failed: ${response.status}`,
    );
  }

  return schema.parse(
    await response.json(),
  );
}

/** Returns the current authoritative execution record without browser caching. */
export function getAgentExecution(
  id: string,
): Promise<AgentExecution> {
  return request(
    `/api/agent-executions/${id}`,
    {
      cache: "no-store",
    },
    agentExecutionSchema,
  );
}

/** Returns live process metrics when the server can observe the execution PID. */
export function getAgentExecutionMetrics(
  id: string,
): Promise<{
  cpuPercent: number | null;
  memoryBytes: number | null;
}> {
  return request(
    `/api/agent-executions/${id}/metrics`,
    {
      cache: "no-store",
    },
    {
      parse: (value: unknown) =>
        value as {
          cpuPercent:
            | number
            | null;
          memoryBytes:
            | number
            | null;
        },
    },
  );
}

/** Builds the execution terminal WebSocket URL using a terminal-specific replay cursor. */
export function getAgentExecutionTerminalUrl(
  id: string,
  afterSequence = 0,
): string {
  const normalizedServerUrl =
    SERVER_URL.replace(/\/$/, "");

  const wsUrl =
    normalizedServerUrl.replace(
      /^http/,
      "ws",
    );

  const url = new URL(
    `${wsUrl}/api/agent-executions/${id}/terminal`,
  );

  url.searchParams.set(
    "afterSequence",
    String(afterSequence),
  );

  return url.toString();
}
