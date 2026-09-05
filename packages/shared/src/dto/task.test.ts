import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createTaskSchema,
  taskSchema,
} from "./task.js";

const TEAM_ID =
  "00000000-0000-4000-9000-000000000001";

const LEGACY_TASK_ID =
  "00000000-0000-4000-8000-000000000001";

const NOTION_TASK_ID =
  "00000000-0000-4000-8000-000000000002";

const INVALID_TASK_ID =
  "00000000-0000-4000-8000-000000000003";

describe(
  "task contracts",
  () => {
    it(
      "requires Team scope for manual Task creation",
      () => {
        const payload = {
          projectId:
            "project-runtime-id",
          teamId:
            TEAM_ID,
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

        expect(
          createTaskSchema.safeParse({
            projectId:
              payload.projectId,
            title:
              payload.title,
            instruction:
              payload.instruction,
          }).success,
        ).toBe(
          false,
        );
      },
    );

    it(
      "requires persisted Task responses to expose Team ownership",
      () => {
        const parsed =
          taskSchema.parse({
            id:
              LEGACY_TASK_ID,
            teamId:
              TEAM_ID,
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
          parsed.teamId,
        ).toBe(
          TEAM_ID,
        );

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
      "accepts generic Notion-backed external Task metadata with Team ownership",
      () => {
        const parsed =
          taskSchema.parse({
            id:
              NOTION_TASK_ID,
            teamId:
              TEAM_ID,
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
          parsed.teamId,
        ).toBe(
          TEAM_ID,
        );

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
      "rejects unsupported sources, malformed Teams, and non-integer priority values",
      () => {
        const base = {
          id:
            INVALID_TASK_ID,
          teamId:
            TEAM_ID,
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
            teamId:
              "not-a-uuid",
            source:
              "notion",
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
