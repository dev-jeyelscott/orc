import { z } from "zod";

export const runStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
  "blocked",
  "cancelled",
  "skipped",
]);

export type RunStatus = z.infer<typeof runStatusSchema>;
