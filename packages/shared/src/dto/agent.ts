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
  departmentSchema,
} from "./department.js";

const overridableTextSchema =
  z.string()
    .trim()
    .min(1)
    .max(160)
    .nullable()
    .optional();

/**
 * An Agent is a lightweight, Department-scoped worker instance. Team
 * placement (layer/order/routes) is owned exclusively by `team_members` and
 * is never part of Agent identity.
 */
const agentFieldsSchema =
  z.object({
    departmentId:
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
    /**
     * The Agent's current Team assignment resolved from `team_members`
     * (null when the Agent is not currently selected onto any Team).
     */
    currentTeamId:
      z.string()
        .uuid()
        .nullable(),
    createdAt:
      z.string().datetime(),
    updatedAt:
      z.string().datetime(),
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

export type CreateAgent =
  z.infer<
    typeof createAgentSchema
  >;

export type UpdateAgent =
  z.infer<
    typeof updateAgentSchema
  >;
