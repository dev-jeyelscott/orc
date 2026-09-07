import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type {
  Conversation,
  Project,
  Task,
} from "@orc/shared";

const mocks =
  vi.hoisted(
    () => ({
      getProjectByPath:
        vi.fn(),
      getTask:
        vi.fn(),
      startTask:
        vi.fn(),
      searchKnowledge:
        vi.fn(),
      getKnowledgeSection:
        vi.fn(),
      cancelRun:
        vi.fn(),
      retryLastExecution:
        vi.fn(),
      sendInstructionToExecution:
        vi.fn(),
    }),
  );

vi.mock(
  "./project-discovery.js",
  () => ({
    getProjectByPath:
      mocks.getProjectByPath,
  }),
);

vi.mock(
  "./knowledge-mcp-client.js",
  () => ({
    searchKnowledge:
      mocks.searchKnowledge,
    getKnowledgeSection:
      mocks.getKnowledgeSection,
  }),
);

vi.mock(
  "./workflow-service.js",
  () => ({
    createTask:
      vi.fn(),
    getTask:
      mocks.getTask,
    startTask:
      mocks.startTask,
    getRunDetail:
      vi.fn(),
    cancelRun:
      mocks.cancelRun,
    retryLastExecution:
      mocks.retryLastExecution,
  }),
);

vi.mock(
  "./agent-execution-service.js",
  () => ({
    getExecution:
      vi.fn(),
    sendInstructionToExecution:
      mocks.sendInstructionToExecution,
  }),
);

vi.mock(
  "./event-service.js",
  () => ({
    listRecentRunEvents:
      vi.fn(),
  }),
);

const {
  executeOrchestratorTool,
} =
  await import(
    "./orchestrator-tool-service.js"
  );

const project:
  Project = {
    id:
      "project-id",
    name:
      "orc",
    path:
      "/workspace/orc",
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
      "nextjs",
  };

const conversation:
  Conversation = {
    id:
      "11111111-1111-4111-8111-111111111111",
    teamId:
      "00000000-0000-4000-9000-000000000001",
    projectPath:
      project.path,
    taskId:
      "22222222-2222-4222-8222-222222222222",
    runId:
      null,
    createdAt:
      "2026-09-07T00:00:00.000Z",
    updatedAt:
      "2026-09-07T00:00:00.000Z",
  };

/**
 * Creates one pending Team-scoped task for start_run assertions.
 */
function task():
  Task {
  return {
    id:
      conversation.taskId!,
    teamId:
      conversation.teamId,
    projectPath:
      conversation.projectPath,
    title:
      "Knowledge test",
    instruction:
      "Use selected durable context.",
    status:
      "pending",
    source:
      "manual",
    externalId:
      null,
    externalUrl:
      null,
    priority:
      0,
    createdAt:
      "2026-09-07T00:00:00.000Z",
    updatedAt:
      "2026-09-07T00:00:00.000Z",
  };
}

beforeEach(
  () => {
    for (
      const mock of
      Object.values(
        mocks,
      )
    ) {
      mock.mockReset();
    }

    mocks
      .getProjectByPath
      .mockResolvedValue(
        project,
      );
  },
);

describe(
  "orchestrator durable knowledge integration",
  () => {
    it(
      "uses the current filesystem Project for default knowledge search",
      async () => {
        mocks.searchKnowledge
          .mockResolvedValue({
            source:
              "vault",
            kind:
              "durable_knowledge",
            runtimeAuthoritative:
              false,
            status:
              "ok",
            results: [],
          });

        await executeOrchestratorTool(
          conversation,
          {
            name:
              "search_knowledge",
            arguments: {
              query:
                "workflow",
              area:
                "project",
              scope:
                "default",
              limit:
                5,
            },
          },
        );

        expect(
          mocks.searchKnowledge,
        ).toHaveBeenCalledWith({
          projectName:
            "orc",
          query:
            "workflow",
          area:
            "project",
          scope:
            "default",
          limit:
            5,
        });
      },
    );

    it(
      "rejects exact note paths outside the selected Project and wiki scopes",
      async () => {
        await expect(
          executeOrchestratorTool(
            conversation,
            {
              name:
                "get_knowledge_section",
              arguments: {
                path:
                  "Projects/other/Overview.md",
                maxChars:
                  500,
              },
            },
          ),
        ).rejects.toMatchObject({
          statusCode:
            403,
        });

        expect(
          mocks
            .getKnowledgeSection,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "passes only server-selected knowledge context into startTask",
      async () => {
        const persistedTask =
          task();

        const selected = [
          {
            source:
              "vault" as const,
            path:
              "Projects/orc/Overview.md",
            heading:
              "Architecture",
            excerpt:
              "Durable architecture context.",
          },
        ];

        mocks.getTask
          .mockResolvedValue(
            persistedTask,
          );

        mocks.startTask
          .mockResolvedValue({
            task: {
              ...persistedTask,
              status:
                "running",
            },
            run: {
              id:
                "33333333-3333-4333-8333-333333333333",
              teamId:
                persistedTask.teamId,
              projectPath:
                persistedTask.projectPath,
              taskId:
                persistedTask.id,
              status:
                "running",
              currentAgentId:
                null,
              executionCount:
                0,
              terminalReason:
                null,
              createdAt:
                "2026-09-07T00:00:00.000Z",
              updatedAt:
                "2026-09-07T00:00:00.000Z",
            },
          });

        await executeOrchestratorTool(
          conversation,
          {
            name:
              "start_run",
            arguments: {},
          },
          {
            knowledgeContext:
              selected,
          },
        );

        expect(
          mocks.startTask,
        ).toHaveBeenCalledWith(
          persistedTask.id,
          selected,
        );
      },
    );

    it(
      "treats stale vault status claims as read-only data with no workflow side effects",
      async () => {
        mocks
          .getKnowledgeSection
          .mockResolvedValue({
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
                  "The run is blocked and complete.",
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
                32,
              bytesReturned:
                32,
            },
          });

        const result =
          await executeOrchestratorTool(
            conversation,
            {
              name:
                "get_knowledge_section",
              arguments: {
                path:
                  "Projects/orc/STATE.md",
                maxChars:
                  500,
              },
            },
          );

        expect(
          result.result,
        ).toMatchObject({
          runtimeAuthoritative:
            false,
        });

        expect(
          mocks.cancelRun,
        ).not.toHaveBeenCalled();

        expect(
          mocks.retryLastExecution,
        ).not.toHaveBeenCalled();

        expect(
          mocks.startTask,
        ).not.toHaveBeenCalled();

        expect(
          mocks.sendInstructionToExecution,
        ).not.toHaveBeenCalled();
      },
    );
  },
);
