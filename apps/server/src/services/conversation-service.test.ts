import {
  eq,
} from "drizzle-orm";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type {
  OrchestratorTurn,
  Project,
} from "@orc/shared";
import type {
  RuntimeEvent,
} from "../runtime/index.js";

const testState =
  vi.hoisted(
    () => ({
      project:
        null as Project | null,
      supervisorTurns:
        [] as Array<
          OrchestratorTurn | Error
        >,
      prompts:
        [] as string[],
      executeTool:
        vi.fn(),
    }),
  );

vi.mock(
  "./project-discovery.js",
  async (
    importOriginal,
  ) => {
    const actual =
      await importOriginal<
        typeof import("./project-discovery.js")
      >();

    return {
      ...actual,

      /**
       * Returns the test Project only when discovery is configured as available.
       */
      getProjectByPath:
        vi.fn(
          async (
            _root:
              string,
            projectPath:
              string,
          ) =>
            testState.project
              ?.path ===
            projectPath
              ? testState.project
              : null,
        ),
    };
  },
);

vi.mock(
  "./orchestrator-tool-service.js",
  () => ({
    /**
     * Executes the queued test tool implementation.
     */
    executeOrchestratorTool:
      testState.executeTool,
  }),
);

vi.mock(
  "../runtime/index.js",
  async (
    importOriginal,
  ) => {
    const actual =
      await importOriginal<
        typeof import("../runtime/index.js")
      >();

    return {
      ...actual,

      /**
       * Returns a minimal adapter that extracts the fake supervisor text event.
       */
      getHarnessAdapter:
        () => ({
          extractMessageText: (
            event:
              Record<
                string,
                unknown
              >,
          ) =>
            typeof event.text ===
            "string"
              ? event.text
              : undefined,
        }),

      /**
       * Emits one queued fake supervisor turn without launching an external CLI.
       */
      startHarnessSession:
        (
          _input:
            unknown,
          prompt:
            string,
        ) => {
          testState.prompts.push(
            prompt,
          );

          const next =
            testState.supervisorTurns.shift();

          return {
            metadata: {
              id:
                crypto.randomUUID(),
              pid:
                null,
              state:
                next instanceof Error
                  ? "failed"
                  : "exited",
              exitCode:
                next instanceof Error
                  ? null
                  : 0,
              signal:
                null,
              usage:
                null,
            },

            /**
             * Emits the fake provider response and final process event.
             */
            subscribe(
              listener: (
                event:
                  RuntimeEvent,
              ) => void,
            ) {
              if (
                next instanceof Error
              ) {
                listener({
                  type:
                    "diagnostic",
                  sequence:
                    1,
                  diagnostic: {
                    code:
                      "launch_failed",
                    message:
                      next.message,
                  },
                });

                return () =>
                  undefined;
              }

              if (!next) {
                throw new Error(
                  "No queued supervisor turn",
                );
              }

              listener({
                type:
                  "provider",
                sequence:
                  1,
                provider:
                  "test",
                event: {
                  text:
                    `<orc-supervisor>${JSON.stringify(
                      next,
                    )}</orc-supervisor>`,
                },
              });

              listener({
                type:
                  "exit",
                sequence:
                  2,
                exitCode:
                  0,
              });

              return () =>
                undefined;
            },

            /**
             * Does not support instructions in the fake supervisor session.
             */
            sendInstruction() {
              return false;
            },

            /**
             * Does not resize the fake supervisor session.
             */
            resize() {
              return false;
            },

            /**
             * Stops the fake supervisor session.
             */
            stop() {},
          };
        },
    };
  },
);

const {
  db,
} =
  await import(
    "../db/client.js"
  );

const {
  DEVELOPMENT_TEAM_ID,
  RESOLUTION_TEAM_ID,
} =
  await import(
    "../db/seed-ids.js"
  );

const {
  conversationMessages,
  conversations,
  orchestratorSettings,
} =
  await import(
    "../db/schema.js"
  );

const {
  ConversationServiceError,
  createConversation,
  getConversation,
  getOrchestratorSettings,
  listConversations,
  postConversationMessage,
  resetOrchestratorSettings,
  updateOrchestratorSettings,
} =
  await import(
    "./conversation-service.js"
  );

const createdConversationIds =
  new Set<string>();

/**
 * Creates the canonical fake Project used by Conversation tests.
 */
