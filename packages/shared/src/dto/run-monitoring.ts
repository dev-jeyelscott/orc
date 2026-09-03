import { z } from "zod";

import { harnessSchema } from "../enums/harness.js";
import { agentExecutionSchema } from "./agent-execution.js";
import { domainEventSchema } from "./event.js";
import { runSchema } from "./run.js";
import { taskSchema } from "./task.js";

/**
 * Defines the safe public projection of one agent stored in a run-owned workflow snapshot.
 */
export const workflowPlanAgentSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  role: z.string(),
  layer: z.number().int(),
  executionOrder: z.number().int(),
  harness: harnessSchema,
  model: z.string(),
  reasoning: z.string(),
});

/**
 * Defines one run summary used by the Runs monitoring navigator.
 */
export const runMonitoringSummarySchema = runSchema.extend({
  taskTitle: z.string().nullable(),
  plannedExecutionCount: z.number().int().nonnegative(),
  currentAgent: workflowPlanAgentSchema.nullable(),
});

/**
 * Defines the Runs monitoring list response.
 */
export const runMonitoringListResponseSchema = z.object({
  runs: z.array(runMonitoringSummarySchema),
});

/**
 * Defines the selected run monitoring response.
 */
export const runMonitoringDetailSchema = z.object({
  run: runSchema,
  task: taskSchema.nullable(),
  executions: z.array(agentExecutionSchema),
  events: z.array(domainEventSchema),
  executionPlan: z.array(workflowPlanAgentSchema),
});

export type WorkflowPlanAgent = z.infer<
  typeof workflowPlanAgentSchema
>;

export type RunMonitoringSummary = z.infer<
  typeof runMonitoringSummarySchema
>;

export type RunMonitoringListResponse = z.infer<
  typeof runMonitoringListResponseSchema
>;

export type RunMonitoringDetail = z.infer<
  typeof runMonitoringDetailSchema
>;
