import { asc, eq, inArray } from "drizzle-orm";

import type { DepartmentKnowledgeCategory } from "@orc/shared";

import { db } from "../db/client.js";
import {
  departmentKnowledgeCategories,
  departments,
  knowledgeCategories,
} from "../db/schema.js";

export class DepartmentKnowledgeServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}

/**
 * Lists the Knowledge Categories a Department has declared as primary, ordered by
 * category name. Presence here is recommendation/discovery metadata only — it neither
 * restricts retrieval of other categories nor grants access to this one.
 */
export async function listDepartmentKnowledge(
  departmentId: string,
): Promise<DepartmentKnowledgeCategory[]> {
  const rows = await db
    .select({
      knowledgeCategoryId: departmentKnowledgeCategories.knowledgeCategoryId,
      isPrimary: departmentKnowledgeCategories.isPrimary,
      slug: knowledgeCategories.slug,
      name: knowledgeCategories.name,
      enabled: knowledgeCategories.enabled,
    })
    .from(departmentKnowledgeCategories)
    .innerJoin(
      knowledgeCategories,
      eq(departmentKnowledgeCategories.knowledgeCategoryId, knowledgeCategories.id),
    )
    .where(eq(departmentKnowledgeCategories.departmentId, departmentId))
    .orderBy(asc(knowledgeCategories.name), asc(knowledgeCategories.id));

  return rows;
}

/**
 * Replaces the full set of primary Knowledge Categories declared by one Department.
 * Every referenced category must currently exist; a disabled category may still be
 * declared (it remains visible as a recommendation, just labeled disabled by callers).
 */
export async function replaceDepartmentKnowledge(
  departmentId: string,
  knowledgeCategoryIds: string[],
): Promise<DepartmentKnowledgeCategory[]> {
  const [department] = await db
    .select({ id: departments.id })
    .from(departments)
    .where(eq(departments.id, departmentId));

  if (!department) {
    throw new DepartmentKnowledgeServiceError("Department not found", 404);
  }

  const uniqueCategoryIds = Array.from(new Set(knowledgeCategoryIds));

  if (uniqueCategoryIds.length > 0) {
    const existing = await db
      .select({ id: knowledgeCategories.id })
      .from(knowledgeCategories)
      .where(inArray(knowledgeCategories.id, uniqueCategoryIds));

    if (existing.length !== uniqueCategoryIds.length) {
      throw new DepartmentKnowledgeServiceError(
        "One or more Knowledge Categories do not exist",
        400,
      );
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(departmentKnowledgeCategories)
      .where(eq(departmentKnowledgeCategories.departmentId, departmentId));

    if (uniqueCategoryIds.length > 0) {
      await tx.insert(departmentKnowledgeCategories).values(
        uniqueCategoryIds.map((knowledgeCategoryId) => ({
          departmentId,
          knowledgeCategoryId,
          isPrimary: true,
        })),
      );
    }
  });

  return listDepartmentKnowledge(departmentId);
}
