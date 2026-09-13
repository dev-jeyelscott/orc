import { z } from "zod";

import {
  knowledgeAvailabilityStatusSchema,
  knowledgePathSchema,
  MAX_KNOWLEDGE_TITLE_CHARS,
} from "./knowledge.js";

/**
 * Knowledge Category slug/name/description/vault-root fields shared by create and
 * update requests. `vaultRootPath` reuses the existing bounded vault-relative path
 * schema so a category root can never traverse outside the configured vault.
 */
const knowledgeCategoryFieldsSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase kebab-case"),
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000).default(""),
  vaultRootPath: knowledgePathSchema,
  enabled: z.boolean().default(true),
  specialistAgentId: z.string().uuid().nullable().optional(),
  ingestionSkillId: z.string().uuid().nullable().optional(),
});

export const createKnowledgeCategorySchema = knowledgeCategoryFieldsSchema;

export const updateKnowledgeCategorySchema =
  knowledgeCategoryFieldsSchema.partial();

export const knowledgeCategorySchema = knowledgeCategoryFieldsSchema.extend({
  id: z.string().uuid(),
  specialistAgentId: z.string().uuid().nullable(),
  ingestionSkillId: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const knowledgeCategoryListResponseSchema = z.object({
  categories: z.array(knowledgeCategorySchema),
});

/** One Markdown file discovered under a Knowledge Category's managed vault directory. */
export const knowledgeCategoryFileSchema = z
  .object({
    path: knowledgePathSchema,
    name: z.string().trim().min(1).max(MAX_KNOWLEDGE_TITLE_CHARS),
  })
  .strict();

export const knowledgeCategoryFileListResponseSchema = z
  .object({
    status: knowledgeAvailabilityStatusSchema,
    files: z.array(knowledgeCategoryFileSchema),
    message: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

export const knowledgeCategoryFileContentResponseSchema = z
  .object({
    status: knowledgeAvailabilityStatusSchema,
    path: knowledgePathSchema.optional(),
    name: z.string().trim().min(1).max(MAX_KNOWLEDGE_TITLE_CHARS).optional(),
    content: z.string().optional(),
    message: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

export type CreateKnowledgeCategory = z.infer<
  typeof createKnowledgeCategorySchema
>;

export type UpdateKnowledgeCategory = z.infer<
  typeof updateKnowledgeCategorySchema
>;

export type KnowledgeCategory = z.infer<typeof knowledgeCategorySchema>;

export type KnowledgeCategoryFile = z.infer<
  typeof knowledgeCategoryFileSchema
>;

export type KnowledgeCategoryFileListResponse = z.infer<
  typeof knowledgeCategoryFileListResponseSchema
>;

export type KnowledgeCategoryFileContentResponse = z.infer<
  typeof knowledgeCategoryFileContentResponseSchema
>;
