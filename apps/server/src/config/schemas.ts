import { z } from "zod";

import { harnessSchema } from "@orc/shared";
import { agentRouteOutcomeSchema, terminalActionSchema } from "@orc/shared";
import { sandboxModeSchema } from "@orc/shared";

/**
 * Server-owned canonical `.orc/` file schemas (roadmap Vertical Spec 1,
 * section 10.3). These are deliberately separate from `packages/shared`'s
 * runtime/API DTOs: canonical files use slugs/symbolic keys, allow explicit
 * `null` inheritance, and never carry DB UUIDs or provider-specific fields.
 */

const kebabSlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase kebab-case");

export const configVersionSchema = z.literal(1);

export const orcRootConfigSchema = z.object({
  version: configVersionSchema,
  workspaceRoot: z.string().trim().min(1).max(4_096).default("../workspace"),
});

export type OrcRootConfig = z.infer<typeof orcRootConfigSchema>;

const runtimeFieldsSchema = z.object({
  harness: harnessSchema,
  model: z.string().trim().min(1).max(160),
  reasoning: z.string().trim().min(1).max(160),
});

const permissionsFieldsSchema = z.object({
  write: z.boolean(),
  commands: z.boolean(),
  sandboxMode: sandboxModeSchema.nullable(),
  commit: z.boolean(),
});

export const departmentConfigSchema = z.object({
  version: configVersionSchema,
  slug: kebabSlugSchema,
  name: z.string().trim().min(1).max(160),
  role: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2_000).default(""),
  enabled: z.boolean().default(true),
  runtime: runtimeFieldsSchema,
  permissions: permissionsFieldsSchema,
});

export type DepartmentConfig = z.infer<typeof departmentConfigSchema>;

/** `null` means inherit the owning Department's value. */
const overridableRuntimeFieldsSchema = z.object({
  harness: harnessSchema.nullable(),
  model: z.string().trim().min(1).max(160).nullable(),
  reasoning: z.string().trim().min(1).max(160).nullable(),
});

const overridablePermissionsFieldsSchema = z.object({
  write: z.boolean().nullable(),
  commands: z.boolean().nullable(),
  sandboxMode: sandboxModeSchema.nullable(),
  commit: z.boolean().nullable(),
});

export const agentConfigSchema = z.object({
  version: configVersionSchema,
  slug: kebabSlugSchema,
  name: z.string().trim().min(1).max(160),
  department: kebabSlugSchema,
  enabled: z.boolean().default(true),
  runtime: overridableRuntimeFieldsSchema,
  permissions: overridablePermissionsFieldsSchema,
  skills: z.array(kebabSlugSchema).max(500).default([]),
});

export type AgentConfig = z.infer<typeof agentConfigSchema>;

export const skillConfigSchema = z.object({
  version: configVersionSchema,
  slug: kebabSlugSchema,
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2_000).default(""),
  enabled: z.boolean().default(true),
  tags: z.array(z.string().trim().min(1).max(60)).max(50).default([]),
  domains: z.array(z.string().trim().min(1).max(60)).max(50).default([]),
});

export type SkillConfig = z.infer<typeof skillConfigSchema>;

export const teamConfigSchema = z.object({
  version: configVersionSchema,
  slug: kebabSlugSchema,
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2_000).default(""),
  enabled: z.boolean().default(true),
  members: z.array(kebabSlugSchema).max(200).default([]),
});

export type TeamConfig = z.infer<typeof teamConfigSchema>;

const MAX_WORKFLOW_NODES = 100;
const MAX_WORKFLOW_EDGES = 500;
const MAX_COORDINATE = 100_000;

const workflowPositionSchema = z.object({
  x: z.number().int().min(-MAX_COORDINATE).max(MAX_COORDINATE),
  y: z.number().int().min(-MAX_COORDINATE).max(MAX_COORDINATE),
});

const workflowStartNodeConfigSchema = z.object({
  key: z.string().trim().min(1).max(200),
  kind: z.literal("start"),
  position: workflowPositionSchema,
});

const workflowAgentNodeConfigSchema = z.object({
  key: z.string().trim().min(1).max(200),
  kind: z.literal("agent"),
  agent: kebabSlugSchema,
  position: workflowPositionSchema,
});

const workflowTerminalNodeConfigSchema = z.object({
  key: z.string().trim().min(1).max(200),
  kind: z.literal("terminal"),
  action: terminalActionSchema,
  position: workflowPositionSchema,
});

export const workflowNodeConfigSchema = z.discriminatedUnion("kind", [
  workflowStartNodeConfigSchema,
  workflowAgentNodeConfigSchema,
  workflowTerminalNodeConfigSchema,
]);

export type WorkflowNodeConfig = z.infer<typeof workflowNodeConfigSchema>;

export const workflowEdgeConfigSchema = z.object({
  source: z.string().trim().min(1).max(200),
  target: z.string().trim().min(1).max(200),
  outcome: agentRouteOutcomeSchema.optional(),
});

export type WorkflowEdgeConfig = z.infer<typeof workflowEdgeConfigSchema>;

export const workflowGraphConfigSchema = z.object({
  nodes: z.array(workflowNodeConfigSchema).max(MAX_WORKFLOW_NODES).default([]),
  edges: z.array(workflowEdgeConfigSchema).max(MAX_WORKFLOW_EDGES).default([]),
});

export type WorkflowGraphConfig = z.infer<typeof workflowGraphConfigSchema>;

export const workflowConfigSchema = z.object({
  version: configVersionSchema,
  published: z
    .object({
      version: z.number().int().min(1),
      graph: workflowGraphConfigSchema,
    })
    .nullable()
    .default(null),
  draft: workflowGraphConfigSchema.default({ nodes: [], edges: [] }),
});

export type WorkflowConfig = z.infer<typeof workflowConfigSchema>;

export const projectConfigSchema = z.object({
  version: configVersionSchema,
  slug: kebabSlugSchema,
  path: z.string().trim().min(1).max(4_096),
  // `team` is accepted only for existing canonical files and is normalized as
  // a Resolution assignment by the loader/projection path.
  team: kebabSlugSchema.optional(),
  resolutionTeam: kebabSlugSchema.nullable().optional(),
  developmentTeam: kebabSlugSchema.nullable().optional(),
  automation: z
    .object({
      notionDataSourceId: z.string().trim().min(1).max(255).nullable().default(null),
      autoModeEnabled: z.boolean().default(false),
      autoModeTeam: kebabSlugSchema.nullable().default(null),
    })
    .default({ notionDataSourceId: null, autoModeEnabled: false }),
}).superRefine((value, context) => {
  const resolutionTeam = value.resolutionTeam ?? value.team ?? null;
  if (!resolutionTeam && !value.developmentTeam) context.addIssue({ code: z.ZodIssueCode.custom, message: "Project requires a Resolution or Development Team" });
  if (resolutionTeam && resolutionTeam === value.developmentTeam) context.addIssue({ code: z.ZodIssueCode.custom, message: "Project Resolution and Development Teams must differ" });
  if (value.automation.autoModeEnabled && !value.automation.autoModeTeam && !value.team) context.addIssue({ code: z.ZodIssueCode.custom, message: "Auto Mode requires an assigned Auto Mode Team" });
  if (value.automation.autoModeTeam && value.automation.autoModeTeam !== resolutionTeam && value.automation.autoModeTeam !== value.developmentTeam) context.addIssue({ code: z.ZodIssueCode.custom, message: "Auto Mode Team must be assigned to the Project" });
});

export type ProjectConfig = z.infer<typeof projectConfigSchema>;
