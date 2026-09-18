import { z } from "zod";

/**
 * Read-only Git-backed configuration status contract (roadmap Vertical
 * Spec 1, section 10.7). `out_of_sync` is reported starting with Vertical
 * Spec 2, when a canonical file write succeeds but its PostgreSQL
 * projection sync fails. `syncing` is reserved for the global startup/
 * explicit sync slice (Vertical Spec 7).
 */
export const configurationStatusStateSchema = z.enum(["valid", "invalid", "out_of_sync", "syncing"]);

export const configurationIssueSchema = z.object({
  filePath: z.string(),
  resourceType: z.string(),
  resourceId: z.string().nullable(),
  field: z.string().nullable(),
  message: z.string(),
});

export const configurationStatusResponseSchema = z.object({
  state: configurationStatusStateSchema,
  configRoot: z.string(),
  departmentCount: z.number().int().min(0),
  agentCount: z.number().int().min(0),
  skillCount: z.number().int().min(0),
  teamCount: z.number().int().min(0),
  projectCount: z.number().int().min(0),
  errorCount: z.number().int().min(0),
  errors: z.array(configurationIssueSchema),
});

export type ConfigurationStatusState = z.infer<typeof configurationStatusStateSchema>;
export type ConfigurationIssue = z.infer<typeof configurationIssueSchema>;
export type ConfigurationStatusResponse = z.infer<typeof configurationStatusResponseSchema>;
