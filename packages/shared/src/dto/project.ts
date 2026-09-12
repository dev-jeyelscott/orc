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
  teamId: z.string().uuid(),
  teamName: z.string().min(1),
  notionDataSourceId: z.string().min(1).nullable(),
  autoModeEnabled: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const upsertProjectTeamAssignmentSchema = z.object({
  teamId: z.string().uuid(),
  notionDataSourceId: z.string().trim().min(1).max(255).nullable().default(null),
  autoModeEnabled: z.boolean().default(false),
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
