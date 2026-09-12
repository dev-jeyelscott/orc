import {
  asc,
  eq,
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
): Department {
  return {
    ...row,
    agentCount: 0,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
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

    if (code === "23503") {
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
  return (await db
    .select()
    .from(departments)
    .orderBy(asc(departments.name), asc(departments.id)))
    .map(serializeDepartment);
}

/** Gets one Department by identifier. */
export async function getDepartment(id: string): Promise<Department | null> {
  const [department] = await db
    .select()
    .from(departments)
    .where(eq(departments.id, id));

  return department ? serializeDepartment(department) : null;
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

    return serializeDepartment(department);
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

    return department ? serializeDepartment(department) : null;
  } catch (error) {
    return translateDatabaseError(error);
  }
}

/**
 * Deletes a Department when no Agent reference exists. The current schema has
 * no Agent relation yet; the foreign-key error mapping keeps this stable once
 * inheritance introduces that relation.
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
