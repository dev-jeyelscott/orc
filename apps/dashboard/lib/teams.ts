import {
  teamListResponseSchema,
  teamSchema,
  type CreateTeam,
  type Team,
  type UpdateTeam,
} from "@orc/shared";

const SERVER_URL =
  process.env.NEXT_PUBLIC_SERVER_URL ??
  "http://localhost:4000";

/**
 * Reads a backend Team error response into stable operator-facing text.
 */
async function readErrorMessage(
  response: Response,
): Promise<string> {
  const body = (
    await response
      .json()
      .catch(() => null)
  ) as {
    error?: string;
  } | null;

  return (
    body?.error ??
    `Request failed: ${response.status}`
  );
}

/**
 * Executes a JSON Team mutation and validates the returned Team contract.
 */
async function requestTeam(
  path: string,
  options: RequestInit,
): Promise<Team> {
  const response =
    await fetch(
      `${SERVER_URL}${path}`,
      {
        ...options,
        headers: {
          "content-type":
            "application/json",
        },
      },
    );

  if (!response.ok) {
    throw new Error(
      await readErrorMessage(
        response,
      ),
    );
  }

  return teamSchema.parse(
    await response.json(),
  );
}

/**
 * Loads every configured Team without browser caching.
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

  if (!response.ok) {
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

/**
 * Creates one Team configuration.
 */
export function createTeam(
  input: CreateTeam,
): Promise<Team> {
  return requestTeam(
    "/api/teams",
    {
      method:
        "POST",
      body:
        JSON.stringify(
          input,
        ),
    },
  );
}

/**
 * Updates one existing Team configuration.
 */
export function updateTeam(
  teamId: string,
  input: UpdateTeam,
): Promise<Team> {
  return requestTeam(
    `/api/teams/${teamId}`,
    {
      method:
        "PATCH",
      body:
        JSON.stringify(
          input,
        ),
    },
  );
}

/**
 * Deletes one Team only when the server confirms it has no references.
 */
export async function deleteTeam(
  teamId: string,
): Promise<void> {
  const response =
    await fetch(
      `${SERVER_URL}/api/teams/${teamId}`,
      {
        method:
          "DELETE",
      },
    );

  if (!response.ok) {
    throw new Error(
      await readErrorMessage(
        response,
      ),
    );
  }
}
