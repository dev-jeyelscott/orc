import { z } from "zod";

export const agentExecutionStatusSchema = z.enum([
  "pending",
  "starting",
  "running",
  "completed",
  "failed",
  "blocked",
  "cancelled",
]);

export type AgentExecutionStatus = z.infer<typeof agentExecutionStatusSchema>;