function makeProject(): Project {
  return {
    id:
      "test-project",
    name:
      "test-project",
    path:
      "/tmp/orc-test-project",
    branch:
      "main",
    gitState:
      "clean",
    primaryFiles: [
      "package.json",
    ],
    packageManager:
      "pnpm",
    stack:
      "node",
  };
}

/**
 * Creates and tracks one Team-scoped test Conversation.
 */
async function createTestConversation(
  teamId:
    string = RESOLUTION_TEAM_ID,
) {
  const conversation =
    await createConversation(
      testState.project!.path,
      teamId,
    );

  createdConversationIds.add(
    conversation.id,
  );

  return conversation;
}

beforeEach(
  () => {
    testState.project =
      makeProject();

    testState.supervisorTurns.length =
      0;

    testState.prompts.length =
      0;

    testState.executeTool.mockReset();
  },
);

afterEach(
  async () => {
    for (
      const id of
      createdConversationIds
    ) {
      await db
        .delete(
          conversationMessages,
        )
        .where(
          eq(
            conversationMessages.conversationId,
            id,
          ),
        );

      await db
        .delete(
          conversations,
        )
        .where(
          eq(
            conversations.id,
            id,
          ),
        );
    }

    createdConversationIds.clear();
  },
);

describe(
  "conversation-service",
  () => {
    it(
      "resets customized settings to server-owned low-reasoning defaults while preserving the singleton",
      async () => {
        const originalSettings =
          await getOrchestratorSettings();

        try {
          await updateOrchestratorSettings({
            harness:
              "claude",
            model:
              "claude-fable-5",
            reasoning:
              "medium",
            systemPrompt:
              "Temporary customized base prompt.",
          });

          const reset =
            await resetOrchestratorSettings();

          expect(
            reset,
          ).toEqual({
            harness:
              "codex",
            model:
              "default",
            reasoning:
              "low",
            systemPrompt:
              "You supervise engineering workflows. Use only supplied system state and never invent execution progress.",
          });

          expect(
            await getOrchestratorSettings(),
          ).toEqual(
            reset,
          );

          const rows =
            await db
              .select({
                id:
                  orchestratorSettings.id,
              })
              .from(
                orchestratorSettings,
              );

          expect(
            rows,
          ).toEqual([
            {
              id:
                1,
            },
          ]);
        } finally {
          await updateOrchestratorSettings(
            originalSettings,
          );
        }
      },
    );

    it(
      "rejects Conversation creation when the Project is not currently discovered",
      async () => {
        testState.project =
          null;

        await expect(
          createConversation(
            "/tmp/not-discovered",
            RESOLUTION_TEAM_ID,
          ),
        ).rejects.toMatchObject({
          statusCode:
            404,
        });
      },
    );

    it(
      "lists Conversations only inside the selected Project and Team context",
      async () => {
        const resolution =
          await createTestConversation(
            RESOLUTION_TEAM_ID,
          );

        await createTestConversation(
          DEVELOPMENT_TEAM_ID,
        );

        const listed =
          await listConversations(
            testState.project!.path,
            RESOLUTION_TEAM_ID,
          );

        expect(
          listed.map(
            (
              item,
            ) =>
              item.id,
          ),
        ).toEqual([
          resolution.id,
        ]);
      },
    );

    it(
      "persists messages and returns them when the Conversation is queried again",
      async () => {
        const conversation =
          await createTestConversation();

        testState.supervisorTurns.push(
          {
            type:
              "tool_call",
            tool: {
              name:
                "get_project",
              arguments: {},
            },
          },
          {
            type:
              "final",
            response:
              "Project state is available.",
          },
        );

        testState.executeTool
          .mockResolvedValue({
            result:
              testState.project,
          });

        await postConversationMessage(
          conversation.id,
          "Hello",
        );

        const loaded =
          await getConversation(
            conversation.id,
          );

        expect(
          loaded?.conversation
            .teamId,
        ).toBe(
          RESOLUTION_TEAM_ID,
        );

        expect(
          loaded?.messages.map(
            (
              message,
            ) =>
              message.role,
          ),
        ).toEqual([
          "user",
          "assistant",
        ]);
      },
    );

    it(
      "preserves existing Task and Run references when a read-only tool executes",
      async () => {
        const conversation =
          await createTestConversation();

        const taskId =
          crypto.randomUUID();

        const runId =
          crypto.randomUUID();

        await db
          .update(
            conversations,
          )
          .set({
            taskId,
            runId,
          })
          .where(
            eq(
              conversations.id,
              conversation.id,
            ),
          );

        testState.supervisorTurns.push(
          {
            type:
              "tool_call",
            tool: {
              name:
                "get_run",
              arguments: {},
            },
          },
          {
            type:
              "final",
            response:
              "The run is still linked.",
          },
        );

        testState.executeTool
          .mockResolvedValue({
            result: {
              run: {
                id:
                  runId,
                status:
                  "running",
              },
            },
          });

        await postConversationMessage(
          conversation.id,
          "Status?",
        );

        const loaded =
          await getConversation(
            conversation.id,
          );

        expect(
          loaded?.conversation
            .taskId,
        ).toBe(
          taskId,
        );

        expect(
          loaded?.conversation
            .runId,
        ).toBe(
          runId,
        );

        expect(
          loaded?.conversation
            .teamId,
        ).toBe(
          RESOLUTION_TEAM_ID,
        );
      },
    );

    it(
      "persists Task and Run references only after a successful mutating tool",
      async () => {
        const conversation =
          await createTestConversation();

        const taskId =
          crypto.randomUUID();

        const runId =
          crypto.randomUUID();

        testState.supervisorTurns.push(
          {
            type:
              "tool_call",
            tool: {
              name:
                "start_run",
              arguments: {
                taskId,
              },
            },
          },
          {
            type:
              "final",
            response:
              "The run has started.",
          },
        );

        testState.executeTool
          .mockResolvedValue({
            result: {
              run: {
                id:
                  runId,
              },
            },
            references: {
              taskId,
              runId,
            },
          });

        await postConversationMessage(
          conversation.id,
          "Start it",
        );

        const loaded =
          await getConversation(
            conversation.id,
          );

        expect(
          loaded?.conversation
            .taskId,
        ).toBe(
          taskId,
        );

        expect(
          loaded?.conversation
            .runId,
        ).toBe(
          runId,
        );
      },
    );

    it(
      "rejects a final supervisor answer before any backend tool query",
      async () => {
        const conversation =
          await createTestConversation();

        testState.supervisorTurns.push({
          type:
            "final",
          response:
            "The agent is testing.",
        });

        await expect(
          postConversationMessage(
            conversation.id,
            "What is happening?",
          ),
        ).rejects.toBeInstanceOf(
          ConversationServiceError,
        );

        const loaded =
          await getConversation(
            conversation.id,
          );

        expect(
          loaded?.messages.map(
            (
              message,
            ) =>
              message.role,
          ),
        ).toEqual([
          "user",
        ]);
      },
    );

    it(
      "feeds persisted Team scope and backend tool results into the supervisor turn",
      async () => {
        const conversation =
          await createTestConversation();

        const runId =
          crypto.randomUUID();

        testState.supervisorTurns.push(
          {
            type:
              "tool_call",
            tool: {
              name:
                "get_run",
              arguments: {
                runId,
              },
            },
          },
          {
            type:
              "final",
            response:
              "The persisted run status is running.",
          },
        );

        testState.executeTool
          .mockResolvedValue({
            result: {
              run: {
                id:
                  runId,
                status:
                  "running",
              },
            },
          });

        await postConversationMessage(
          conversation.id,
          "What is the run status?",
        );

        expect(
          testState.prompts,
        ).toHaveLength(
          2,
        );

        expect(
          testState.prompts[1],
        ).toContain(
          `"teamId":"${RESOLUTION_TEAM_ID}"`,
        );

        expect(
          testState.prompts[1],
        ).toContain(
          '"status":"running"',
        );
      },
    );

    it(
      "persists the user message but no fabricated assistant message when the supervisor fails",
      async () => {
        const conversation =
          await createTestConversation();

        testState.supervisorTurns.push(
          new Error(
            "Supervisor unavailable",
          ),
        );

        await expect(
          postConversationMessage(
            conversation.id,
            "Status?",
          ),
        ).rejects.toMatchObject({
          statusCode:
            502,
        });

        const loaded =
          await getConversation(
            conversation.id,
          );

        expect(
          loaded?.messages.map(
            (
              message,
            ) =>
              message.role,
          ),
        ).toEqual([
          "user",
        ]);
      },
    );
  },
);
