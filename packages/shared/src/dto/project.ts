import { z } from "zod";

export const gitStateSchema = z.enum(["clean", "dirty", "unknown"]);

export type GitState = z.infer<typeof gitStateSchema>;

export const packageManagerSchema = z.enum([
  "pnpm",
  "yarn",
  "npm",
  "composer",
  "pip",
  "go",
  "cargo",
  "unknown",
]);

export type PackageManager = z.infer<typeof packageManagerSchema>;

export const projectTeamAssignmentSchema = z.object({
  projectPath: z.string(),
  resolutionTeamId: z.string().uuid().nullable(),
  resolutionTeamName: z.string().min(1).nullable(),
  developmentTeamId: z.string().uuid().nullable(),
  developmentTeamName: z.string().min(1).nullable(),
  notionDataSourceId: z.string().min(1).nullable(),
  autoModeEnabled: z.boolean(),
  autoModeTeamId: z.string().uuid().nullable(),
  autoModeTeamName: z.string().min(1).nullable(),
  /** @deprecated compatibility alias; new clients use the named team slots. */
  teamId: z.string().uuid(),
  /** @deprecated compatibility alias; new clients use the named team slots. */
  teamName: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const upsertProjectTeamAssignmentSchema = z.object({
  /** @deprecated accepted as a Resolution Team while older clients migrate. */
  teamId: z.string().uuid().optional(),
  resolutionTeamId: z.string().uuid().nullable().default(null),
  developmentTeamId: z.string().uuid().nullable().default(null),
  notionDataSourceId: z.string().trim().min(1).max(255).nullable().default(null),
  autoModeEnabled: z.boolean().default(false),
  autoModeTeamId: z.string().uuid().nullable().default(null),
}).transform((value) => ({ ...value, resolutionTeamId: value.resolutionTeamId ?? value.teamId ?? null })).superRefine((value, context) => {
  if (!value.resolutionTeamId && !value.developmentTeamId) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Select a Resolution Team, a Development Team, or both" });
  }
  if (value.resolutionTeamId && value.resolutionTeamId === value.developmentTeamId) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Resolution and Development Teams must be different" });
  }
  if (value.autoModeEnabled && !value.autoModeTeamId) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Select an Auto Mode Team when Auto Mode is enabled" });
  }
  if (value.autoModeTeamId && value.autoModeTeamId !== value.resolutionTeamId && value.autoModeTeamId !== value.developmentTeamId) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Auto Mode Team must be one of the assigned Teams" });
  }
});

export type ProjectTeamAssignment = z.infer<typeof projectTeamAssignmentSchema>;
export type UpsertProjectTeamAssignment = z.input<typeof upsertProjectTeamAssignmentSchema>;

export const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  branch: z.string().nullable(),
  gitState: gitStateSchema,
  primaryFiles: z.array(z.string()),
  packageManager: packageManagerSchema,
  stack: z.string().nullable(),
  assignment: projectTeamAssignmentSchema.nullable().optional(),
});

export type Project = z.infer<typeof projectSchema>;

export const projectListResponseSchema = z.object({
  projects: z.array(projectSchema),
  workspaceRoot: z.string(),
  error: z.string().nullable(),
});

export type ProjectListResponse = z.infer<typeof projectListResponseSchema>;
