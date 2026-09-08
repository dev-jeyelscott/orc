import {
  describe,
  expect,
  it,
} from "vitest";

import {
  MAX_PROJECT_DOCUMENT_SELECTIONS,
} from "./project-document.js";

import {
  conversationDetailSchema,
  createConversationSchema,
  orchestratorSettingsSchema,
  orchestratorToolCallSchema,
  postConversationMessageResponseSchema,
  postConversationMessageSchema,
  updateOrchestratorSettingsSchema,
} from "./conversation.js";

const conversationId =
  "11111111-1111-4111-8111-111111111111";

const teamId =
  "00000000-0000-4000-9000-000000000001";

const taskId =
  "22222222-2222-4222-8222-222222222222";

const runId =
  "33333333-3333-4333-8333-333333333333";

const messageId =
  "44444444-4444-4444-8444-444444444444";

const documentId =
  "55555555-5555-4555-8555-555555555555";

describe(
  "conversation contracts",
  () => {
    /**
     * Verifies persisted Conversation detail responses include Team scope.
     */
    it(
      "accepts persisted Team-scoped Conversation detail",
      () => {
        const result =
          conversationDetailSchema.parse({
            conversation: {
              id:
                conversationId,
              teamId,
              projectPath:
                "/home/user/workspace/orc",
              taskId,
              runId,
              createdAt:
                "2026-09-04T00:00:00.000Z",
              updatedAt:
                "2026-09-04T00:05:00.000Z",
            },
            messages: [
              {
                id:
                  messageId,
                conversationId,
                role:
                  "user",
                content:
                  "Explain the current status.",
                createdAt:
                  "2026-09-04T00:01:00.000Z",
              },
            ],
          });

        expect(
          result.conversation
            .teamId,
        ).toBe(
          teamId,
        );

        expect(
          result.conversation
            .runId,
        ).toBe(
          runId,
        );

        expect(
          result.messages,
        ).toHaveLength(
          1,
        );
      },
    );

    /**
     * Verifies new Conversation creation requires explicit Project and Team scope.
     */
    it(
      "requires Project and Team when creating a Conversation",
      () => {
        expect(
          createConversationSchema.parse({
            projectPath:
              "/workspace/orc",
            teamId,
          }),
        ).toEqual({
          projectPath:
            "/workspace/orc",
          teamId,
        });

        expect(
          createConversationSchema.safeParse({
            projectPath:
              "/workspace/orc",
          }).success,
        ).toBe(
          false,
        );
      },
    );

    /**
     * Verifies legacy content-only Conversation posts continue to parse without adding fields.
     */
    it(
      "preserves legacy content-only message parsing",
      () => {
        expect(
          postConversationMessageSchema.parse({
            content:
              "Use the current project state.",
          }),
        ).toEqual({
          content:
            "Use the current project state.",
        });
      },
    );

    /**
     * Verifies bounded uploaded Project document selections are accepted.
     */
    it(
      "accepts bounded document IDs on Conversation posts",
      () => {
        expect(
          postConversationMessageSchema.parse({
            content:
              "Use the selected roadmap.",
            documentIds: [
              documentId,
            ],
          }),
        ).toEqual({
          content:
            "Use the selected roadmap.",
          documentIds: [
            documentId,
          ],
        });
      },
    );

    /**
     * Verifies malformed, duplicate, and excessive document selections are rejected at the shared boundary.
     */
    it(
      "rejects invalid document selections",
      () => {
        expect(
          postConversationMessageSchema.safeParse({
            content:
              "Use this.",
            documentIds: [
              "not-a-uuid",
            ],
          }).success,
        ).toBe(
          false,
        );

        expect(
          postConversationMessageSchema.safeParse({
            content:
              "Use this.",
            documentIds: [
              documentId,
              documentId,
            ],
          }).success,
        ).toBe(
          false,
        );

        expect(
          postConversationMessageSchema.safeParse({
            content:
              "Use these.",
            documentIds:
              Array.from(
                {
                  length:
                    MAX_PROJECT_DOCUMENT_SELECTIONS +
                    1,
                },
                (
                  _,
                  index,
                ) =>
                  `00000000-0000-4000-8000-${String(
                    index +
                      1,
                  ).padStart(
                    12,
                    "0",
                  )}`,
              ),
          }).success,
        ).toBe(
          false,
        );
      },
    );

    /**
     * Verifies extending message posts with document IDs does not weaken strict unknown-field rejection.
     */
    it(
      "keeps Conversation message posts strict",
      () => {
        expect(
          postConversationMessageSchema.safeParse({
            content:
              "Hello",
            unexpected:
              true,
          }).success,
        ).toBe(
          false,
        );
      },
    );

    /**
     * Verifies the model cannot supply or override Team through create_task tool arguments.
     */
    it(
      "rejects model-selected Team input on create_task",
      () => {
        expect(
          orchestratorToolCallSchema.safeParse({
            name:
              "create_task",
            arguments: {
              title:
                "Implement feature",
              instruction:
                "Implement the requested feature.",
              teamId,
            },
          }).success,
        ).toBe(
          false,
        );
      },
    );

    /**
     * Verifies message responses preserve both Task and Run linkage.
     */
    it(
      "accepts a post-message response with Conversation linkage",
      () => {
        const result =
          postConversationMessageResponseSchema.parse({
            message: {
              id:
                messageId,
              conversationId,
              role:
                "assistant",
              content:
                "The run is active.",
              createdAt:
                "2026-09-04T00:02:00.000Z",
            },
            taskId,
            runId,
          });

        expect(
          result.taskId,
        ).toBe(
          taskId,
        );

        expect(
          result.runId,
        ).toBe(
          runId,
        );
      },
    );

    /**
     * Verifies low is accepted as the canonical Orchestrator reasoning setting.
     */
    it(
      "accepts canonical low Orchestrator settings",
      () => {
        const result =
          orchestratorSettingsSchema.parse({
            harness:
              "codex",
            model:
              "default",
            reasoning:
              "low",
            systemPrompt:
              "You supervise engineering workflows.",
          });

        expect(
          result.harness,
        ).toBe(
          "codex",
        );

        expect(
          result.reasoning,
        ).toBe(
          "low",
        );
      },
    );

    /**
     * Verifies valid complete settings updates use the existing strict settings contract.
     */
    it(
      "accepts a valid Orchestrator settings update",
      () => {
        const result =
          updateOrchestratorSettingsSchema.parse({
            harness:
              "claude",
            model:
              "default",
            reasoning:
              "low",
            systemPrompt:
              "Use persisted system state.",
          });

        expect(
          result,
        ).toEqual({
          harness:
            "claude",
          model:
            "default",
          reasoning:
            "low",
          systemPrompt:
            "Use persisted system state.",
        });
      },
    );

    /**
     * Verifies malformed or incomplete settings payloads remain rejected.
     */
    it(
      "rejects invalid Orchestrator settings updates",
      () => {
        const result =
          updateOrchestratorSettingsSchema.safeParse({
            harness:
              "unsupported",
            model:
              "",
            reasoning:
              "",
            systemPrompt:
              "",
            extra:
              true,
          });

        expect(
          result.success,
        ).toBe(
          false,
        );
      },
    );
  },
);
