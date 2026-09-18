import {
  asc,
  eq,
  sql,
} from "drizzle-orm";

import type {
  CreateDepartment,
  Department,
  UpdateDepartment,
} from "@orc/shared";

import { env } from "../config/env.js";
import {
  ConfigConflictError,
  ConfigReferentialError,
  ConfigValidationError,
  deleteDepartmentFile,
  writeDepartmentFile,
} from "../config/config-mutation-service.js";
import { markConfigOutOfSync } from "../config/health-state.js";
import { loadConfigGraph } from "../config/loader.js";
import { removeDepartmentProjection, syncDepartmentProjection } from "../config/projection-sync.js";
import type { DepartmentConfig } from "../config/schemas.js";
import {
  db,
} from "../db/client.js";
import {
  agents,
  departments,
} from "../db/schema.js";

export class DepartmentServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}

/** Converts a known config-mutation-service error into the stable Department service error shape. */
function translateConfigError(error: unknown): never {
  if (error instanceof ConfigConflictError) {
    throw new DepartmentServiceError(error.message, error.statusCode);
  }
  if (error instanceof ConfigReferentialError) {
    throw new DepartmentServiceError(error.message, error.statusCode);
  }
  if (error instanceof ConfigValidationError) {
    throw new DepartmentServiceError(error.message, error.statusCode);
  }
  throw error;
}

/** Builds the canonical `.orc/departments/<slug>/department.yaml` shape from flat API input. */
function toDepartmentConfig(input: CreateDepartment): DepartmentConfig {
  return {
    version: 1,
    slug: input.slug,
    name: input.name,
    role: input.role,
    description: input.description ?? "",
    enabled: input.enabled ?? true,
    runtime: {
      harness: input.harness,
      model: input.defaultModel,
      reasoning: input.defaultReasoning,
    },
    permissions: {
      write: input.canWrite ?? false,
      commands: input.canRunCommands ?? false,
      sandboxMode: input.sandboxMode ?? null,
      commit: input.canCommit ?? false,
    },
  };
}

/** Converts persisted Department projection data plus its canonical revision into the shared API representation. */
function serializeDepartment(
  row: typeof departments.$inferSelect,
  agentCount = 0,
  configRevision = "",
): Department {
  return {
    ...row,
    agentCount,
    configRevision,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Counts Agents currently assigned to each Department. */
async function loadAgentCounts(): Promise<Map<string, number>> {
  const rows = await db
    .select({
      departmentId: agents.departmentId,
      count: sql<number>`count(*)::int`,
    })
    .from(agents)
    .groupBy(agents.departmentId);

  return new Map(rows.map((row) => [row.departmentId, row.count]));
}

/** Maps additive Department table constraints into stable API errors. */
function translateDatabaseError(error: unknown): never {
  if (error instanceof DepartmentServiceError) {
    throw error;
  }

  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: string }).code;

    if (code === "23505") {
      throw new DepartmentServiceError(
        "A Department with that slug already exists",
        409,
      );
    }

    if (code === "23503" || code === "23001") {
      throw new DepartmentServiceError(
        "Department cannot be deleted because agents still reference it",
        409,
      );
    }
  }

  throw error;
}

/** Lists Departments in deterministic operator-facing order, joined with their canonical file revision. */
export async function listDepartments(configRoot: string = env.ORC_CONFIG_ROOT): Promise<Department[]> {
  const [rows, agentCounts, graph] = await Promise.all([
    db
      .select()
      .from(departments)
      .orderBy(asc(departments.name), asc(departments.id)),
    loadAgentCounts(),
    loadConfigGraph(configRoot),
  ]);

  const revisionBySlug = new Map(graph.departments.map((resource) => [resource.data.slug, resource.contentHash]));

  return rows.map((row) =>
    serializeDepartment(row, agentCounts.get(row.id) ?? 0, revisionBySlug.get(row.slug) ?? ""),
  );
}

/** Gets one Department by identifier. */
export async function getDepartment(id: string, configRoot: string = env.ORC_CONFIG_ROOT): Promise<Department | null> {
  const [department] = await db
    .select()
    .from(departments)
    .where(eq(departments.id, id));

  if (!department) {
    return null;
  }

  const [agentCounts, graph] = await Promise.all([loadAgentCounts(), loadConfigGraph(configRoot)]);
  const revision = graph.departments.find((resource) => resource.data.slug === department.slug)?.contentHash ?? "";

  return serializeDepartment(department, agentCounts.get(id) ?? 0, revision);
}

/**
 * Creates one generic reusable Department configuration. Canonical mutation
 * order: write the `.orc/` file first, then synchronize its PostgreSQL
 * projection. A file write that succeeds but whose projection sync fails
 * marks configuration out-of-sync rather than rolling the file back.
 */
