import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type {
  Project,
} from "@orc/shared";

import {
  NotionTaskSourceAdapter,
  type NotionTaskSourceClient,
} from "./notion-task-source.js";

const project: Project = {
  id:
    "project-id",
  name:
    "orc",
  path:
    "/home/user/workspace/orc",
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

/**
 * Creates one mock Notion page satisfying the expected external task contract.
 */
function readyPage(
  overrides: {
    priority?:
      number | null;
    projectName?:
      string;
    status?:
      string;
  } = {},
) {
  return {
    object:
      "page",
    id:
      "11111111-1111-1111-1111-111111111111",
    url:
      "https://www.notion.so/11111111111111111111111111111111",
    properties: {
      Title: {
        type:
          "title",
        title: [
          {
            plain_text:
              "Implement Auto Mode",
          },
        ],
      },
      Status: {
        type:
          "status",
        status: {
          name:
            overrides.status ??
            "Ready",
        },
      },
      Priority: {
        type:
          "number",
        number:
          overrides.priority ??
          100,
      },
      Project: {
        type:
          "select",
        select: {
          name:
            overrides.projectName ??
            "orc",
        },
      },
    },
  };
}

/**
 * Creates mock SDK methods while retaining direct Vitest handles for assertions.
 */
function mockClient() {
  const query =
    vi.fn();

  const retrieveMarkdown =
    vi.fn();

  const update =
    vi.fn();

  return {
    query,
    retrieveMarkdown,
    update,
    client: {
      dataSources: {
        query,
      },
      pages: {
        retrieveMarkdown,
        update,
      },
    } as unknown as
      NotionTaskSourceClient,
  };
}

/**
 * Creates a successful page-markdown response containing the supplied raw body.
 */
function markdownResponse(
  markdown =
    "# Task\n\nImplement the feature.",
) {
  return {
    object:
      "page_markdown",
    id:
      "11111111-1111-1111-1111-111111111111",
    markdown,
    truncated:
      false,
    unknown_block_ids:
      [],
  };
}

describe(
  "NotionTaskSourceAdapter",
  () => {
    it(
      "queries exactly one Ready task in deterministic priority and creation order",
      async () => {
        const mocks =
          mockClient();

        mocks.query
          .mockResolvedValue({
            results: [
              readyPage(),
            ],
          });

        mocks.retrieveMarkdown
          .mockResolvedValue(
            markdownResponse(
              "# Exact body\n\nKeep this unchanged.",
            ),
          );

        const resolveProject =
          vi.fn()
            .mockResolvedValue(
              project,
            );

        const adapter =
          new NotionTaskSourceAdapter({
            client:
              mocks.client,
            dataSourceId:
              "data-source-id",
            resolveProject,
          });

        const task =
          await adapter.getNextReadyTask();

        expect(
          mocks.query,
        ).toHaveBeenCalledWith({
          data_source_id:
            "data-source-id",
          filter: {
            property:
              "Status",
            status: {
              equals:
                "Ready",
            },
          },
          sorts: [
            {
              property:
                "Priority",
              direction:
                "descending",
            },
            {
              timestamp:
                "created_time",
              direction:
                "ascending",
            },
          ],
          page_size:
            1,
          result_type:
            "page",
        });

        expect(
          resolveProject,
        ).toHaveBeenCalledWith(
          "orc",
        );

        expect(
          task,
        ).toMatchObject({
          source:
            "notion",
          title:
            "Implement Auto Mode",
          instruction:
            "# Exact body\n\nKeep this unchanged.",
          priority:
            100,
          project,
        });
      },
    );

    it(
      "returns null when no Ready task exists",
      async () => {
        const mocks =
          mockClient();

        mocks.query
          .mockResolvedValue({
            results:
              [],
          });

        const adapter =
          new NotionTaskSourceAdapter({
            client:
              mocks.client,
            dataSourceId:
              "data-source-id",
            resolveProject:
              vi.fn(),
          });

        expect(
          await adapter.getNextReadyTask(),
        ).toBeNull();

        expect(
          mocks.retrieveMarkdown,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "skips a Notion Project absolute path instead of treating it as a project directory",
      async () => {
        const mocks =
          mockClient();

        mocks.query
          .mockResolvedValue({
            results: [
              readyPage({
                projectName:
                  "/home/user/workspace/orc",
              }),
            ],
          });

        const resolveProject =
          vi.fn();

        const adapter =
          new NotionTaskSourceAdapter({
            client:
              mocks.client,
            dataSourceId:
              "data-source-id",
            resolveProject,
          });

        expect(
          await adapter.getNextReadyTask(),
        ).toBeNull();

        expect(
          resolveProject,
        ).not.toHaveBeenCalled();

        expect(
          mocks.retrieveMarkdown,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects a non-integer Priority",
      async () => {
        const mocks =
          mockClient();

        mocks.query
          .mockResolvedValue({
            results: [
              readyPage({
                priority:
                  1.5,
              }),
            ],
          });

        const adapter =
          new NotionTaskSourceAdapter({
            client:
              mocks.client,
            dataSourceId:
              "data-source-id",
            resolveProject:
              vi.fn(),
          });

        await expect(
          adapter.getNextReadyTask(),
        ).rejects.toThrow(
          "Priority must be an integer",
        );
      },
    );

    it(
      "rejects truncated markdown rather than persisting incomplete instructions",
      async () => {
        const mocks =
          mockClient();

        mocks.query
          .mockResolvedValue({
            results: [
              readyPage(),
            ],
          });

        mocks.retrieveMarkdown
          .mockResolvedValue({
            ...markdownResponse(),
            truncated:
              true,
            unknown_block_ids: [
              "22222222-2222-2222-2222-222222222222",
            ],
          });

        const adapter =
          new NotionTaskSourceAdapter({
            client:
              mocks.client,
            dataSourceId:
              "data-source-id",
            resolveProject:
              vi.fn()
                .mockResolvedValue(
                  project,
                ),
          });

        await expect(
          adapter.getNextReadyTask(),
        ).rejects.toThrow(
          "truncated",
        );
      },
    );

    it.each([
      "In Progress",
      "Done",
      "Blocked",
      "Failed",
    ] as const)(
      "updates the Notion Status property to %s",
      async (
        status,
      ) => {
        const mocks =
          mockClient();

        mocks.update
          .mockResolvedValue({
            object:
              "page",
          });

        const adapter =
          new NotionTaskSourceAdapter({
            client:
              mocks.client,
            dataSourceId:
              "data-source-id",
            resolveProject:
              vi.fn(),
          });

        await adapter.updateStatus(
          "page-id",
          status,
        );

        expect(
          mocks.update,
        ).toHaveBeenCalledWith({
          page_id:
            "page-id",
          properties: {
            Status: {
              status: {
                name:
                  status,
              },
            },
          },
        });
      },
    );

    it(
      "retries transient service failures with bounded jittered backoff",
      async () => {
        const mocks =
          mockClient();

        mocks.query
          .mockRejectedValueOnce({
            status:
              503,
            code:
              "service_unavailable",
          })
          .mockResolvedValue({
            results: [
              readyPage(),
            ],
          });

        mocks.retrieveMarkdown
          .mockResolvedValue(
            markdownResponse(),
          );

        const wait =
          vi.fn()
            .mockResolvedValue(
              undefined,
            );

        const retryLogger = {
          warn:
            vi.fn(),
        };

        const adapter =
          new NotionTaskSourceAdapter({
            client:
              mocks.client,
            dataSourceId:
              "data-source-id",
            resolveProject:
              vi.fn()
                .mockResolvedValue(
                  project,
                ),
            retry: {
              maxAttempts:
                3,
              baseDelayMs:
                10,
              maxDelayMs:
                10,
              random:
                () => 0.5,
              sleep:
                wait,
            },
            logger:
              retryLogger,
          });

        await adapter.getNextReadyTask();

        expect(
          mocks.query,
        ).toHaveBeenCalledTimes(
          2,
        );

        expect(
          wait,
        ).toHaveBeenCalledWith(
          5,
        );

        expect(
          retryLogger.warn,
        ).toHaveBeenCalledTimes(
          1,
        );
      },
    );

    it(
      "stops retrying after the configured bound",
      async () => {
        const mocks =
          mockClient();

        mocks.query
          .mockRejectedValue({
            status:
              503,
            code:
              "service_unavailable",
          });

        const wait =
          vi.fn()
            .mockResolvedValue(
              undefined,
            );

        const adapter =
          new NotionTaskSourceAdapter({
            client:
              mocks.client,
            dataSourceId:
              "data-source-id",
            resolveProject:
              vi.fn(),
            retry: {
              maxAttempts:
                3,
              baseDelayMs:
                1,
              maxDelayMs:
                1,
              random:
                () => 0.5,
              sleep:
                wait,
            },
            logger: {
              warn:
                vi.fn(),
            },
          });

        await expect(
          adapter.getNextReadyTask(),
        ).rejects.toMatchObject({
          status:
            503,
        });

        expect(
          mocks.query,
        ).toHaveBeenCalledTimes(
          3,
        );

        expect(
          wait,
        ).toHaveBeenCalledTimes(
          2,
        );
      },
    );
  },
);
