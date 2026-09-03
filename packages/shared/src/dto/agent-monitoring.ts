import { z } from "zod";

import { agentWithRoutesSchema } from "./agent.js";
import { agentExecutionSchema } from "./agent-execution.js";
import { domainEventSchema } from "./event.js";

export const agentMonitoringRangeSchema = z.enum([
  "24h",
  "7d",
  "30d",
]);

export const agentValidationIssueSchema = z.object({
  code: z.literal(
    "enabled_route_targets_disabled_agent",
  ),
  severity: z.literal("warning"),
  sourceAgentId: z.string().uuid(),
  routeId: z.string().uuid(),
  targetAgentId: z.string().uuid(),
  message: z.string(),
});

export const agentMonitoringOverviewSchema = z.object({
  range: agentMonitoringRangeSchema,
  agents: z.array(agentWithRoutesSchema),
  metrics: z.object({
    totalAgents: z.number().int().nonnegative(),
    enabledAgents: z.number().int().nonnegative(),
    layers: z.number().int().nonnegative(),
    activeExecutions: z.number().int().nonnegative(),
    activeRuns: z.number().int().nonnegative(),
    enabledRouteRules: z.number().int().nonnegative(),
    approvedResults: z.number().int().nonnegative(),
    changesRequestedResults: z.number().int().nonnegative(),
  }),
  validationIssues: z.array(
    agentValidationIssueSchema,
  ),
  recentEvents: z.array(domainEventSchema),
});

export const agentRecentExecutionSchema =
  agentExecutionSchema.pick({
    id: true,
    runId: true,
    status: true,
    resultStatus: true,
    startedAt: true,
    completedAt: true,
    exitCode: true,
    commitHash: true,
    createdAt: true,
    updatedAt: true,
  });

export const agentActivityBucketSchema = z.object({
  index: z.number().int().nonnegative(),
  count: z.number().int().nonnegative(),
});

export const agentTokenBucketSchema = z.object({
  index: z.number().int().nonnegative(),
  averageTokens: z.number().nonnegative().nullable(),
});

export const agentObservabilitySchema = z.object({
  agentId: z.string().uuid(),
  range: agentMonitoringRangeSchema,
  totalExecutions: z.number().int().nonnegative(),
  activeExecutionCount: z.number().int().nonnegative(),
  successfulResults: z.number().int().nonnegative(),
  resultCount: z.number().int().nonnegative(),
  approvedResults: z.number().int().nonnegative(),
  changesRequestedResults: z.number().int().nonnegative(),
  averageDurationMs: z.number().nonnegative().nullable(),
  averageTokens: z.number().nonnegative().nullable(),
  tokenTelemetryExecutions: z.number().int().nonnegative(),
  contextUsagePercent: z.number().min(0).max(100).nullable(),
  contextTelemetryExecutions: z.number().int().nonnegative(),
  latestExitCode: z.number().int().nullable(),
  lastActiveRunId: z.string().uuid().nullable(),
  lastCommitHash: z.string().nullable(),
  activeExecution: agentRecentExecutionSchema.nullable(),
  recentExecutions: z.array(agentRecentExecutionSchema),
  activityBuckets: z.array(agentActivityBucketSchema),
  tokenBuckets: z.array(agentTokenBucketSchema),
  recentEvents: z.array(domainEventSchema),
});

export type AgentMonitoringRange =
  z.infer<typeof agentMonitoringRangeSchema>;

export type AgentValidationIssue =
  z.infer<typeof agentValidationIssueSchema>;

export type AgentMonitoringOverview =
  z.infer<typeof agentMonitoringOverviewSchema>;

export type AgentRecentExecution =
  z.infer<typeof agentRecentExecutionSchema>;

export type AgentActivityBucket =
  z.infer<typeof agentActivityBucketSchema>;

export type AgentTokenBucket =
  z.infer<typeof agentTokenBucketSchema>;

export type AgentObservability =
  z.infer<typeof agentObservabilitySchema>;
