import { z } from "zod";

export const taskStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
  "blocked",
  "cancelled",
]);

export type TaskStatus = z.infer<typeof taskStatusSchema>;
