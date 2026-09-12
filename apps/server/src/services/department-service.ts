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

/** Converts persisted Department data into the shared API representation. */
function serializeDepartment(
  row: typeof departments.$inferSelect,
  agentCount = 0,
): Department {
  return {
    ...row,
    agentCount,
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

/** Lists Departments in deterministic operator-facing order. */
export async function listDepartments(): Promise<Department[]> {
  const [rows, agentCounts] = await Promise.all([
    db
      .select()
      .from(departments)
      .orderBy(asc(departments.name), asc(departments.id)),
    loadAgentCounts(),
  ]);

  return rows.map((row) =>
    serializeDepartment(row, agentCounts.get(row.id) ?? 0),
  );
}

/** Gets one Department by identifier. */
export async function getDepartment(id: string): Promise<Department | null> {
  const [department] = await db
    .select()
    .from(departments)
    .where(eq(departments.id, id));

  if (!department) {
    return null;
  }

  const agentCounts = await loadAgentCounts();

  return serializeDepartment(department, agentCounts.get(id) ?? 0);
}

/** Creates one generic reusable Department configuration. */
export async function createDepartment(
  input: CreateDepartment,
): Promise<Department> {
  try {
    const [department] = await db
      .insert(departments)
      .values(input)
      .returning();

    return serializeDepartment(department, 0);
  } catch (error) {
    return translateDatabaseError(error);
  }
}

/** Updates a Department without affecting existing Agent runtime behavior. */
export async function updateDepartment(
  id: string,
  input: UpdateDepartment,
): Promise<Department | null> {
  try {
    const [department] = await db
      .update(departments)
      .set({
        ...input,
        updatedAt: new Date(),
      })
      .where(eq(departments.id, id))
      .returning();

    if (!department) {
      return null;
    }

    const agentCounts = await loadAgentCounts();

    return serializeDepartment(department, agentCounts.get(id) ?? 0);
  } catch (error) {
    return translateDatabaseError(error);
  }
}

/**
 * Deletes a Department when no Agent references it. The `agents.department_id`
 * foreign key uses ON DELETE RESTRICT, so a referencing Agent surfaces as a
 * 23503 error translated into a stable 409 conflict.
 */
export async function deleteDepartment(id: string): Promise<boolean> {
  try {
    const [deleted] = await db
      .delete(departments)
      .where(eq(departments.id, id))
      .returning({ id: departments.id });

    return Boolean(deleted);
  } catch (error) {
    return translateDatabaseError(error);
  }
}
