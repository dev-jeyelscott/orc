import { z } from "zod";

export const runStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
  "blocked",
  "cancelled",
]);

export type RunStatus = z.infer<typeof runStatusSchema>;
