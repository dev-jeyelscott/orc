import { z } from "zod";

export const agentRouteOutcomeSchema = z.enum([
  "completed",
  "approved",
  "changes_requested",
  "blocked",
  "failed",
]);

export const terminalActionSchema = z.enum(["complete_run", "fail_run", "block_run"]);

export type AgentRouteOutcome = z.infer<typeof agentRouteOutcomeSchema>;
export type TerminalAction = z.infer<typeof terminalActionSchema>;
