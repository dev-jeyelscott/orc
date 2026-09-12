import {
  teamWorkflowSchema,
  type TeamWorkflow,
  type TeamWorkflowInput,
} from "@orc/shared";

const SERVER_URL =
  process.env.NEXT_PUBLIC_SERVER_URL ??
  "http://localhost:4000";

/**
 * Reads a backend Team workflow error response into stable operator-facing text.
 */
async function readErrorMessage(
  response: Response,
): Promise<string> {
  const body = (
    await response.json().catch(() => null)
  ) as { error?: string } | null;

  return body?.error ?? `Request failed: ${response.status}`;
}

/**
 * Loads one Team's persisted workflow: composition, layer/order placement,
 * and outcome routing.
 */
export async function getTeamWorkflow(
  teamId: string,
  signal?: AbortSignal,
): Promise<TeamWorkflow> {
  const response = await fetch(
    `${SERVER_URL}/api/teams/${teamId}/workflow`,
    {
      cache: "no-store",
      signal,
    },
  );

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  return teamWorkflowSchema.parse(await response.json());
}

/**
 * Atomically replaces one Team's entire workflow. A partial save can never
 * leave invalid composition or dangling routes -- the server validates the
 * complete desired workflow before mutating anything.
 */
export async function replaceTeamWorkflow(
  teamId: string,
  input: TeamWorkflowInput,
): Promise<TeamWorkflow> {
  const response = await fetch(
    `${SERVER_URL}/api/teams/${teamId}/workflow`,
    {
      method: "PUT",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(input),
    },
  );

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  return teamWorkflowSchema.parse(await response.json());
}
