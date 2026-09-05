import { z } from "zod";

import { harnessSchema } from "../enums/harness.js";

export const conversationSchema = z.object({
  id: z.string().uuid(),
  teamId: z.string().uuid(),
  projectPath: z.string(),
  taskId: z.string().uuid().nullable(),
  runId: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const conversationMessageSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  createdAt: z.string().datetime(),
});

export const conversationListResponseSchema = z.object({
  conversations: z.array(conversationSchema),
});

export const conversationDetailSchema = z.object({
  conversation: conversationSchema,
  messages: z.array(conversationMessageSchema),
});

export const createConversationSchema = z
  .object({
    projectPath:
      z.string()
        .trim()
        .min(1)
        .max(4096),
    teamId:
      z.string().uuid(),
  })
  .strict();

export const postConversationMessageSchema = z
  .object({
    content: z.string().trim().min(1).max(20_000),
  })
  .strict();

export const postConversationMessageResponseSchema = z.object({
  message: conversationMessageSchema,
  taskId: z.string().uuid().nullable(),
  runId: z.string().uuid().nullable(),
});

export const orchestratorSettingsSchema = z
  .object({
    harness: harnessSchema,
    model: z.string().trim().min(1).max(160),
    reasoning: z.string().trim().min(1).max(160),
    systemPrompt: z.string().trim().min(1).max(40_000),
  })
  .strict();

export const updateOrchestratorSettingsSchema =
  orchestratorSettingsSchema;

const getProjectToolSchema = z
  .object({
    name: z.literal("get_project"),
    arguments: z.object({}).strict(),
  })
  .strict();

const getTaskToolSchema = z
  .object({
    name: z.literal("get_task"),
    arguments: z
      .object({
        taskId: z.string().uuid().optional(),
      })
      .strict(),
  })
  .strict();

const createTaskToolSchema = z
  .object({
    name: z.literal("create_task"),
    arguments: z
      .object({
        title: z.string().trim().min(1).max(200),
        instruction: z.string().trim().min(1).max(20_000),
      })
      .strict(),
  })
  .strict();

const startRunToolSchema = z
  .object({
    name: z.literal("start_run"),
    arguments: z
      .object({
        taskId: z.string().uuid().optional(),
      })
      .strict(),
  })
  .strict();

const getRunToolSchema = z
  .object({
    name: z.literal("get_run"),
    arguments: z
      .object({
        runId: z.string().uuid().optional(),
      })
      .strict(),
  })
  .strict();

const getAgentExecutionToolSchema = z
  .object({
    name: z.literal("get_agent_execution"),
    arguments: z
      .object({
        executionId: z.string().uuid(),
      })
      .strict(),
  })
  .strict();

const getRecentEventsToolSchema = z
  .object({
    name: z.literal("get_recent_events"),
    arguments: z
      .object({
        runId: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(50).default(20),
      })
      .strict(),
  })
  .strict();

const sendInstructionToolSchema = z
  .object({
    name: z.literal("send_instruction"),
    arguments: z
      .object({
        executionId: z.string().uuid(),
        instruction: z.string().trim().min(1).max(20_000),
      })
      .strict(),
  })
  .strict();

const stopRunToolSchema = z
  .object({
    name: z.literal("stop_run"),
    arguments: z
      .object({
        runId: z.string().uuid().optional(),
      })
      .strict(),
  })
  .strict();

const retryExecutionToolSchema = z
  .object({
    name: z.literal("retry_execution"),
    arguments: z
      .object({
        executionId: z.string().uuid(),
      })
      .strict(),
  })
  .strict();

export const orchestratorToolCallSchema = z.discriminatedUnion(
  "name",
  [
    getProjectToolSchema,
    getTaskToolSchema,
    createTaskToolSchema,
    startRunToolSchema,
    getRunToolSchema,
    getAgentExecutionToolSchema,
    getRecentEventsToolSchema,
    sendInstructionToolSchema,
    stopRunToolSchema,
    retryExecutionToolSchema,
  ],
);

export const orchestratorTurnSchema = z.discriminatedUnion(
  "type",
  [
    z
      .object({
        type: z.literal("tool_call"),
        tool: orchestratorToolCallSchema,
      })
      .strict(),
    z
      .object({
        type: z.literal("final"),
        response: z.string().trim().min(1).max(40_000),
      })
      .strict(),
  ],
);

export type Conversation = z.infer<typeof conversationSchema>;

export type ConversationMessage = z.infer<
  typeof conversationMessageSchema
>;

export type ConversationListResponse = z.infer<
  typeof conversationListResponseSchema
>;

export type ConversationDetail = z.infer<
  typeof conversationDetailSchema
>;

export type OrchestratorSettings = z.infer<
  typeof orchestratorSettingsSchema
>;

export type OrchestratorToolCall = z.infer<
  typeof orchestratorToolCallSchema
>;

export type OrchestratorTurn = z.infer<
  typeof orchestratorTurnSchema
>;
