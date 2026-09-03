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

export const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  branch: z.string().nullable(),
  gitState: gitStateSchema,
  primaryFiles: z.array(z.string()),
  packageManager: packageManagerSchema,
  stack: z.string().nullable(),
});

export type Project = z.infer<typeof projectSchema>;

export const projectListResponseSchema = z.object({
  projects: z.array(projectSchema),
  workspaceRoot: z.string(),
  error: z.string().nullable(),
});

export type ProjectListResponse = z.infer<typeof projectListResponseSchema>;
