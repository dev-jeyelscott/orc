import { z } from "zod";
import { harnessSchema } from "../enums/harness.js";

export const conversationSchema = z.object({ id: z.string().uuid(), projectPath: z.string(), taskId: z.string().uuid().nullable(), runId: z.string().uuid().nullable(), createdAt: z.string().datetime(), updatedAt: z.string().datetime() });
export const conversationMessageSchema = z.object({ id: z.string().uuid(), conversationId: z.string().uuid(), role: z.enum(["user", "assistant"]), content: z.string(), createdAt: z.string().datetime() });
export const orchestratorSettingsSchema = z.object({ harness: harnessSchema, model: z.string(), reasoning: z.string(), systemPrompt: z.string() });
export const postConversationMessageSchema = z.object({ content: z.string().trim().min(1).max(20_000) });
export type Conversation = z.infer<typeof conversationSchema>;
export type ConversationMessage = z.infer<typeof conversationMessageSchema>;
