import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createTaskSchema,
  taskSchema,
} from "./task.js";

describe(
  "task contracts",
  () => {
    it(
      "keeps the existing manual create-task payload backward compatible",
      () => {
        const payload = {
          projectId:
            "project-runtime-id",
          title:
            "Implement feature",
          instruction:
            "Implement the requested feature.",
        };

        expect(
          createTaskSchema.parse(
            payload,
          ),
        ).toEqual(
          payload,
        );
      },
    );

    it(
      "defaults legacy task responses to manual source metadata",
      () => {
        const parsed =
          taskSchema.parse({
            id:
              crypto.randomUUID(),
            projectPath:
              "/home/user/workspace/orc",
            title:
              "Legacy manual task",
            instruction:
              "Run the configured workflow.",
            status:
              "pending",
            createdAt:
              "2026-09-04T00:00:00.000Z",
            updatedAt:
              "2026-09-04T00:00:00.000Z",
          });

        expect(
          parsed.source,
        ).toBe(
          "manual",
        );

        expect(
          parsed.externalId,
        ).toBeNull();

        expect(
          parsed.externalUrl,
        ).toBeNull();

        expect(
          parsed.priority,
        ).toBe(
          0,
        );
      },
    );

    it(
      "accepts generic Notion-backed external task metadata",
      () => {
        const parsed =
          taskSchema.parse({
            id:
              crypto.randomUUID(),
            projectPath:
              "/home/user/workspace/orc",
            title:
              "Notion task",
            instruction:
              "# Raw Notion body",
            status:
              "pending",
            source:
              "notion",
            externalId:
              "notion-page-id",
            externalUrl:
              "https://www.notion.so/notion-page-id",
            priority:
              100,
            createdAt:
              "2026-09-04T00:00:00.000Z",
            updatedAt:
              "2026-09-04T00:00:00.000Z",
          });

        expect(
          parsed.source,
        ).toBe(
          "notion",
        );

        expect(
          parsed.priority,
        ).toBe(
          100,
        );
      },
    );

    it(
      "rejects unsupported sources and non-integer priority values",
      () => {
        const base = {
          id:
            crypto.randomUUID(),
          projectPath:
            "/home/user/workspace/orc",
          title:
            "External task",
          instruction:
            "Task body",
          status:
            "pending",
          externalId:
            null,
          externalUrl:
            null,
          createdAt:
            "2026-09-04T00:00:00.000Z",
          updatedAt:
            "2026-09-04T00:00:00.000Z",
        };

        expect(
          taskSchema.safeParse({
            ...base,
            source:
              "github",
            priority:
              1,
          }).success,
        ).toBe(
          false,
        );

        expect(
          taskSchema.safeParse({
            ...base,
            source:
              "notion",
            priority:
              1.5,
          }).success,
        ).toBe(
          false,
        );
      },
    );
  },
);
