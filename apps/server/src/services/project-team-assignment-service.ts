import path from "node:path";

import { asc, eq } from "drizzle-orm";

import type { ProjectTeamAssignment, UpsertProjectTeamAssignment } from "@orc/shared";

import { env } from "../config/env.js";
import {
  ConfigConflictError,
  ConfigReferentialError,
  ConfigValidationError,
  deleteProjectFile,
  writeProjectFile,
} from "../config/config-mutation-service.js";
import { markConfigOutOfSync } from "../config/health-state.js";
import { loadConfigGraph } from "../config/loader.js";
import { removeProjectAssignmentProjection, syncProjectAssignmentProjection } from "../config/projection-sync.js";
import type { ProjectConfig } from "../config/schemas.js";
import { resolveWorkspaceRoot } from "../config/workspace-root.js";
import { db } from "../db/client.js";
import { projectTeamAssignments, teams } from "../db/schema.js";
import { getProjectByPath } from "./project-discovery.js";

export class ProjectTeamAssignmentError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
  }
}

/** Converts a known config-mutation-service error into the stable Project Team assignment error shape. */
function translateConfigError(error: unknown): never {
  if (
    error instanceof ConfigConflictError ||
    error instanceof ConfigReferentialError ||
    error instanceof ConfigValidationError
  ) {
    throw new ProjectTeamAssignmentError(error.message, error.statusCode);
  }
  throw error;
}

/** Normalizes every persistence lookup to the absolute filesystem path identity. */
export function canonicalProjectPath(projectPath: string): string {
  return path.resolve(projectPath);
}

/** Derives a stable kebab-case Project slug from its directory name. */
function deriveProjectSlug(basename: string): string {
  const slug = basename
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "project";
}

