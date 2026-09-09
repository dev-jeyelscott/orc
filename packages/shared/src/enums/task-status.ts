import { z } from "zod";

export const taskStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
  "blocked",
  "cancelled",
  "skipped",
]);

export type TaskStatus = z.infer<typeof taskStatusSchema>;
