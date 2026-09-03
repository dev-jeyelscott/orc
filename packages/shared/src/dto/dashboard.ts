import { z } from "zod";

import { agentExecutionStatusSchema } from "../enums/agent-execution-status.js";
import { harnessSchema } from "../enums/harness.js";
import { runStatusSchema } from "../enums/run-status.js";
import { domainEventSchema } from "./event.js";
import { healthResponseSchema } from "./health.js";

export const dashboardStatusCountsSchema = z.object({
  pending: z.number().int().nonnegative(),
  running: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  blocked: z.number().int().nonnegative(),
  cancelled: z.number().int().nonnegative(),
});

export const dashboardContextUsageSchema = z.object({
  used: z.number().nonnegative(),
  limit: z.number().positive(),
  percent: z.number().min(0).max(100),
});

export const dashboardExecutionSummarySchema = z.object({
  id: z.string().uuid(),
  agentName: z.string(),
  agentRole: z.string(),
  layer: z.number().int(),
  executionOrder: z.number().int(),
  harness: harnessSchema,
  model: z.string(),
  reasoning: z.string(),
  status: agentExecutionStatusSchema,
  pid: z.number().int().nullable(),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  tokenTotal: z.number().nonnegative().nullable(),
  contextUsage: dashboardContextUsageSchema.nullable(),
});

export const dashboardActivitySchema = z.object({
  kind: z.enum(["active", "recent"]),
  runId: z.string().uuid(),
  taskId: z.string().uuid().nullable(),
  taskTitle: z.string().nullable(),
  projectPath: z.string(),
  runStatus: runStatusSchema,
  executionCount: z.number().int().nonnegative(),
  terminalReason: z.string().nullable(),
  runCreatedAt: z.string().datetime(),
  runUpdatedAt: z.string().datetime(),
  execution: dashboardExecutionSummarySchema.nullable(),
  latestCommitHash: z.string().nullable(),
});

export const dashboardProjectSummarySchema = z.object({
  discovered: z.number().int().nonnegative(),
  clean: z.number().int().nonnegative(),
  dirty: z.number().int().nonnegative(),
  unknown: z.number().int().nonnegative(),
  workspaceRoot: z.string(),
  error: z.string().nullable(),
});

export const dashboardProjectActivitySchema = z.object({
  projectPath: z.string(),
  projectName: z.string(),
  runCount: z.number().int().nonnegative(),
});

export const dashboardAgentSummarySchema = z.object({
  configured: z.number().int().nonnegative(),
  enabled: z.number().int().nonnegative(),
});

export const dashboardSummarySchema = z.object({
  health: healthResponseSchema,
  databaseError: z.string().nullable(),
  agents: dashboardAgentSummarySchema.nullable(),
  tasks: dashboardStatusCountsSchema.nullable(),
  runs: dashboardStatusCountsSchema.nullable(),
  projects: dashboardProjectSummarySchema,
  activity: dashboardActivitySchema.nullable(),
  recentEvents: z.array(domainEventSchema),
  projectActivity: z.array(dashboardProjectActivitySchema),
  generatedAt: z.string().datetime(),
});

export type DashboardStatusCounts = z.infer<
  typeof dashboardStatusCountsSchema
>;
export type DashboardContextUsage = z.infer<
  typeof dashboardContextUsageSchema
>;
export type DashboardExecutionSummary = z.infer<
  typeof dashboardExecutionSummarySchema
>;
export type DashboardActivity = z.infer<typeof dashboardActivitySchema>;
export type DashboardProjectSummary = z.infer<
  typeof dashboardProjectSummarySchema
>;
export type DashboardProjectActivity = z.infer<
  typeof dashboardProjectActivitySchema
>;
export type DashboardAgentSummary = z.infer<
  typeof dashboardAgentSummarySchema
>;
export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;
