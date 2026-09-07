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
        null as
          | Project
          | null,
      supervisorTurns:
        [] as
          Array<
            OrchestratorTurn
          >,
      executedTools:
        [] as
          string[],
      prompts:
        [] as
          string[],
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
       * Returns the deterministic test Project for matching Project paths.
       */
      getProjectByPath:
        vi.fn(
          async (
            _root:
              string,
            projectPath:
              string,
          ) =>
            testState
              .project
              ?.path ===
            projectPath
              ? testState
                  .project
              : null,
        ),
    };
  },
);

vi.mock(
  "./orchestrator-tool-service.js",
  () => ({
    /**
     * Records each requested tool before delegating to the deterministic fake.
     */
    executeOrchestratorTool:
      async (
        conversation:
          unknown,
        tool: {
          name:
            string;
        },
        context?:
          unknown,
      ) => {
        testState
          .executedTools
          .push(
            tool.name,
          );

        return testState
          .executeTool(
            conversation,
            tool,
            context,
          );
      },
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
       * Extracts deterministic assistant text from fake provider events.
       */
      getHarnessAdapter:
        () => ({
          extractMessageText:
            (
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
       * Emits one queued supervisor response without starting an external harness.
       */
      startHarnessSession:
        (
          _input:
            unknown,
          prompt:
            string,
        ) => {
          testState
            .prompts
            .push(
              prompt,
            );

          const next =
            testState
              .supervisorTurns
              .shift();

          if (!next) {
            throw new Error(
              "No queued supervisor turn",
            );
          }

          return {
            metadata: {
              id:
                crypto.randomUUID(),
              pid:
                null,
              state:
                "exited",
              exitCode:
                0,
              signal:
                null,
              usage:
                null,
            },

            /**
             * Emits the queued provider message followed by one successful exit.
             */
            subscribe(
              listener:
                (
                  event:
                    RuntimeEvent,
                ) => void,
            ) {
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
             * Keeps fake supervisor sessions non-interactive.
             */
            sendInstruction() {
              return false;
            },

            /**
             * Keeps terminal resizing unsupported in the fake supervisor.
             */
            resize() {
              return false;
            },

            /**
             * Stops the fake session without external side effects.
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
  RESOLUTION_TEAM_ID,
} =
  await import(
    "../db/seed-ids.js"
  );

const {
  conversationMessages,
  conversations,
} =
  await import(
    "../db/schema.js"
  );

const {
  createConversation,
  getConversation,
  postConversationMessage,
} =
  await import(
    "./conversation-service.js"
  );

const createdIds =
  new Set<string>();

/**
 * Creates the deterministic filesystem-backed Project used by conversation tests.
 */
function project():
  Project {
  return {
    id:
      "phase8-test-project",
    name:
      "orc",
    path:
      "/tmp/orc-phase8-conversation-project",
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
 * Creates and tracks one persisted Team-scoped conversation.
 */
async function createTestConversation() {
  const conversation =
    await createConversation(
      testState
        .project!
        .path,
      RESOLUTION_TEAM_ID,
    );

  createdIds.add(
    conversation.id,
  );

  return conversation;
}

beforeEach(
  () => {
    testState.project =
      project();

    testState
      .supervisorTurns
      .length =
      0;

    testState
      .executedTools
      .length =
      0;

    testState
      .prompts
      .length =
      0;

    testState
      .executeTool
      .mockReset();
  },
);

afterEach(
  async () => {
    for (
      const id of
      createdIds
    ) {
      await db
        .delete(
          conversationMessages,
        )
        .where(
          eq(
            conversationMessages
              .conversationId,
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

    createdIds.clear();
  },
);

describe(
  "conversation durable knowledge behavior",
  () => {
    it(
      "does not preload knowledge for an ordinary status question",
      async () => {
        const conversation =
          await createTestConversation();

        testState
          .supervisorTurns
          .push({
            type:
              "final",
            response:
              "No active Run is linked.",
          });

        testState
          .executeTool
          .mockResolvedValue({
            result:
              testState
                .project,
          });

        await postConversationMessage(
          conversation.id,
          "What is the current status?",
        );

        expect(
          testState
            .executedTools,
        ).toContain(
          "get_project",
        );

        expect(
          testState
            .executedTools,
        ).not.toContain(
          "search_knowledge",
        );

        expect(
          testState
            .executedTools,
        ).not.toContain(
          "get_knowledge_section",
        );
      },
    );

    it(
      "continues a valid conversation when knowledge is unavailable",
      async () => {
        const conversation =
          await createTestConversation();

        testState
          .supervisorTurns
          .push(
            {
              type:
                "tool_call",
              tool: {
                name:
                  "search_knowledge",
                arguments: {
                  query:
                    "architecture",
                  area:
                    "project",
                  scope:
                    "default",
                  limit:
                    5,
                },
              },
            },
            {
              type:
                "final",
              response:
                "Durable knowledge is currently unavailable.",
            },
          );

        testState
          .executeTool
          .mockImplementation(
            async (
              _conversation:
                unknown,
              tool: {
                name:
                  string;
              },
            ) => {
              if (
                tool.name ===
                "get_project"
              ) {
                return {
                  result:
                    testState
                      .project,
                };
              }

              return {
                result: {
                  source:
                    "vault",
                  kind:
                    "durable_knowledge",
                  runtimeAuthoritative:
                    false,
                  status:
                    "knowledge_unavailable",
                  results: [],
                  message:
                    "Durable knowledge is currently unavailable.",
                },
              };
            },
          );

        await expect(
          postConversationMessage(
            conversation.id,
            "What does the durable architecture say?",
          ),
        ).resolves.toBeDefined();

        const loaded =
          await getConversation(
            conversation.id,
          );

        expect(
          loaded
            ?.messages
            .map(
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
      "distinguishes successful empty knowledge from an unavailable result",
      async () => {
        const conversation =
          await createTestConversation();

        testState
          .supervisorTurns
          .push(
            {
              type:
                "tool_call",
              tool: {
                name:
                  "search_knowledge",
                arguments: {
                  query:
                    "nonexistent",
                  area:
                    "project",
                  scope:
                    "default",
                  limit:
                    5,
                },
              },
            },
            {
              type:
                "final",
              response:
                "No relevant durable knowledge was found.",
            },
          );

        testState
          .executeTool
          .mockImplementation(
            async (
              _conversation:
                unknown,
              tool: {
                name:
                  string;
              },
            ) =>
              tool.name ===
              "get_project"
                ? {
                    result:
                      testState
                        .project,
                  }
                : {
                    result: {
                      source:
                        "vault",
                      kind:
                        "durable_knowledge",
                      runtimeAuthoritative:
                        false,
                      status:
                        "ok",
                      results: [],
                    },
                  },
          );

        const result =
          await postConversationMessage(
            conversation.id,
            "Find nonexistent durable context.",
          );

        expect(
          result
            ?.message
            .content,
        ).toContain(
          "No relevant durable knowledge",
        );
      },
    );

    it(
      "places the runtime-authority rule next to stale durable status claims in supervisor context",
      async () => {
        const conversation =
          await createTestConversation();

        testState
          .supervisorTurns
          .push(
            {
              type:
                "tool_call",
              tool: {
                name:
                  "get_knowledge_section",
                arguments: {
                  path:
                    "Projects/orc/STATE.md",
                  maxChars:
                    500,
                },
              },
            },
            {
              type:
                "final",
              response:
                "Vault text is historical context and does not establish current Run state.",
            },
          );

        testState
          .executeTool
          .mockImplementation(
            async (
              _conversation:
                unknown,
              tool: {
                name:
                  string;
              },
            ) =>
              tool.name ===
              "get_project"
                ? {
                    result:
                      testState
                        .project,
                  }
                : {
                    result: {
                      source:
                        "vault",
                      kind:
                        "durable_knowledge",
                      runtimeAuthoritative:
                        false,
                      status:
                        "ok",
                      section: {
                        ref: {
                          source:
                            "vault",
                          path:
                            "Projects/orc/STATE.md",
                          excerpt:
                            "The current run is blocked and complete.",
                        },
                        title:
                          "STATE",
                        authority: {
                          tier:
                            "tier3",
                          class:
                            "excluded",
                          access:
                            "exact-read-only",
                        },
                        truncated:
                          false,
                        charsReturned:
                          40,
                        bytesReturned:
                          40,
                      },
                    },
                  },
          );

        await postConversationMessage(
          conversation.id,
          "What does the old state note say?",
        );

        expect(
          testState
            .prompts
            .at(-1),
        ).toContain(
          "Authoritative runtime state always wins when vault content disagrees.",
        );

        expect(
          testState
            .prompts
            .at(-1),
        ).toContain(
          "The current run is blocked and complete.",
        );
      },
    );
  },
);
