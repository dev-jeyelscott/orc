import {
  asc,
  eq,
  inArray,
} from "drizzle-orm";

import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  db,
} from "./client.js";

import {
  conversationMessageDocuments,
  conversationMessages,
  conversations,
  projectDocumentChunks,
  projectDocuments,
  runs,
  taskDocuments,
  tasks,
  teams,
} from "./schema.js";

const createdTeamIds =
  new Set<string>();

const createdTaskIds =
  new Set<string>();

const createdRunIds =
  new Set<string>();

const createdConversationIds =
  new Set<string>();

const createdConversationMessageIds =
  new Set<string>();

const createdDocumentIds =
  new Set<string>();

type TestContext = {
  teamId:
    string;
  projectPath:
    string;
  taskId:
    string;
  runId:
    string;
  conversationId:
    string;
  messageId:
    string;
};

/**
 * Creates and tracks one isolated Team for project-document database tests.
 */
async function createTestTeam(): Promise<string> {
  const id =
    crypto.randomUUID();

  await db
    .insert(
      teams,
    )
    .values({
      id,
      slug:
        `project-document-${id}`,
      name:
        "Project Document Test Team",
      description:
        "Temporary Team for project document schema tests.",
      enabled:
        true,
    });

  createdTeamIds.add(
    id,
  );

  return id;
}

/**
 * Creates one Team-scoped Task, Run, Conversation, and user Message used by attachment tests.
 */
async function createTestContext(): Promise<TestContext> {
  const teamId =
    await createTestTeam();

  const projectPath =
    `/tmp/project-document-${crypto.randomUUID()}`;

  const [task] =
    await db
      .insert(
        tasks,
      )
      .values({
        teamId,
        projectPath,
        title:
          "Project document test",
        instruction:
          "Validate uploaded project document persistence.",
      })
      .returning();

  createdTaskIds.add(
    task.id,
  );

  const [run] =
    await db
      .insert(
        runs,
      )
      .values({
        taskId:
          task.id,
        teamId,
        projectPath,
      })
      .returning();

  createdRunIds.add(
    run.id,
  );

  const [conversation] =
    await db
      .insert(
        conversations,
      )
      .values({
        teamId,
        projectPath,
        taskId:
          task.id,
        runId:
          run.id,
      })
      .returning();

  createdConversationIds.add(
    conversation.id,
  );

  const [message] =
    await db
      .insert(
        conversationMessages,
      )
      .values({
        conversationId:
          conversation.id,
        role:
          "user",
        content:
          "Use the uploaded roadmap.",
      })
      .returning();

  createdConversationMessageIds.add(
    message.id,
  );

  return {
    teamId,
    projectPath,
    taskId:
      task.id,
    runId:
      run.id,
    conversationId:
      conversation.id,
    messageId:
      message.id,
  };
}

/**
 * Creates and tracks one normalized Project document without creating chunks automatically.
 */
