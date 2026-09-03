import { z } from "zod";

import { taskStatusSchema } from "../enums/task-status.js";
import { harnessSchema } from "../enums/harness.js";
import { runSchema } from "./run.js";
import { agentExecutionSchema } from "./agent-execution.js";
import { domainEventSchema } from "./event.js";

export const createTaskSchema = z.object({
  projectId: z.string().trim().min(1),
  title: z.string().trim().min(1).max(200),
  instruction: z.string().trim().min(1).max(20_000),
});

export const taskSchema = z.object({
  id: z.string().uuid(),
  projectPath: z.string(),
  title: z.string(),
  instruction: z.string(),
  status: taskStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const retryRunSchema = z.object({
  harness: harnessSchema.optional(),
  model: z.string().trim().min(1).max(160).optional(),
  reasoning: z.string().trim().min(1).max(160).optional(),
});

export const taskWithRunSchema = z.object({ task: taskSchema, run: runSchema });
export const taskListResponseSchema = z.object({ tasks: z.array(taskSchema) });
export const runListResponseSchema = z.object({ runs: z.array(runSchema) });
export const runDetailSchema = z.object({ run: runSchema, task: taskSchema.nullable(), executions: z.array(agentExecutionSchema), events: z.array(domainEventSchema).default([]) });

export type CreateTask = z.infer<typeof createTaskSchema>;
export type RetryRun = z.infer<typeof retryRunSchema>;
export type Task = z.infer<typeof taskSchema>;
export type TaskWithRun = z.infer<typeof taskWithRunSchema>;
export type TaskListResponse = z.infer<typeof taskListResponseSchema>;
export type RunListResponse = z.infer<typeof runListResponseSchema>;
export type RunDetail = z.infer<typeof runDetailSchema>;