export async function createDepartment(
  input: CreateDepartment,
  configRoot: string = env.ORC_CONFIG_ROOT,
): Promise<Department> {
  const config = toDepartmentConfig(input);
  const prompt = input.systemPrompt;

  let written;
  try {
    written = await writeDepartmentFile(configRoot, config, prompt, { previousSlug: null, expectedRevision: null });
  } catch (error) {
    translateConfigError(error);
  }

  try {
    const row = await syncDepartmentProjection(written.data, written.prompt);
    return serializeDepartment(row, 0, written.configRevision);
  } catch (error) {
    markConfigOutOfSync({ reason: "Department projection sync failed after canonical file write", resourceType: "department", resourceId: config.slug });
    return translateDatabaseError(error);
  }
}

/**
 * Updates a Department. The full canonical resource is rebuilt from the
 * current file plus the supplied partial edit, then written and projected
 * following the same file-first mutation contract as create.
 */
export async function updateDepartment(
  id: string,
  input: UpdateDepartment,
  expectedRevision: string | null = null,
  configRoot: string = env.ORC_CONFIG_ROOT,
): Promise<Department | null> {
  const [existingRow] = await db.select().from(departments).where(eq(departments.id, id));
  if (!existingRow) return null;

  const graph = await loadConfigGraph(configRoot);
  const existingResource = graph.departments.find((resource) => resource.data.slug === existingRow.slug);

  const baseConfig: DepartmentConfig = existingResource
    ? existingResource.data
    : toDepartmentConfig({
        slug: existingRow.slug,
        name: existingRow.name,
        role: existingRow.role,
        description: existingRow.description,
        enabled: existingRow.enabled,
        harness: existingRow.harness,
        defaultModel: existingRow.defaultModel,
        defaultReasoning: existingRow.defaultReasoning,
        systemPrompt: existingRow.systemPrompt,
        canWrite: existingRow.canWrite,
        canRunCommands: existingRow.canRunCommands,
        sandboxMode: existingRow.sandboxMode,
        canCommit: existingRow.canCommit,
      });
  const basePrompt = existingResource?.prompt ?? existingRow.systemPrompt;

  const merged: DepartmentConfig = {
    version: 1,
    slug: input.slug ?? baseConfig.slug,
    name: input.name ?? baseConfig.name,
    role: input.role ?? baseConfig.role,
    description: input.description ?? baseConfig.description,
    enabled: input.enabled ?? baseConfig.enabled,
    runtime: {
      harness: input.harness ?? baseConfig.runtime.harness,
      model: input.defaultModel ?? baseConfig.runtime.model,
      reasoning: input.defaultReasoning ?? baseConfig.runtime.reasoning,
    },
    permissions: {
      write: input.canWrite ?? baseConfig.permissions.write,
      commands: input.canRunCommands ?? baseConfig.permissions.commands,
      sandboxMode: input.sandboxMode !== undefined ? input.sandboxMode : baseConfig.permissions.sandboxMode,
      commit: input.canCommit ?? baseConfig.permissions.commit,
    },
  };
  const mergedPrompt = input.systemPrompt ?? basePrompt;

  // A Department row synced before its canonical file existed (or drifted
  // after a manual delete) has no matching file resource; treat that as a
  // first write rather than an edit of a file that was never there.
  let written;
  try {
    written = await writeDepartmentFile(configRoot, merged, mergedPrompt, {
      previousSlug: existingResource ? existingRow.slug : null,
      expectedRevision: existingResource ? expectedRevision : null,
    });
  } catch (error) {
    translateConfigError(error);
  }

  try {
    const row = await syncDepartmentProjection(written.data, written.prompt);
    const agentCounts = await loadAgentCounts();
    return serializeDepartment(row, agentCounts.get(id) ?? 0, written.configRevision);
  } catch (error) {
    markConfigOutOfSync({ reason: "Department projection sync failed after canonical file write", resourceType: "department", resourceId: merged.slug });
    return translateDatabaseError(error);
  }
}

/**
 * Deletes a Department after safe-delete checks reject it while any Agent
 * file still references it. Deletion removes the canonical file first, then
 * the PostgreSQL projection row.
 */
export async function deleteDepartment(
  id: string,
  expectedRevision: string | null = null,
  configRoot: string = env.ORC_CONFIG_ROOT,
): Promise<boolean> {
  const [existingRow] = await db.select().from(departments).where(eq(departments.id, id));
  if (!existingRow) return false;

  let deleted: boolean;
  try {
    deleted = await deleteDepartmentFile(configRoot, existingRow.slug, expectedRevision);
  } catch (error) {
    translateConfigError(error);
  }

  if (!deleted) return false;

  try {
    await removeDepartmentProjection(existingRow.slug);
    return true;
  } catch (error) {
    markConfigOutOfSync({ reason: "Department projection removal failed after canonical file delete", resourceType: "department", resourceId: existingRow.slug });
    return translateDatabaseError(error);
  }
}
