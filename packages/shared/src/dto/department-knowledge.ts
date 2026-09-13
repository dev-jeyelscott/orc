import { z } from "zod";

/**
 * One Knowledge Category a Department has declared as primary. Recommendation/discovery
 * metadata only — never an authorization boundary and never a retrieval restriction.
 */
export const departmentKnowledgeCategorySchema = z
  .object({
    knowledgeCategoryId: z.string().uuid(),
    slug: z.string(),
    name: z.string(),
    enabled: z.boolean(),
    isPrimary: z.boolean(),
  })
  .strict();

export const departmentKnowledgeResponseSchema = z.object({
  knowledge: z.array(departmentKnowledgeCategorySchema),
});

/** Replaces the full set of primary Knowledge Categories declared by one Department. */
export const putDepartmentKnowledgeSchema = z
  .object({
    knowledgeCategoryIds: z.array(z.string().uuid()).max(50).default([]),
  })
  .strict();

export type DepartmentKnowledgeCategory = z.infer<
  typeof departmentKnowledgeCategorySchema
>;

export type DepartmentKnowledgeResponse = z.infer<
  typeof departmentKnowledgeResponseSchema
>;

export type PutDepartmentKnowledge = z.infer<
  typeof putDepartmentKnowledgeSchema
>;
