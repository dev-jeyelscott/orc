import {
  teamMembershipSchema,
  type TeamMembership,
  type TeamMembershipInput,
} from "@orc/shared";

const SERVER_URL =
  process.env.NEXT_PUBLIC_SERVER_URL ??
  "http://localhost:4000";

/**
 * Reads a backend Team membership error response into stable operator-facing text.
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
 * Loads one Team's membership -- Agent IDs only. Workflow topology (layer,
 * order, outcome routing) is not part of this resource; it lives under the
 * graph Draft/Published endpoints in `lib/workflow-graph.ts`.
 */
export async function getTeamMembers(
  teamId: string,
  signal?: AbortSignal,
): Promise<TeamMembership> {
  const response = await fetch(
    `${SERVER_URL}/api/teams/${teamId}/members`,
    {
      cache: "no-store",
      signal,
    },
  );

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  return teamMembershipSchema.parse(await response.json());
}

/**
 * Atomically replaces one Team's composition. Never accepts layer, order,
 * or routing input -- topology is owned exclusively by the workflow graph.
 */
export async function replaceTeamMembers(
  teamId: string,
  input: TeamMembershipInput,
): Promise<TeamMembership> {
  const response = await fetch(
    `${SERVER_URL}/api/teams/${teamId}/members`,
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

  return teamMembershipSchema.parse(await response.json());
}
