import {
  asc,
  eq,
} from "drizzle-orm";

import type {
  CreateTeam,
  Team,
  UpdateTeam,
} from "@orc/shared";

import {
  db,
} from "../db/client.js";
import {
  agents,
  conversations,
  runs,
  tasks,
  teamMembers,
  teams,
} from "../db/schema.js";

export class TeamServiceError extends Error {
  /**
   * Creates a Team service error carrying its HTTP status.
   */
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}

/**
 * Converts one persisted Team row into the shared API representation.
 */
function serializeTeam(
  row:
    typeof teams.$inferSelect,
): Team {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    enabled: row.enabled,
    createdAt:
      row.createdAt.toISOString(),
    updatedAt:
      row.updatedAt.toISOString(),
  };
}

/**
 * Maps expected PostgreSQL constraint failures into stable Team service errors.
 */
function translateDatabaseError(
  error: unknown,
): never {
  if (
    error instanceof
    TeamServiceError
  ) {
    throw error;
  }

  if (
    typeof error ===
      "object" &&
    error !== null &&
    "code" in error
  ) {
    const databaseError =
      error as {
        code?: string;
        constraint_name?: string;
      };

    const code =
      databaseError.code;

    if (
      code ===
      "23505"
    ) {
      if (
        databaseError.constraint_name ===
        "teams_notion_data_source_id_unique"
      ) {
        throw new TeamServiceError(
          "That Notion data source is already assigned to another Team",
          409,
        );
      }

      throw new TeamServiceError(
        "A Team with that slug already exists",
        409,
      );
    }

    if (
      code ===
      "23503"
    ) {
      throw new TeamServiceError(
        "Team cannot be deleted because related data still references it",
        409,
      );
    }
  }

  throw error;
}

/**
 * Lists all Teams using deterministic operator-facing ordering.
 */
export async function listTeams(): Promise<
  Team[]
> {
  return (
    await db
      .select()
      .from(teams)
      .orderBy(
        asc(
          teams.name,
        ),
        asc(
          teams.id,
        ),
      )
  ).map(
    serializeTeam,
  );
}

/**
 * Returns one Team by identifier.
 */
export async function getTeam(
  id: string,
): Promise<
  Team | null
> {
  const [team] =
    await db
      .select()
      .from(teams)
      .where(
        eq(
          teams.id,
          id,
        ),
      );

  return team
    ? serializeTeam(
        team,
      )
    : null;
}

/**
 * Creates one generic Team configuration.
 */
export async function createTeam(
  input:
    CreateTeam,
): Promise<Team> {
  try {
    const [team] =
      await db
        .insert(teams)
        .values(input)
        .returning();

    return serializeTeam(
      team,
    );
  } catch (error) {
    return translateDatabaseError(
      error,
    );
  }
}

/**
 * Updates Team metadata without changing existing ownership relations.
 */
export async function updateTeam(
  id: string,
  input:
    UpdateTeam,
): Promise<
  Team | null
> {
  try {
    const [existing] =
      await db
        .select()
        .from(teams)
        .where(
          eq(
            teams.id,
            id,
          ),
        );

    if (
      !existing
    ) {
      return null;
    }

    const [team] =
      await db
        .update(teams)
        .set({
          ...input,
          updatedAt:
            new Date(),
        })
        .where(
          eq(
            teams.id,
            id,
          ),
        )
        .returning();

    return team
      ? serializeTeam(
          team,
        )
      : null;
  } catch (error) {
    return translateDatabaseError(
      error,
    );
  }
}

/**
 * Deletes an unreferenced Team after returning an explicit conflict reason for known references.
 */
export async function deleteTeam(
  id: string,
): Promise<boolean> {
  try {
    return await db.transaction(
      async (
        tx,
      ) => {
        const [existing] =
          await tx
            .select({
              id:
                teams.id,
            })
            .from(teams)
            .where(
              eq(
                teams.id,
                id,
              ),
            );

        if (
          !existing
        ) {
          return false;
        }

        const [agentReference] =
          await tx
            .select({
              id:
                agents.id,
            })
            .from(agents)
            .where(
              eq(
                agents.teamId,
                id,
              ),
            )
            .limit(1);

        if (
          agentReference
        ) {
          throw new TeamServiceError(
            "Team cannot be deleted because agents still reference it",
            409,
          );
        }

        const [teamMemberReference] =
          await tx
            .select({
              id:
                teamMembers.id,
            })
            .from(teamMembers)
            .where(
              eq(
                teamMembers.teamId,
                id,
              ),
            )
            .limit(1);

        if (
          teamMemberReference
        ) {
          throw new TeamServiceError(
            "Team cannot be deleted because it still has workflow members",
            409,
          );
        }

        const [taskReference] =
          await tx
            .select({
              id:
                tasks.id,
            })
            .from(tasks)
            .where(
              eq(
                tasks.teamId,
                id,
              ),
            )
            .limit(1);

        if (
          taskReference
        ) {
          throw new TeamServiceError(
            "Team cannot be deleted because tasks still reference it",
            409,
          );
        }

        const [runReference] =
          await tx
            .select({
              id:
                runs.id,
            })
            .from(runs)
            .where(
              eq(
                runs.teamId,
                id,
              ),
            )
            .limit(1);

        if (
          runReference
        ) {
          throw new TeamServiceError(
            "Team cannot be deleted because runs still reference it",
            409,
          );
        }

        const [conversationReference] =
          await tx
            .select({
              id:
                conversations.id,
            })
            .from(
              conversations,
            )
            .where(
              eq(
                conversations.teamId,
                id,
              ),
            )
            .limit(1);

        if (
          conversationReference
        ) {
          throw new TeamServiceError(
            "Team cannot be deleted because conversations still reference it",
            409,
          );
        }

        const [deleted] =
          await tx
            .delete(teams)
            .where(
              eq(
                teams.id,
                id,
              ),
            )
            .returning({
              id:
                teams.id,
            });

        return Boolean(
          deleted,
        );
      },
    );
  } catch (error) {
    return translateDatabaseError(
      error,
    );
  }
}
