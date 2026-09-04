import { describe, expect, it } from "vitest";

import {
  conversationDetailSchema,
  orchestratorSettingsSchema,
  postConversationMessageResponseSchema,
  updateOrchestratorSettingsSchema,
} from "./conversation.js";

const conversationId = "11111111-1111-4111-8111-111111111111";
const taskId = "22222222-2222-4222-8222-222222222222";
const runId = "33333333-3333-4333-8333-333333333333";
const messageId = "44444444-4444-4444-8444-444444444444";

describe("conversation contracts", () => {
  /** Verifies persisted conversation detail responses remain runtime validated. */
  it("accepts persisted conversation detail", () => {
    const result = conversationDetailSchema.parse({
      conversation: {
        id: conversationId,
        projectPath: "/home/user/workspace/orc",
        taskId,
        runId,
        createdAt: "2026-09-04T00:00:00.000Z",
        updatedAt: "2026-09-04T00:05:00.000Z",
      },
      messages: [
        {
          id: messageId,
          conversationId,
          role: "user",
          content: "Explain the current status.",
          createdAt: "2026-09-04T00:01:00.000Z",
        },
      ],
    });

    expect(result.conversation.runId).toBe(runId);
    expect(result.messages).toHaveLength(1);
  });

  /** Verifies message responses preserve both task and run linkage. */
  it("accepts a post-message response with conversation linkage", () => {
    const result = postConversationMessageResponseSchema.parse({
      message: {
        id: messageId,
        conversationId,
        role: "assistant",
        content: "The run is active.",
        createdAt: "2026-09-04T00:02:00.000Z",
      },
      taskId,
      runId,
    });

    expect(result.taskId).toBe(taskId);
    expect(result.runId).toBe(runId);
  });

  /** Verifies low is accepted as the canonical Orchestrator reasoning setting. */
  it("accepts canonical low orchestrator settings", () => {
    const result = orchestratorSettingsSchema.parse({
      harness: "codex",
      model: "default",
      reasoning: "low",
      systemPrompt: "You supervise engineering workflows.",
    });

    expect(result.harness).toBe("codex");
    expect(result.reasoning).toBe("low");
  });

  /** Verifies valid complete settings updates use the existing strict settings contract. */
  it("accepts a valid orchestrator settings update", () => {
    const result = updateOrchestratorSettingsSchema.parse({
      harness: "claude",
      model: "default",
      reasoning: "low",
      systemPrompt: "Use persisted system state.",
    });

    expect(result).toEqual({
      harness: "claude",
      model: "default",
      reasoning: "low",
      systemPrompt: "Use persisted system state.",
    });
  });

  /** Verifies malformed or incomplete settings payloads remain rejected. */
  it("rejects invalid orchestrator settings updates", () => {
    const result = updateOrchestratorSettingsSchema.safeParse({
      harness: "unsupported",
      model: "",
      reasoning: "",
      systemPrompt: "",
      extra: true,
    });

    expect(result.success).toBe(false);
  });
});
