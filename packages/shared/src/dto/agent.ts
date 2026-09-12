import {
  z,
} from "zod";

import {
  harnessSchema,
} from "../enums/harness.js";
import {
  sandboxModeSchema,
} from "../enums/sandbox-mode.js";
import {
  agentRouteOutcomeSchema,
  terminalActionSchema,
} from "../enums/agent-route.js";
import {
  departmentSchema,
} from "./department.js";

const overridableTextSchema =
  z.string()
    .trim()
    .min(1)
    .max(160)
    .nullable()
    .optional();

const agentFieldsSchema =
  z.object({
    departmentId:
      z.string().uuid(),
    /**
     * Team/layer/order remain the authoritative workflow-topology fields
     * until the Team Composition and Layered Workflow slice replaces them
     * with `team_members`. Department inheritance does not change topology.
     */
    teamId:
      z.string().uuid(),
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
    layer:
      z.number()
        .int()
        .min(1),
    executionOrder:
      z.number()
        .int()
        .min(1),
    enabled:
      z.boolean()
        .default(true),
    modelOverride:
      overridableTextSchema,
    reasoningOverride:
      overridableTextSchema,
    additionalPrompt:
      z.string()
        .trim()
        .max(4000)
        .default(""),
  });

export const createAgentSchema =
  agentFieldsSchema;

export const updateAgentSchema =
  agentFieldsSchema.partial();

const effectiveAgentConfigSchema =
  z.object({
    role:
      z.string(),
    harness:
      harnessSchema,
    model:
      z.string(),
    reasoning:
      z.string(),
    systemPrompt:
      z.string(),
    canWrite:
      z.boolean(),
    canRunCommands:
      z.boolean(),
    sandboxMode:
      sandboxModeSchema
        .nullable()
        .optional(),
    canCommit:
      z.boolean(),
    enabled:
      z.boolean(),
  });

export const agentSchema =
  agentFieldsSchema.extend({
    id:
      z.string().uuid(),
    department:
      departmentSchema,
    effective:
      effectiveAgentConfigSchema,
    hasModelOverride:
      z.boolean(),
    hasReasoningOverride:
      z.boolean(),
    createdAt:
      z.string().datetime(),
    updatedAt:
      z.string().datetime(),
  });

const routeTargetFieldsSchema =
  z.object({
    targetAgentId:
      z.string()
        .uuid()
        .nullable(),
    terminalAction:
      terminalActionSchema
        .nullable(),
  });

const agentRouteFieldsSchema =
  routeTargetFieldsSchema.extend({
    outcome:
      agentRouteOutcomeSchema,
    enabled:
      z.boolean()
        .default(true),
  });

export const createAgentRouteSchema =
  agentRouteFieldsSchema.superRefine(
    (
      value,
      context,
    ) => {
      if (
        (
          value.targetAgentId ===
          null
        ) ===
        (
          value.terminalAction ===
          null
        )
      ) {
        context.addIssue({
          code:
            z.ZodIssueCode.custom,
          message:
            "Set exactly one target agent or terminal action",
        });
      }
    },
  );

export const updateAgentRouteSchema =
  routeTargetFieldsSchema
    .partial()
    .extend({
      outcome:
        agentRouteOutcomeSchema.optional(),
      enabled:
        z.boolean().optional(),
    });

export const agentRouteSchema =
  agentRouteFieldsSchema.extend({
    id:
      z.string().uuid(),
    sourceAgentId:
      z.string().uuid(),
    createdAt:
      z.string().datetime(),
    updatedAt:
      z.string().datetime(),
  });

export const agentWithRoutesSchema =
  agentSchema.extend({
    routes:
      z.array(
        agentRouteSchema,
      ),
  });

export const agentListResponseSchema =
  z.object({
    agents:
      z.array(
        agentSchema,
      ),
  });

export type Agent =
  z.infer<
    typeof agentSchema
  >;

export type EffectiveAgentConfig =
  z.infer<
    typeof effectiveAgentConfigSchema
  >;

export type AgentRoute =
  z.infer<
    typeof agentRouteSchema
  >;

export type AgentWithRoutes =
  z.infer<
    typeof agentWithRoutesSchema
  >;

export type CreateAgent =
  z.infer<
    typeof createAgentSchema
  >;

export type UpdateAgent =
  z.infer<
    typeof updateAgentSchema
  >;

export type CreateAgentRoute =
  z.infer<
    typeof createAgentRouteSchema
  >;

export type UpdateAgentRoute =
  z.infer<
    typeof updateAgentRouteSchema
  >;
