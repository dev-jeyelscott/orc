import { z } from "zod";

/** A reusable, data-driven capability that may be assigned to any Agent. */
const skillFieldsSchema = z.object({
  slug: z.string().trim().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase kebab-case"),
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2_000).default(""),
  enabled: z.boolean().default(true),
  tags: z.array(z.string().trim().min(1).max(60)).max(50).default([]),
  domains: z.array(z.string().trim().min(1).max(60)).max(50).default([]),
});

export const createSkillSchema = skillFieldsSchema;
export const updateSkillSchema = skillFieldsSchema.partial();
export const skillSchema = skillFieldsSchema.extend({
  id: z.string().uuid(),
  /** True only when the canonical `SKILL.md` has loadable runtime instructions. */
  hasInstructions: z.boolean(),
  /**
   * The canonical `.orc/skills/<slug>/skill.yaml` content hash at read time.
   * Update/delete requests echo this back as `expectedRevision`.
   */
  configRevision: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export const skillListResponseSchema = z.object({ skills: z.array(skillSchema) });

export type Skill = z.infer<typeof skillSchema>;
export type CreateSkill = z.infer<typeof createSkillSchema>;
export type UpdateSkill = z.infer<typeof updateSkillSchema>;
