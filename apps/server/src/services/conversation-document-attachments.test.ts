import {
  and,
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
       * Returns the configured test Project only for its canonical path.
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
     * Executes the configured test Orchestrator tool implementation.
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
       * Returns a minimal adapter that extracts fake supervisor text.
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
       * Emits one queued fake supervisor turn without provider traffic.
       */
      startHarnessSession:
        (
          _input:
            unknown,
          _prompt:
            string,
        ) => {
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
             * Emits the queued provider event and process exit.
             */
            subscribe(
              listener: (
                event:
                  RuntimeEvent,
              ) => void,
            ) {
              if (
                next instanceof
                Error
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
             * Does not support instructions in the fake session.
             */
            sendInstruction() {
              return false;
            },

            /**
             * Does not resize the fake session.
             */
            resize() {
              return false;
            },

            /**
             * Stops the fake session.
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
  conversationMessageDocuments,
  conversationMessages,
  conversations,
  projectDocuments,
} =
  await import(
    "../db/schema.js"
  );

const {
  createConversation,
  postConversationMessage,
} =
  await import(
    "./conversation-service.js"
  );

const createdConversationIds =
  new Set<string>();

const createdDocumentIds =
  new Set<string>();

/**
 * Creates the canonical fake Project used by attachment service tests.
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
 * Creates and tracks one Team-scoped Conversation.
 */
async function createTestConversation() {
  const conversation =
    await createConversation(
      testState.project!.path,
      RESOLUTION_TEAM_ID,
    );

  createdConversationIds.add(
    conversation.id,
  );

  return conversation;
}

/**
 * Creates and tracks one persisted Project document for a chosen Team and Project path.
 */
async function createTestDocument(
  teamId:
    string,
  projectPath:
    string,
) {
  const content =
    "# Test roadmap";

  const [document] =
    await db
      .insert(
        projectDocuments,
      )
      .values({
        teamId,
        projectPath,
        fileName:
          `roadmap-${crypto.randomUUID()}.md`,
        extension:
          ".md",
        mediaType:
          "text/markdown",
        content,
        contentHash:
          "a".repeat(
            64,
          ),
        contentBytes:
          Buffer.byteLength(
            content,
            "utf8",
          ),
      })
      .returning();

  createdDocumentIds.add(
    document.id,
  );

  return document;
}

/**
 * Queues one final supervisor answer after authoritative preload state is available.
 */
function queueFinalTurn(): void {
  testState.executeTool.mockResolvedValue({
    result:
      testState.project,
  });

  testState.supervisorTurns.push({
    type:
      "final",
    response:
      "Project state is available.",
  });
}

beforeEach(
  () => {
    testState.project =
      makeProject();

    testState.supervisorTurns.length =
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

    for (
      const id of
      createdDocumentIds
    ) {
      await db
        .delete(
          projectDocuments,
        )
        .where(
          eq(
            projectDocuments.id,
            id,
          ),
        );
    }

    createdConversationIds.clear();
    createdDocumentIds.clear();
  },
);

describe(
  "Conversation document attachments",
  () => {
    /**
     * Verifies selected same-scope documents are persisted on the user message.
     */
    it(
      "persists selected documents on the user Conversation message",
      async () => {
        const conversation =
          await createTestConversation();

        const document =
          await createTestDocument(
            RESOLUTION_TEAM_ID,
            testState.project!.path,
          );

        queueFinalTurn();

        await postConversationMessage(
          conversation.id,
          "Use the selected roadmap.",
          [
            document.id,
          ],
        );

        const [userMessage] =
          await db
            .select({
              id:
                conversationMessages.id,
            })
            .from(
              conversationMessages,
            )
            .where(
              and(
                eq(
                  conversationMessages.conversationId,
                  conversation.id,
                ),
                eq(
                  conversationMessages.role,
                  "user",
                ),
              ),
            );

        const attachments =
          await db
            .select()
            .from(
              conversationMessageDocuments,
            )
            .where(
              eq(
                conversationMessageDocuments.conversationMessageId,
                userMessage.id,
              ),
            );

        expect(
          attachments,
        ).toHaveLength(
          1,
        );

        expect(
          attachments[0]
            .projectDocumentId,
        ).toBe(
          document.id,
        );
      },
    );

    /**
     * Verifies documents outside the persisted Conversation Team or Project cannot be attached.
     */
    it(
      "rejects cross-Team and cross-Project document attachments",
      async () => {
        const conversation =
          await createTestConversation();

        const foreignTeamDocument =
          await createTestDocument(
            DEVELOPMENT_TEAM_ID,
            testState.project!.path,
          );

        const foreignProjectDocument =
          await createTestDocument(
            RESOLUTION_TEAM_ID,
            "/tmp/another-project",
          );

        await expect(
          postConversationMessage(
            conversation.id,
            "Use the foreign Team document.",
            [
              foreignTeamDocument.id,
            ],
          ),
        ).rejects.toMatchObject({
          statusCode:
            400,
        });

        await expect(
          postConversationMessage(
            conversation.id,
            "Use the foreign Project document.",
            [
              foreignProjectDocument.id,
            ],
          ),
        ).rejects.toMatchObject({
          statusCode:
            400,
        });

        const userMessages =
          await db
            .select()
            .from(
              conversationMessages,
            )
            .where(
              and(
                eq(
                  conversationMessages.conversationId,
                  conversation.id,
                ),
                eq(
                  conversationMessages.role,
                  "user",
                ),
              ),
            );

        expect(
          userMessages,
        ).toHaveLength(
          0,
        );
      },
    );
  },
);
