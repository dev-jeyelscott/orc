import { z } from "zod";

/** Defines the Codex CLI sandbox modes available to configured workers. */
export const sandboxModeSchema = z.enum([
  "read-only",
  "workspace-write",
  "danger-full-access",
]);

export type SandboxMode = z.infer<typeof sandboxModeSchema>;
