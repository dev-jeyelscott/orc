import {
  teamListResponseSchema,
  type Team,
} from "@orc/shared";

const SERVER_URL =
  process.env
    .NEXT_PUBLIC_SERVER_URL ??
  "http://localhost:4000";

/**
 * Reads the backend error payload into a stable client-facing message.
 */
async function readErrorMessage(
  response:
    Response,
): Promise<string> {
  const body =
    (
      await response
        .json()
        .catch(
          () => null,
        )
    ) as {
      error?: string;
    } | null;

  return (
    body?.error ??
    `Request failed: ${response.status}`
  );
}

/**
 * Loads all Team configurations for Agent assignment.
 */
export async function getTeams(): Promise<
  Team[]
> {
  const response =
    await fetch(
      `${SERVER_URL}/api/teams`,
      {
        cache:
          "no-store",
      },
    );

  if (
    !response.ok
  ) {
    throw new Error(
      await readErrorMessage(
        response,
      ),
    );
  }

  return teamListResponseSchema
    .parse(
      await response.json(),
    )
    .teams;
}
