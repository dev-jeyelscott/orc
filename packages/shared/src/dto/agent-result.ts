import { z } from "zod";

import { agentResultStatusSchema } from "../enums/agent-result-status.js";

// Structured completion contract emitted by worker agents as the final content of their last
// message, wrapped in <orc-result>...</orc-result> (see apps/server/src/runtime/prompt.ts).
// Validation against this schema (plus the canCommit policy check, done at the service layer)
// determines whether an agent execution finalizes directly or gets one repair attempt.
export const agentResultSchema = z.object({
  status: agentResultStatusSchema,
  summary: z.string().trim().min(1),
  details: z.record(z.string(), z.unknown()).default({}),
  findings: z.array(z.string()).default([]),
  filesChanged: z.array(z.string()).default([]),
  commandsRun: z.array(z.string()).default([]),
  validation: z.record(z.string(), z.unknown()).default({}),
  commit: z.string().trim().nullable().default(null),
});

export type AgentResult = z.infer<typeof agentResultSchema>;
