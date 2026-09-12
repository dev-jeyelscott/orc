import {
  z,
} from "zod";

import {
  harnessSchema,
} from "../enums/harness.js";
import {
  sandboxModeSchema,
} from "../enums/sandbox-mode.js";

const departmentFieldsSchema =
  z.object({
    slug:
      z.string()
        .trim()
        .min(1)
        .max(100)
        .regex(
          /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
          "Slug must be lowercase kebab-case",
        ),
    name:
      z.string()
        .trim()
        .min(1)
        .max(160),
    role:
      z.string()
        .trim()
        .min(1)
        .max(160),
    description:
      z.string()
        .trim()
        .max(2000)
        .default(""),
    enabled:
      z.boolean()
        .default(true),
    harness:
      harnessSchema,
    defaultModel:
      z.string()
        .trim()
        .min(1)
        .max(160),
    defaultReasoning:
      z.string()
        .trim()
        .min(1)
        .max(160),
    systemPrompt:
      z.string()
        .trim()
        .min(1),
    canWrite:
      z.boolean()
        .default(false),
    canRunCommands:
      z.boolean()
        .default(false),
    sandboxMode:
      sandboxModeSchema
        .nullable()
        .optional(),
    canCommit:
      z.boolean()
        .default(false),
  });

export const createDepartmentSchema =
  departmentFieldsSchema;

export const updateDepartmentSchema =
  departmentFieldsSchema.partial();

export const departmentSchema =
  departmentFieldsSchema.extend({
    id:
      z.string().uuid(),
    createdAt:
      z.string().datetime(),
    updatedAt:
      z.string().datetime(),
    agentCount:
      z.number()
        .int()
        .min(0)
        .default(0),
  });

export const departmentListResponseSchema =
  z.object({
    departments:
      z.array(departmentSchema),
  });

export type Department =
  z.infer<typeof departmentSchema>;

export type CreateDepartment =
  z.input<typeof createDepartmentSchema>;

export type UpdateDepartment =
  z.infer<typeof updateDepartmentSchema>;
