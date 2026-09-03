import { z } from "zod";

import { agentResultStatusSchema } from "../enums/agent-result-status.js";

const commitHashSchema = z
  .string()
  .trim()
  .regex(
    /^[0-9a-fA-F]{7,64}$/,
    "Commit must be a hexadecimal Git commit hash",
  );

// Structured completion contract emitted by worker agents as the final content of their last
// message, wrapped in <orc-result>...</orc-result> (see apps/server/src/runtime/prompt.ts).
// Runtime commit verification resolves any non-null hash against the selected repository before
// the result is persisted or used for workflow progression.
export const agentResultSchema = z.strictObject({
  status: agentResultStatusSchema,
  summary: z.string().trim().min(1),
  details: z.record(z.string(), z.unknown()).default({}),
  findings: z.array(z.string()).default([]),
  filesChanged: z.array(z.string()).default([]),
  commandsRun: z.array(z.string()).default([]),
  validation: z.record(z.string(), z.unknown()).default({}),
  commit: commitHashSchema.nullable().default(null),
});

export type AgentResult = z.infer<typeof agentResultSchema>;
