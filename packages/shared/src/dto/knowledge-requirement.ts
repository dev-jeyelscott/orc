import { z } from "zod";

import {
  MAX_KNOWLEDGE_QUERY_CHARS,
} from "./knowledge.js";

/** Bounded slug reference to a Knowledge Category, reused from the category slug shape. */
const knowledgeCategorySlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase kebab-case");

export const MAX_KNOWLEDGE_REQUIREMENTS = 5;

export const MAX_KNOWLEDGE_REQUIREMENT_REASON_CHARS = 500;

/**
 * One explicit knowledge declaration emitted by an upstream agent (typically an
 * architect/planning agent) in its structured handoff. The contract is generic: any
 * configured agent capable of emitting it may use it, and no role name is encoded here.
 */
export const knowledgeRequirementSchema = z
  .object({
    categorySlug: knowledgeCategorySlugSchema,
    query: z.string().trim().min(1).max(MAX_KNOWLEDGE_QUERY_CHARS),
    reason: z.string().trim().min(1).max(MAX_KNOWLEDGE_REQUIREMENT_REASON_CHARS),
    required: z.boolean().default(true),
  })
  .strict();

export const knowledgeRequirementCollectionSchema = z
  .array(knowledgeRequirementSchema)
  .max(MAX_KNOWLEDGE_REQUIREMENTS);

export type KnowledgeRequirement = z.infer<typeof knowledgeRequirementSchema>;

export type KnowledgeRequirementCollection = z.infer<
  typeof knowledgeRequirementCollectionSchema
>;
