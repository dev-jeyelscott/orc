import path from "node:path";

import { asc, eq } from "drizzle-orm";

import type { ProjectTeamAssignment, UpsertProjectTeamAssignment } from "@orc/shared";

import { db } from "../db/client.js";
import { projectTeamAssignments, teams } from "../db/schema.js";

export class ProjectTeamAssignmentError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
  }
}

/** Normalizes every persistence lookup to the absolute filesystem path identity. */
export function canonicalProjectPath(projectPath: string): string {
  return path.resolve(projectPath);
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

/** Creates or replaces the single assignment for an already discovered Project path. */
export async function upsertProjectTeamAssignment(projectPath: string, input: UpsertProjectTeamAssignment): Promise<ProjectTeamAssignment> {
  const canonicalPath = canonicalProjectPath(projectPath);
  const notionDataSourceId = input.notionDataSourceId?.trim() || null;
  const autoModeEnabled = input.autoModeEnabled ?? false;
  validateProjectAutomationConfiguration(autoModeEnabled, notionDataSourceId);

  const [team] = await db.select({ id: teams.id }).from(teams).where(eq(teams.id, input.teamId)).limit(1);
  if (!team) throw new ProjectTeamAssignmentError("The selected team does not exist", 404);

  await ensureNotionDataSourceAvailable(notionDataSourceId, canonicalPath);

  try {
    await db.insert(projectTeamAssignments).values({
      projectPath: canonicalPath,
      teamId: input.teamId,
      notionDataSourceId,
      autoModeEnabled,
    }).onConflictDoUpdate({
      target: projectTeamAssignments.projectPath,
      set: { teamId: input.teamId, notionDataSourceId, autoModeEnabled, updatedAt: new Date() },
    });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "23505") {
      throw new ProjectTeamAssignmentError("That Notion data source is already assigned to another Project", 409);
    }
    throw error;
  }

  const assignment = await getProjectTeamAssignmentByPath(canonicalPath);
  if (!assignment) throw new Error("Project Team assignment could not be reloaded");
  return assignment;
}

/** Deletes configuration only. It never affects filesystem discovery or historical workflow ownership. */
export async function deleteProjectTeamAssignment(projectPath: string): Promise<boolean> {
  const deleted = await db.delete(projectTeamAssignments).where(eq(projectTeamAssignments.projectPath, canonicalProjectPath(projectPath))).returning({ projectPath: projectTeamAssignments.projectPath });
  return deleted.length > 0;
}

/** Used by automation intake to enumerate only persisted assignment configuration. */
export async function listProjectTeamAssignments(): Promise<ProjectTeamAssignment[]> {
  const rows = await db.select(assignmentSelection).from(projectTeamAssignments).innerJoin(teams, eq(projectTeamAssignments.teamId, teams.id)).orderBy(asc(projectTeamAssignments.projectPath));
  return rows.map(serializeAssignment);
}
