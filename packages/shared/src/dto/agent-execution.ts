import { z } from "zod";

import { agentExecutionStatusSchema } from "../enums/agent-execution-status.js";
import { agentResultStatusSchema } from "../enums/agent-result-status.js";
import { harnessSchema } from "../enums/harness.js";
import { agentResultSchema } from "./agent-result.js";

export const startAgentExecutionSchema = z.object({
  agentId: z.string().uuid(),
  instruction: z.string().trim().min(1),
});

export const agentExecutionSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  agentId: z.string().uuid().nullable(),
  agentName: z.string(),
  agentRole: z.string(),
  layer: z.number().int(),
  executionOrder: z.number().int(),
  harness: harnessSchema,
  model: z.string(),
  reasoning: z.string(),
  status: agentExecutionStatusSchema,
  pid: z.number().int().nullable(),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  exitCode: z.number().int().nullable(),
  // resultStatus/resultPayload/repairAttempted are populated by the structured completion
  // contract. resultStatus/resultPayload remain null until a valid result is parsed.
  resultStatus: agentResultStatusSchema.nullable(),
  resultPayload: agentResultSchema.nullable(),
  tokenUsage: z.record(z.string(), z.unknown()).nullable(),
  contextUsage: z.record(z.string(), z.unknown()).nullable(),
  commitHash: z.string().nullable(),
  failureReason: z.string().nullable(),
  repairAttempted: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type StartAgentExecution = z.infer<typeof startAgentExecutionSchema>;
export type AgentExecution = z.infer<typeof agentExecutionSchema>;

export const terminalChunkFrameSchema = z.object({
  type: z.literal("chunk"),
  sequence: z.number().int().positive(),
  data: z.string(),
});

export const terminalCompleteFrameSchema = z.object({
  type: z.literal("complete"),
  exitCode: z.number().int().nullable(),
  status: agentExecutionStatusSchema,
});

export const terminalErrorFrameSchema = z.object({
  type: z.literal("error"),
  error: z.string(),
});

export const terminalFrameSchema = z.discriminatedUnion("type", [
  terminalChunkFrameSchema,
  terminalCompleteFrameSchema,
  terminalErrorFrameSchema,
]);

export const terminalResizeFrameSchema = z
  .object({
    type: z.literal("resize"),
    cols: z.number().int().min(2).max(500),
    rows: z.number().int().min(1).max(200),
  })
  .strict();

export const terminalClientFrameSchema = z.discriminatedUnion("type", [
  terminalResizeFrameSchema,
]);

export type TerminalChunkFrame = z.infer<typeof terminalChunkFrameSchema>;
export type TerminalCompleteFrame = z.infer<typeof terminalCompleteFrameSchema>;
export type TerminalErrorFrame = z.infer<typeof terminalErrorFrameSchema>;
export type TerminalFrame = z.infer<typeof terminalFrameSchema>;
export type TerminalResizeFrame = z.infer<typeof terminalResizeFrameSchema>;
export type TerminalClientFrame = z.infer<typeof terminalClientFrameSchema>;
