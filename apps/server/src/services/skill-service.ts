import { asc, eq, inArray } from "drizzle-orm";

import type { CreateSkill, Skill, UpdateSkill } from "@orc/shared";

import { env } from "../config/env.js";
import {
  ConfigConflictError,
  ConfigReferentialError,
  ConfigValidationError,
  deleteSkillFile,
  writeSkillFile,
} from "../config/config-mutation-service.js";
import { markConfigOutOfSync } from "../config/health-state.js";
import { loadConfigGraph } from "../config/loader.js";
import { removeSkillProjection, syncSkillProjection } from "../config/projection-sync.js";
import type { SkillConfig } from "../config/schemas.js";
import { db } from "../db/client.js";
import { skills } from "../db/schema.js";

export class SkillServiceError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
  }
}

/** Converts a known config-mutation-service error into the stable Skill service error shape. */
function translateConfigError(error: unknown): never {
  if (
    error instanceof ConfigConflictError ||
    error instanceof ConfigReferentialError ||
    error instanceof ConfigValidationError
  ) {
    throw new SkillServiceError(error.message, error.statusCode);
  }
  throw error;
}

/** Builds the canonical `.orc/skills/<slug>/skill.yaml` shape from flat API input. */
function toSkillConfig(input: CreateSkill): SkillConfig {
  return {
    version: 1,
    slug: input.slug,
    name: input.name,
    description: input.description ?? "",
    enabled: input.enabled ?? true,
    tags: input.tags ?? [],
    domains: input.domains ?? [],
  };
}

function serializeSkill(row: typeof skills.$inferSelect, configRevision = ""): Skill {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    enabled: row.enabled,
    tags: (row.tags as string[] | null) ?? [],
    domains: (row.domains as string[] | null) ?? [],
    hasInstructions: row.hasInstructions,
    configRevision,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Maps additive Skill table constraints into stable API errors. */
function translateDatabaseError(error: unknown): never {
  if (error instanceof SkillServiceError) throw error;
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: string }).code;
    if (code === "23505") throw new SkillServiceError("A Skill with that slug already exists", 409);
    if (code === "23503") throw new SkillServiceError("The Skill is still assigned and cannot be deleted", 409);
  }
  throw error;
}

/** Lists Skills in deterministic operator-facing order, joined with their canonical file revision. */
export async function listSkills(configRoot: string = env.ORC_CONFIG_ROOT): Promise<Skill[]> {
  const [rows, graph] = await Promise.all([
    db.select().from(skills).orderBy(asc(skills.name), asc(skills.id)),
    loadConfigGraph(configRoot),
  ]);

  const revisionBySlug = new Map(graph.skills.map((resource) => [resource.data.slug, resource.contentHash]));
  return rows.map((row) => serializeSkill(row, revisionBySlug.get(row.slug) ?? ""));
}

export async function getSkill(id: string, configRoot: string = env.ORC_CONFIG_ROOT): Promise<Skill | null> {
  const [row] = await db.select().from(skills).where(eq(skills.id, id));
  if (!row) return null;

  const graph = await loadConfigGraph(configRoot);
  const revision = graph.skills.find((resource) => resource.data.slug === row.slug)?.contentHash ?? "";
  return serializeSkill(row, revision);
}

export async function getSkillsByIds(ids: string[]): Promise<Skill[]> {
  if (!ids.length) return [];
  const rows = await db.select().from(skills).where(inArray(skills.id, ids));
  const byId = new Map(rows.map((row) => [row.id, serializeSkill(row)]));
  return ids.flatMap((id) => byId.get(id) ?? []);
}

/**
 * Creates one generic reusable Skill configuration. Canonical mutation
 * order: write the `.orc/skills/<slug>/skill.yaml` file first, then
 * synchronize its PostgreSQL projection. A file write that succeeds but
 * whose projection sync fails marks configuration out-of-sync rather than
 * rolling the file back.
 */
export async function createSkill(
  input: CreateSkill,
  configRoot: string = env.ORC_CONFIG_ROOT,
): Promise<Skill> {
  const config = toSkillConfig(input);

  let written;
  try {
    written = await writeSkillFile(configRoot, config, null, { previousSlug: null, expectedRevision: null });
  } catch (error) {
    translateConfigError(error);
  }

  try {
    const row = await syncSkillProjection(written.data, written.instructions);
    return serializeSkill(row, written.configRevision);
  } catch (error) {
    markConfigOutOfSync({ reason: "Skill projection sync failed after canonical file write", resourceType: "skill", resourceId: config.slug });
    return translateDatabaseError(error);
  }
}

/**
 * Updates a Skill. The full canonical resource (and its existing `SKILL.md`,
 * if any) is rebuilt from the current file plus the supplied partial edit,
 * then written and projected following the same file-first mutation
 * contract as create.
 */
export async function updateSkill(
  id: string,
  input: UpdateSkill,
  expectedRevision: string | null = null,
  configRoot: string = env.ORC_CONFIG_ROOT,
): Promise<Skill | null> {
  const [existingRow] = await db.select().from(skills).where(eq(skills.id, id));
  if (!existingRow) return null;

  const graph = await loadConfigGraph(configRoot);
  const existingResource = graph.skills.find((resource) => resource.data.slug === existingRow.slug);

  const baseConfig: SkillConfig = existingResource
    ? existingResource.data
    : toSkillConfig({
        slug: existingRow.slug,
        name: existingRow.name,
        description: existingRow.description,
        enabled: existingRow.enabled,
        tags: (existingRow.tags as string[] | null) ?? [],
        domains: (existingRow.domains as string[] | null) ?? [],
      });
  const baseInstructions = existingResource?.instructions ?? null;

  const merged: SkillConfig = {
    version: 1,
    slug: input.slug ?? baseConfig.slug,
    name: input.name ?? baseConfig.name,
    description: input.description ?? baseConfig.description,
    enabled: input.enabled ?? baseConfig.enabled,
    tags: input.tags ?? baseConfig.tags,
    domains: input.domains ?? baseConfig.domains,
  };

  let written;
  try {
    written = await writeSkillFile(configRoot, merged, baseInstructions, {
      previousSlug: existingResource ? existingRow.slug : null,
      expectedRevision: existingResource ? expectedRevision : null,
    });
  } catch (error) {
    translateConfigError(error);
  }

  try {
    const row = await syncSkillProjection(written.data, written.instructions);
    return serializeSkill(row, written.configRevision);
  } catch (error) {
    markConfigOutOfSync({ reason: "Skill projection sync failed after canonical file write", resourceType: "skill", resourceId: merged.slug });
    return translateDatabaseError(error);
  }
}

/**
 * Deletes a Skill after safe-delete checks reject it while any Agent file
 * still assigns it. Deletion removes the canonical file first, then the
 * PostgreSQL projection row.
 */
export async function deleteSkill(
  id: string,
  expectedRevision: string | null = null,
  configRoot: string = env.ORC_CONFIG_ROOT,
): Promise<boolean> {
  const [existingRow] = await db.select().from(skills).where(eq(skills.id, id));
  if (!existingRow) return false;

  let deleted: boolean;
  try {
    deleted = await deleteSkillFile(configRoot, existingRow.slug, expectedRevision);
  } catch (error) {
    translateConfigError(error);
  }

  if (!deleted) return false;

  try {
    await removeSkillProjection(existingRow.slug);
    return true;
  } catch (error) {
    markConfigOutOfSync({ reason: "Skill projection removal failed after canonical file delete", resourceType: "skill", resourceId: existingRow.slug });
    return translateDatabaseError(error);
  }
}
