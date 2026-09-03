import { z } from "zod";

export const agentResultStatusSchema = z.enum([
  "completed",
  "approved",
  "changes_requested",
  "blocked",
  "failed",
]);

export type AgentResultStatus = z.infer<typeof agentResultStatusSchema>;
