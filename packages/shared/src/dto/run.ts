import { z } from "zod";

import { runStatusSchema } from "../enums/run-status.js";

const runFieldsSchema = z.object({
  projectPath: z.string().trim().min(1),
});

export const createRunSchema = runFieldsSchema;
export const runSchema = runFieldsSchema.extend({
  id: z.string().uuid(),
  taskId: z.string().uuid().nullable(),
  status: runStatusSchema,
  currentAgentId: z.string().uuid().nullable(),
  executionCount: z.number().int().nonnegative(),
  terminalReason: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type CreateRun = z.infer<typeof createRunSchema>;
export type Run = z.infer<typeof runSchema>;