function serializeAssignment(row: {
  projectPath: string;
  teamId: string;
  teamName: string;
  notionDataSourceId: string | null;
  autoModeEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}): ProjectTeamAssignment {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const assignmentSelection = {
  projectPath: projectTeamAssignments.projectPath,
  teamId: projectTeamAssignments.teamId,
  teamName: teams.name,
  notionDataSourceId: projectTeamAssignments.notionDataSourceId,
  autoModeEnabled: projectTeamAssignments.autoModeEnabled,
  createdAt: projectTeamAssignments.createdAt,
  updatedAt: projectTeamAssignments.updatedAt,
};

/** Returns configuration only; callers must independently prove the project is currently discovered. */
export async function getProjectTeamAssignmentByPath(projectPath: string): Promise<ProjectTeamAssignment | null> {
  const [row] = await db
    .select(assignmentSelection)
    .from(projectTeamAssignments)
    .innerJoin(teams, eq(projectTeamAssignments.teamId, teams.id))
    .where(eq(projectTeamAssignments.projectPath, canonicalProjectPath(projectPath)))
    .limit(1);

  return row ? serializeAssignment(row) : null;
}

/** Reads assignments for discovered paths only; stale rows are intentionally not returned. */
export async function getProjectTeamAssignmentsByPaths(projectPaths: readonly string[]): Promise<Map<string, ProjectTeamAssignment>> {
  const results = await Promise.all(projectPaths.map((projectPath) => getProjectTeamAssignmentByPath(projectPath)));
  return new Map(results.filter((assignment): assignment is ProjectTeamAssignment => assignment !== null).map((assignment) => [assignment.projectPath, assignment]));
}

async function ensureNotionDataSourceAvailable(notionDataSourceId: string | null, projectPath: string): Promise<void> {
  if (!notionDataSourceId) return;

  const [assignment] = await db
    .select({ projectPath: projectTeamAssignments.projectPath })
    .from(projectTeamAssignments)
    .where(eq(projectTeamAssignments.notionDataSourceId, notionDataSourceId))
    .limit(1);
  if (assignment && assignment.projectPath !== projectPath) {
    throw new ProjectTeamAssignmentError("That Notion data source is already assigned to another Project", 409);
  }
}

/** Validates Project-scoped automation intent before any persistence mutation. */
export function validateProjectAutomationConfiguration(
  autoModeEnabled: boolean,
  notionDataSourceId: string | null,
): void {
  if (autoModeEnabled && !notionDataSourceId) {
    throw new ProjectTeamAssignmentError("A Notion data source ID is required when Auto Mode is enabled", 400);
  }
}

/**
 * Writes canonical `.orc/projects/<slug>.yaml` file projection (roadmap
 * Vertical Spec 6/8) for an assignment mutation. The migration is complete
 * through Spec 8: a Project assignment mutation always requires a
 * currently discovered filesystem Project (a Project file must never
 * fabricate one) and an already file-authoritative Team (Spec 4). Either
 * prerequisite missing is an explicit configuration error, never a silent
 * DB-only assignment.
 */
async function tryWriteProjectFile(
  canonicalPath: string,
  teamSlug: string,
  automation: ProjectConfig["automation"],
  configRoot: string,
): Promise<{ data: ProjectConfig }> {
  const workspaceRoot = await resolveWorkspaceRoot(configRoot);
  const discovered = await getProjectByPath(workspaceRoot, canonicalPath);
  if (!discovered) {
    throw new ProjectTeamAssignmentError(
      "Canonical configuration is missing: this path is not a currently discovered filesystem Project under the configured workspace root. Verify the Project exists under the workspace and that .orc/orc.yaml's workspaceRoot is correct.",
      409,
    );
  }

  const graph = await loadConfigGraph(configRoot);
  const teamResource = graph.teams.find((resource) => resource.data.slug === teamSlug);
  if (!teamResource) {
    throw new ProjectTeamAssignmentError(
      `Canonical configuration is missing: Team "${teamSlug}" has no .orc/teams/${teamSlug}/team.yaml. Export or synchronize .orc/ configuration before assigning this Team to a Project.`,
      409,
    );
  }

  const relativePath = path.relative(workspaceRoot, canonicalPath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new ProjectTeamAssignmentError(
      "This Project path is outside the configured workspace root and cannot be written to canonical configuration.",
      409,
    );
  }

  const existingResource = graph.projects.find((resource) => {
    const resolved = path.resolve(workspaceRoot, resource.data.path);
    return resolved === canonicalPath;
  });

  const slug = existingResource?.data.slug ?? deriveProjectSlug(path.basename(canonicalPath));

  const config: ProjectConfig = {
    version: 1,
    slug,
    path: relativePath,
    team: teamSlug,
    automation,
  };

  try {
    const written = await writeProjectFile(configRoot, config, {
      previousSlug: existingResource ? existingResource.data.slug : null,
      expectedRevision: null,
    });
    return { data: written.data };
  } catch (error) {
    translateConfigError(error);
  }
}

/** Creates or replaces the single assignment for an already discovered Project path. */
export async function upsertProjectTeamAssignment(
  projectPath: string,
  input: UpsertProjectTeamAssignment,
  configRoot: string = env.ORC_CONFIG_ROOT,
): Promise<ProjectTeamAssignment> {
  const canonicalPath = canonicalProjectPath(projectPath);
  const notionDataSourceId = input.notionDataSourceId?.trim() || null;
  const autoModeEnabled = input.autoModeEnabled ?? false;
  validateProjectAutomationConfiguration(autoModeEnabled, notionDataSourceId);

  const [team] = await db.select({ id: teams.id, slug: teams.slug }).from(teams).where(eq(teams.id, input.teamId)).limit(1);
  if (!team) throw new ProjectTeamAssignmentError("The selected team does not exist", 404);

  await ensureNotionDataSourceAvailable(notionDataSourceId, canonicalPath);

  const automation: ProjectConfig["automation"] = { notionDataSourceId, autoModeEnabled };

  let fileWrite: { data: ProjectConfig };
  try {
    fileWrite = await tryWriteProjectFile(canonicalPath, team.slug, automation, configRoot);
  } catch (error) {
    translateConfigError(error);
  }

  try {
    await syncProjectAssignmentProjection(fileWrite.data, canonicalPath);
  } catch (error) {
    markConfigOutOfSync({
      reason: "Project assignment projection sync failed after canonical file write",
      resourceType: "project",
      resourceId: fileWrite.data.slug,
    });
    if (typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "23505") {
      throw new ProjectTeamAssignmentError("That Notion data source is already assigned to another Project", 409);
    }
    throw error;
  }

  const assignment = await getProjectTeamAssignmentByPath(canonicalPath);
  if (!assignment) throw new Error("Project Team assignment could not be reloaded");
  return assignment;
}

/**
 * Deletes configuration only. It never affects filesystem discovery or
 * historical workflow ownership. Removes the canonical Project file first
 * when one exists, then the PostgreSQL projection row.
 */
export async function deleteProjectTeamAssignment(
  projectPath: string,
  configRoot: string = env.ORC_CONFIG_ROOT,
): Promise<boolean> {
  const canonicalPath = canonicalProjectPath(projectPath);

  const workspaceRoot = await resolveWorkspaceRoot(configRoot);
  const graph = await loadConfigGraph(configRoot);
  const existingResource = graph.projects.find((resource) => path.resolve(workspaceRoot, resource.data.path) === canonicalPath);

  if (existingResource) {
    try {
      await deleteProjectFile(configRoot, existingResource.data.slug, null);
    } catch (error) {
      translateConfigError(error);
    }
  }

  const existingAssignment = await getProjectTeamAssignmentByPath(canonicalPath);
  if (!existingAssignment) return false;

  await removeProjectAssignmentProjection(canonicalPath);
  return true;
}

/** Used by automation intake to enumerate only persisted assignment configuration. */
export async function listProjectTeamAssignments(): Promise<ProjectTeamAssignment[]> {
  const rows = await db.select(assignmentSelection).from(projectTeamAssignments).innerJoin(teams, eq(projectTeamAssignments.teamId, teams.id)).orderBy(asc(projectTeamAssignments.projectPath));
  return rows.map(serializeAssignment);
}
