import {
  eq,
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
  systemSettings,
  tasks,
} from "./schema.js";

const createdTaskIds =
  new Set<string>();

/**
 * Creates one disposable task row for schema-level persistence assertions.
 */
async function createTestTask(
  overrides: Partial<
    typeof tasks.$inferInsert
  > = {},
) {
  const [task] =
    await db
      .insert(tasks)
      .values({
        projectPath:
          `/tmp/orc-schema-${crypto.randomUUID()}`,
        title:
          "Schema test task",
        instruction:
          "Validate the task schema.",
        ...overrides,
      })
      .returning();

  createdTaskIds.add(
    task.id,
  );

  return task;
}

afterEach(
  async () => {
    for (
      const taskId of createdTaskIds
    ) {
      await db
        .delete(tasks)
        .where(
          eq(
            tasks.id,
            taskId,
          ),
        );
    }

    createdTaskIds.clear();

    await db
      .update(
        systemSettings,
      )
      .set({
        autoModeEnabled:
          false,
        updatedAt:
          new Date(),
      })
      .where(
        eq(
          systemSettings.id,
          1,
        ),
      );
  },
);

describe(
  "Notion Auto Mode persistence schema",
  () => {
    it(
      "preserves manual task defaults",
      async () => {
        const task =
          await createTestTask();

        expect(
          task.source,
        ).toBe(
          "manual",
        );

        expect(
          task.externalId,
        ).toBeNull();

        expect(
          task.externalUrl,
        ).toBeNull();

        expect(
          task.priority,
        ).toBe(
          0,
        );
      },
    );

    it(
      "allows multiple tasks without an external identity",
      async () => {
        const first =
          await createTestTask();

        const second =
          await createTestTask();

        expect(
          first.externalId,
        ).toBeNull();

        expect(
          second.externalId,
        ).toBeNull();
      },
    );

    it(
      "enforces source and external ID uniqueness",
      async () => {
        const externalId =
          `notion-${crypto.randomUUID()}`;

        await createTestTask({
          source:
            "notion",
          externalId,
          externalUrl:
            "https://www.notion.so/example",
          priority:
            50,
        });

        await expect(
          db
            .insert(tasks)
            .values({
              projectPath:
                `/tmp/orc-schema-${crypto.randomUUID()}`,
              title:
                "Duplicate external task",
              instruction:
                "Should violate external identity.",
              source:
                "notion",
              externalId,
              priority:
                50,
            }),
        ).rejects.toThrow();
      },
    );

    it(
      "keeps system settings as a single global row",
      async () => {
        const [settings] =
          await db
            .select()
            .from(
              systemSettings,
            )
            .where(
              eq(
                systemSettings.id,
                1,
              ),
            );

        expect(
          settings,
        ).toBeDefined();

        await expect(
          db
            .insert(
              systemSettings,
            )
            .values({
              id:
                2,
              autoModeEnabled:
                true,
            }),
        ).rejects.toThrow();
      },
    );
  },
);