async function createTestDocument(
  teamId:
    string,
  projectPath:
    string,
  suffix:
    string = crypto.randomUUID(),
) {
  const content =
    `# Roadmap ${suffix}`;

  const [document] =
    await db
      .insert(
        projectDocuments,
      )
      .values({
        teamId,
        projectPath,
        fileName:
          `roadmap-${suffix}.md`,
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

afterEach(
  async () => {
    if (
      createdConversationMessageIds.size >
      0
    ) {
      await db
        .delete(
          conversationMessageDocuments,
        )
        .where(
          inArray(
            conversationMessageDocuments.conversationMessageId,
            [
              ...createdConversationMessageIds,
            ],
          ),
        );
    }

    if (
      createdTaskIds.size >
      0
    ) {
      await db
        .delete(
          taskDocuments,
        )
        .where(
          inArray(
            taskDocuments.taskId,
            [
              ...createdTaskIds,
            ],
          ),
        );
    }

    if (
      createdDocumentIds.size >
      0
    ) {
      await db
        .delete(
          projectDocumentChunks,
        )
        .where(
          inArray(
            projectDocumentChunks.projectDocumentId,
            [
              ...createdDocumentIds,
            ],
          ),
        );
    }

    if (
      createdConversationMessageIds.size >
      0
    ) {
      await db
        .delete(
          conversationMessages,
        )
        .where(
          inArray(
            conversationMessages.id,
            [
              ...createdConversationMessageIds,
            ],
          ),
        );
    }

    if (
      createdConversationIds.size >
      0
    ) {
      await db
        .delete(
          conversations,
        )
        .where(
          inArray(
            conversations.id,
            [
              ...createdConversationIds,
            ],
          ),
        );
    }

    if (
      createdRunIds.size >
      0
    ) {
      await db
        .delete(
          runs,
        )
        .where(
          inArray(
            runs.id,
            [
              ...createdRunIds,
            ],
          ),
        );
    }

    if (
      createdTaskIds.size >
      0
    ) {
      await db
        .delete(
          tasks,
        )
        .where(
          inArray(
            tasks.id,
            [
              ...createdTaskIds,
            ],
          ),
        );
    }

    if (
      createdDocumentIds.size >
      0
    ) {
      await db
        .delete(
          projectDocuments,
        )
        .where(
          inArray(
            projectDocuments.id,
            [
              ...createdDocumentIds,
            ],
          ),
        );
    }

    if (
      createdTeamIds.size >
      0
    ) {
      await db
        .delete(
          teams,
        )
        .where(
          inArray(
            teams.id,
            [
              ...createdTeamIds,
            ],
          ),
        );
    }

    createdConversationMessageIds.clear();
    createdConversationIds.clear();
    createdRunIds.clear();
    createdTaskIds.clear();
    createdDocumentIds.clear();
    createdTeamIds.clear();
  },
);

describe(
  "project document persistence",
  () => {
    /**
     * Verifies every required parent relationship is enforced by PostgreSQL.
     */
    it(
      "enforces Project document attachment foreign keys",
      async () => {
        const context =
          await createTestContext();

        const document =
          await createTestDocument(
            context.teamId,
            context.projectPath,
          );

        await expect(
          db
            .insert(
              projectDocuments,
            )
            .values({
              teamId:
                crypto.randomUUID(),
              projectPath:
                context.projectPath,
              fileName:
                "invalid-team.md",
              extension:
                ".md",
              mediaType:
                "text/markdown",
              content:
                "# Invalid",
              contentHash:
                "b".repeat(
                  64,
                ),
              contentBytes:
                9,
            }),
        ).rejects.toThrow();

        await expect(
          db
            .insert(
              projectDocumentChunks,
            )
            .values({
              projectDocumentId:
                crypto.randomUUID(),
              sequence:
                0,
              startOffset:
                0,
              endOffset:
                5,
              content:
                "chunk",
              contentHash:
                "c".repeat(
                  64,
                ),
            }),
        ).rejects.toThrow();

        await expect(
          db
            .insert(
              taskDocuments,
            )
            .values({
              taskId:
                crypto.randomUUID(),
              projectDocumentId:
                document.id,
            }),
        ).rejects.toThrow();

        await expect(
          db
            .insert(
              taskDocuments,
            )
            .values({
              taskId:
                context.taskId,
              projectDocumentId:
                crypto.randomUUID(),
            }),
        ).rejects.toThrow();

        await expect(
          db
            .insert(
              conversationMessageDocuments,
            )
            .values({
              conversationMessageId:
                crypto.randomUUID(),
              projectDocumentId:
                document.id,
            }),
        ).rejects.toThrow();

        await expect(
          db
            .insert(
              conversationMessageDocuments,
            )
            .values({
              conversationMessageId:
                context.messageId,
              projectDocumentId:
                crypto.randomUUID(),
            }),
        ).rejects.toThrow();
      },
    );

    /**
     * Verifies chunk rows have one deterministic sequence position per document and can be read in stable order.
     */
    it(
      "enforces deterministic chunk ordering and uniqueness",
      async () => {
        const context =
          await createTestContext();

        const document =
          await createTestDocument(
            context.teamId,
            context.projectPath,
          );

        await db
          .insert(
            projectDocumentChunks,
          )
          .values([
            {
              projectDocumentId:
                document.id,
              sequence:
                1,
              startOffset:
                5,
              endOffset:
                10,
              content:
                "world",
              contentHash:
                "b".repeat(
                  64,
                ),
            },
            {
              projectDocumentId:
                document.id,
              sequence:
                0,
              startOffset:
                0,
              endOffset:
                5,
              content:
                "hello",
              contentHash:
                "c".repeat(
                  64,
                ),
            },
          ]);

        const ordered =
          await db
            .select({
              sequence:
                projectDocumentChunks.sequence,
            })
            .from(
              projectDocumentChunks,
            )
            .where(
              eq(
                projectDocumentChunks.projectDocumentId,
                document.id,
              ),
            )
            .orderBy(
              asc(
                projectDocumentChunks.sequence,
              ),
            );

        expect(
          ordered.map(
            (
              chunk,
            ) =>
              chunk.sequence,
          ),
        ).toEqual([
          0,
          1,
        ]);

        await expect(
          db
            .insert(
              projectDocumentChunks,
            )
            .values({
              projectDocumentId:
                document.id,
              sequence:
                0,
              startOffset:
                10,
              endOffset:
                15,
              content:
                "again",
              contentHash:
                "d".repeat(
                  64,
                ),
            }),
        ).rejects.toThrow();
      },
    );

    /**
     * Verifies one Task and one Conversation message can each reference multiple reusable documents.
     */
    it(
      "supports multiple documents per Task and Conversation message while preventing duplicates",
      async () => {
        const context =
          await createTestContext();

        const first =
          await createTestDocument(
            context.teamId,
            context.projectPath,
            "first",
          );

        const second =
          await createTestDocument(
            context.teamId,
            context.projectPath,
            "second",
          );

        await db
          .insert(
            taskDocuments,
          )
          .values([
            {
              taskId:
                context.taskId,
              projectDocumentId:
                first.id,
            },
            {
              taskId:
                context.taskId,
              projectDocumentId:
                second.id,
            },
          ]);

        await db
          .insert(
            conversationMessageDocuments,
          )
          .values([
            {
              conversationMessageId:
                context.messageId,
              projectDocumentId:
                first.id,
            },
            {
              conversationMessageId:
                context.messageId,
              projectDocumentId:
                second.id,
            },
          ]);

        const taskAttachments =
          await db
            .select()
            .from(
              taskDocuments,
            )
            .where(
              eq(
                taskDocuments.taskId,
                context.taskId,
              ),
            );

        const messageAttachments =
          await db
            .select()
            .from(
              conversationMessageDocuments,
            )
            .where(
              eq(
                conversationMessageDocuments.conversationMessageId,
                context.messageId,
              ),
            );

        expect(
          taskAttachments,
        ).toHaveLength(
          2,
        );

        expect(
          messageAttachments,
        ).toHaveLength(
          2,
        );

        await expect(
          db
            .insert(
              taskDocuments,
            )
            .values({
              taskId:
                context.taskId,
              projectDocumentId:
                first.id,
            }),
        ).rejects.toThrow();

        await expect(
          db
            .insert(
              conversationMessageDocuments,
            )
            .values({
              conversationMessageId:
                context.messageId,
              projectDocumentId:
                first.id,
            }),
        ).rejects.toThrow();
      },
    );

    /**
     * Verifies historical attachments restrict document deletion while parent and chunk cleanup uses explicit cascade semantics.
     */
    it(
      "preserves attachment history and cascades dependent rows intentionally",
      async () => {
        const context =
          await createTestContext();

        const document =
          await createTestDocument(
            context.teamId,
            context.projectPath,
          );

        await db
          .insert(
            projectDocumentChunks,
          )
          .values({
            projectDocumentId:
              document.id,
            sequence:
              0,
            startOffset:
              0,
            endOffset:
              5,
            content:
              "chunk",
            contentHash:
              "b".repeat(
                64,
              ),
          });

        await db
          .insert(
            taskDocuments,
          )
          .values({
            taskId:
              context.taskId,
            projectDocumentId:
              document.id,
          });

        await db
          .insert(
            conversationMessageDocuments,
          )
          .values({
            conversationMessageId:
              context.messageId,
            projectDocumentId:
              document.id,
          });

        await expect(
          db
            .delete(
              projectDocuments,
            )
            .where(
              eq(
                projectDocuments.id,
                document.id,
              ),
            ),
        ).rejects.toThrow();

        // Removes the unrelated Run FK dependency before testing the Task attachment cascade.
        await db
          .delete(
            runs,
          )
          .where(
            eq(
              runs.id,
              context.runId,
            ),
          );

        createdRunIds.delete(
          context.runId,
        );

        await db
          .delete(
            tasks,
          )
          .where(
            eq(
              tasks.id,
              context.taskId,
            ),
          );

        expect(
          await db
            .select()
            .from(
              taskDocuments,
            )
            .where(
              eq(
                taskDocuments.taskId,
                context.taskId,
              ),
            ),
        ).toHaveLength(
          0,
        );

        await db
          .delete(
            conversationMessages,
          )
          .where(
            eq(
              conversationMessages.id,
              context.messageId,
            ),
          );

        expect(
          await db
            .select()
            .from(
              conversationMessageDocuments,
            )
            .where(
              eq(
                conversationMessageDocuments.conversationMessageId,
                context.messageId,
              ),
            ),
        ).toHaveLength(
          0,
        );

        await db
          .delete(
            projectDocuments,
          )
          .where(
            eq(
              projectDocuments.id,
              document.id,
            ),
          );

        expect(
          await db
            .select()
            .from(
              projectDocumentChunks,
            )
            .where(
              eq(
                projectDocumentChunks.projectDocumentId,
                document.id,
              ),
            ),
        ).toHaveLength(
          0,
        );
      },
    );

    /**
     * Verifies new Project document records coexist without rewriting current Team-scoped orchestration records.
     */
    it(
      "coexists with Team-scoped Task Run and Conversation records",
      async () => {
        const context =
          await createTestContext();

        const document =
          await createTestDocument(
            context.teamId,
            context.projectPath,
          );

        await db
          .insert(
            taskDocuments,
          )
          .values({
            taskId:
              context.taskId,
            projectDocumentId:
              document.id,
          });

        const [task] =
          await db
            .select()
            .from(
              tasks,
            )
            .where(
              eq(
                tasks.id,
                context.taskId,
              ),
            );

        const [run] =
          await db
            .select()
            .from(
              runs,
            )
            .where(
              eq(
                runs.id,
                context.runId,
              ),
            );

        const [conversation] =
          await db
            .select()
            .from(
              conversations,
            )
            .where(
              eq(
                conversations.id,
                context.conversationId,
              ),
            );

        expect(
          task.teamId,
        ).toBe(
          context.teamId,
        );

        expect(
          run.teamId,
        ).toBe(
          context.teamId,
        );

        expect(
          conversation.teamId,
        ).toBe(
          context.teamId,
        );

        expect(
          task.projectPath,
        ).toBe(
          context.projectPath,
        );

        expect(
          run.projectPath,
        ).toBe(
          context.projectPath,
        );

        expect(
          conversation.projectPath,
        ).toBe(
          context.projectPath,
        );
      },
    );
  },
);
