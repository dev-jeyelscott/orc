import {
  asc,
  eq,
} from "drizzle-orm";

import type {
  CreateTeam,
  Team,
  UpdateTeam,
} from "@orc/shared";

import { env } from "../config/env.js";
import {
  ConfigConflictError,
  ConfigReferentialError,
  ConfigValidationError,
  deleteTeamFile,
  writeTeamFile,
} from "../config/config-mutation-service.js";
import { markConfigOutOfSync } from "../config/health-state.js";
import { loadConfigGraph } from "../config/loader.js";
import { removeTeamProjection, syncTeamProjection } from "../config/projection-sync.js";
import type { TeamConfig } from "../config/schemas.js";
import {
  db,
} from "../db/client.js";
import {
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

/** Converts a known config-mutation-service error into the stable Team service error shape. */
function translateConfigError(error: unknown): never {
  if (
    error instanceof ConfigConflictError ||
    error instanceof ConfigReferentialError ||
    error instanceof ConfigValidationError
  ) {
    throw new TeamServiceError(error.message, error.statusCode);
  }
  throw error;
}

/** Builds the canonical `.orc/teams/<slug>/team.yaml` shape from flat API input, preserving current file membership. */
function toTeamConfig(input: CreateTeam, members: readonly string[] = []): TeamConfig {
  return {
    version: 1,
    slug: input.slug,
    name: input.name,
    description: input.description ?? "",
    enabled: input.enabled ?? true,
    members: [...members],
  };
}

/**
 * Converts one persisted Team row into the shared API representation.
 */
function serializeTeam(
  row:
    typeof teams.$inferSelect,
  configRevision = "",
): Team {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    enabled: row.enabled,
    configRevision,
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

/** Lists all Teams using deterministic operator-facing ordering, joined with their canonical file revision. */
export async function listTeams(configRoot: string = env.ORC_CONFIG_ROOT): Promise<
  Team[]
> {
  const [rows, graph] = await Promise.all([
    db
      .select()
      .from(teams)
      .orderBy(
        asc(
          teams.name,
        ),
        asc(
          teams.id,
        ),
      ),
    loadConfigGraph(configRoot),
  ]);

  const revisionBySlug = new Map(graph.teams.map((resource) => [resource.data.slug, resource.contentHash]));

  return rows.map((row) => serializeTeam(row, revisionBySlug.get(row.slug) ?? ""));
}

/**
 * Returns one Team by identifier.
 */
export async function getTeam(
  id: string,
  configRoot: string = env.ORC_CONFIG_ROOT,
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

  if (!team) return null;

  const graph = await loadConfigGraph(configRoot);
  const revision = graph.teams.find((resource) => resource.data.slug === team.slug)?.contentHash ?? "";

  return serializeTeam(team, revision);
}

/**
 * Creates one generic Team configuration. Canonical mutation order: write
 * the `.orc/teams/<slug>/team.yaml` file first (with no members yet), then
 * synchronize its PostgreSQL projection.
 */
export async function createTeam(
  input: CreateTeam,
  configRoot: string = env.ORC_CONFIG_ROOT,
): Promise<Team> {
  const config = toTeamConfig(input, []);

  let written;
  try {
    written = await writeTeamFile(configRoot, config, { previousSlug: null, expectedRevision: null });
  } catch (error) {
    translateConfigError(error);
  }

  try {
    const row = await syncTeamProjection(written.data);
    return serializeTeam(row, written.configRevision);
  } catch (error) {
    markConfigOutOfSync({ reason: "Team projection sync failed after canonical file write", resourceType: "team", resourceId: config.slug });
    return translateDatabaseError(error);
  }
}

/**
 * Updates Team metadata without changing existing membership. The full
 * canonical resource is rebuilt from the current file (or, for a Team row
 * synced before its canonical file existed, the current DB row) plus the
 * supplied partial edit, then written and projected.
 */
export async function updateTeam(
  id: string,
  input: UpdateTeam,
  expectedRevision: string | null = null,
  configRoot: string = env.ORC_CONFIG_ROOT,
): Promise<
  Team | null
> {
  const [existingRow] = await db.select().from(teams).where(eq(teams.id, id));
  if (!existingRow) return null;

  const graph = await loadConfigGraph(configRoot);
  const existingResource = graph.teams.find((resource) => resource.data.slug === existingRow.slug);

  const baseConfig: TeamConfig = existingResource
    ? existingResource.data
    : toTeamConfig({
        slug: existingRow.slug,
        name: existingRow.name,
        description: existingRow.description,
        enabled: existingRow.enabled,
      });

  const merged: TeamConfig = {
    version: 1,
    slug: input.slug ?? baseConfig.slug,
    name: input.name ?? baseConfig.name,
    description: input.description ?? baseConfig.description,
    enabled: input.enabled ?? baseConfig.enabled,
    members: baseConfig.members,
  };

  let written;
  try {
    written = await writeTeamFile(configRoot, merged, {
      previousSlug: existingResource ? existingRow.slug : null,
      expectedRevision: existingResource ? expectedRevision : null,
    });
  } catch (error) {
    translateConfigError(error);
  }

  try {
    const row = await syncTeamProjection(written.data);
    return serializeTeam(row, written.configRevision);
  } catch (error) {
    markConfigOutOfSync({ reason: "Team projection sync failed after canonical file write", resourceType: "team", resourceId: merged.slug });
    return translateDatabaseError(error);
  }
}

/**
 * Deletes an unreferenced Team after returning an explicit conflict reason
 * for known references. Reference safety runs against PostgreSQL (the
 * authoritative source for membership/Task/Run/Conversation state) before
 * the canonical file and its projection row are removed.
 */
export async function deleteTeam(
  id: string,
  expectedRevision: string | null = null,
  configRoot: string = env.ORC_CONFIG_ROOT,
): Promise<boolean> {
  const [existingRow] = await db.select().from(teams).where(eq(teams.id, id));
  if (!existingRow) return false;

  try {
    const [teamMemberReference] = await db
      .select({ id: teamMembers.id })
      .from(teamMembers)
      .where(eq(teamMembers.teamId, id))
      .limit(1);

    if (teamMemberReference) {
      throw new TeamServiceError("Team cannot be deleted because it still has workflow members", 409);
    }

    const [taskReference] = await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.teamId, id)).limit(1);
    if (taskReference) {
      throw new TeamServiceError("Team cannot be deleted because tasks still reference it", 409);
    }

    const [runReference] = await db.select({ id: runs.id }).from(runs).where(eq(runs.teamId, id)).limit(1);
    if (runReference) {
      throw new TeamServiceError("Team cannot be deleted because runs still reference it", 409);
    }

    const [conversationReference] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.teamId, id))
      .limit(1);

    if (conversationReference) {
      throw new TeamServiceError("Team cannot be deleted because conversations still reference it", 409);
    }
  } catch (error) {
    return translateDatabaseError(error);
  }

  let deleted: boolean;
  try {
    deleted = await deleteTeamFile(configRoot, existingRow.slug, expectedRevision);
  } catch (error) {
    translateConfigError(error);
  }

  if (!deleted) return false;

  try {
    await removeTeamProjection(existingRow.slug);
    return true;
  } catch (error) {
    markConfigOutOfSync({ reason: "Team projection removal failed after canonical file delete", resourceType: "team", resourceId: existingRow.slug });
    return translateDatabaseError(error);
  }
}
