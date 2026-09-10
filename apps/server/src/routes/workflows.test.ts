import Fastify from "fastify";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks =
  vi.hoisted(
    () => ({
      createAndStartTask:
        vi.fn(),
      listTasks:
        vi.fn(),
      listRuns:
        vi.fn(),
      getRunDetail:
        vi.fn(),
      cancelRun:
        vi.fn(),
      skipRun:
        vi.fn(),
      retryLastExecution:
        vi.fn(),
      listRunMonitoringSummaries:
        vi.fn(),
      getRunMonitoringDetail:
        vi.fn(),
    }),
  );

vi.mock(
  "../services/workflow-service.js",
  () => ({
    WorkflowServiceError:
      class WorkflowServiceError
        extends Error {},
    createAndStartTask:
      mocks.createAndStartTask,
    listTasks:
      mocks.listTasks,
    listRuns:
      mocks.listRuns,
    getRunDetail:
      mocks.getRunDetail,
    cancelRun:
      mocks.cancelRun,
    skipRun:
      mocks.skipRun,
    retryLastExecution:
      mocks.retryLastExecution,
  }),
);

vi.mock(
  "../services/run-monitoring-service.js",
  () => ({
    listRunMonitoringSummaries:
      mocks.listRunMonitoringSummaries,
    getRunMonitoringDetail:
      mocks.getRunMonitoringDetail,
  }),
);

const {
  workflowRoutes,
} =
  await import(
    "./workflows.js"
  );

const TEAM_ID =
  "00000000-0000-4000-9000-000000000001";

let app:
  ReturnType<
    typeof Fastify
  >;

beforeEach(
  async () => {
    for (
      const mock of
      Object.values(
        mocks,
      )
    ) {
      mock.mockReset();
    }

    app =
      Fastify();

    await app.register(
      workflowRoutes,
    );
  },
);

afterEach(
  async () => {
    await app.close();
  },
);

describe(
  "workflow task routes",
  () => {
    it(
      "requires Team scope while preserving POST /api/tasks create-and-immediately-start behavior",
      async () => {
        const taskId =
          crypto.randomUUID();

        const runId =
          crypto.randomUUID();

        mocks.createAndStartTask
          .mockResolvedValue({
            task: {
              id:
                taskId,
              teamId:
                TEAM_ID,
              projectPath:
                "/home/user/workspace/orc",
              title:
                "Manual task",
              instruction:
                "Implement the feature.",
              status:
                "running",
              source:
                "manual",
              externalId:
                null,
              externalUrl:
                null,
              priority:
                0,
              createdAt:
                "2026-09-04T00:00:00.000Z",
              updatedAt:
                "2026-09-04T00:00:00.000Z",
            },
            run: {
              id:
                runId,
              teamId:
                TEAM_ID,
              projectPath:
                "/home/user/workspace/orc",
              taskId,
              status:
                "running",
              currentAgentId:
                null,
              executionCount:
                0,
              terminalReason:
                null,
              createdAt:
                "2026-09-04T00:00:00.000Z",
              updatedAt:
                "2026-09-04T00:00:00.000Z",
            },
          });

        const payload = {
          projectId:
            "existing-project-id",
          teamId:
            TEAM_ID,
          title:
            "Manual task",
          instruction:
            "Implement the feature.",
        };

        const response =
          await app.inject({
            method:
              "POST",
            url:
              "/api/tasks",
            payload,
          });

        expect(
          response.statusCode,
        ).toBe(
          201,
        );

        expect(
          mocks.createAndStartTask,
        ).toHaveBeenCalledWith(
          payload,
        );

        expect(
          response.json(),
        ).toMatchObject({
          task: {
            id:
              taskId,
            teamId:
              TEAM_ID,
            source:
              "manual",
          },
          run: {
            id:
              runId,
            taskId,
            teamId:
              TEAM_ID,
          },
        });
      },
    );

    it(
      "rejects manual Task creation without Team scope",
      async () => {
        const response =
          await app.inject({
            method:
              "POST",
            url:
              "/api/tasks",
            payload: {
              projectId:
                "existing-project-id",
              title:
                "Missing Team",
              instruction:
                "This payload must fail validation.",
            },
          });

        expect(
          response.statusCode,
        ).toBe(
          400,
        );

        expect(
          mocks.createAndStartTask,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "routes a bodyless skip request to the workflow service",
      async () => {
        const runId =
          crypto.randomUUID();

        mocks.skipRun.mockResolvedValue({
          id: runId,
        });

        const response =
          await app.inject({
            method:
              "POST",
            url:
              `/api/runs/${runId}/skip`,
          });

        expect(
          response.statusCode,
        ).toBe(
          200,
        );

        expect(
          mocks.skipRun,
        ).toHaveBeenCalledWith(
          runId,
        );
      },
    );
  },
);

describe(
  "workflow monitoring routes",
  () => {
    it(
      "returns immutable compact Project Document provenance only from detailed Run monitoring",
      async () => {
        const runId =
          crypto.randomUUID();

        const taskId =
          crypto.randomUUID();

        const documentId =
          crypto.randomUUID();

        mocks.getRunMonitoringDetail
          .mockResolvedValue({
            run: {
              id:
                runId,
              taskId,
              teamId:
                TEAM_ID,
              projectPath:
                "/home/user/workspace/orc",
              status:
                "completed",
              currentAgentId:
                null,
              executionCount:
                1,
              terminalReason:
                null,
              createdAt:
                "2026-09-10T00:00:00.000Z",
              updatedAt:
                "2026-09-10T00:05:00.000Z",
            },
            task:
              null,
            executions:
              [],
            events:
              [],
            executionPlan:
              [],
            taskDocumentContext: [
              {
                source:
                  "project_document",
                documentId,
                fileName:
                  "requirements.md",
                documentContentHash:
                  "a".repeat(64),
                chunkSequence:
                  3,
                chunkContentHash:
                  "b".repeat(64),
                heading:
                  "Historical requirements",
              },
            ],
          });

        const response =
          await app.inject({
            method:
              "GET",
            url:
              `/api/runs/${runId}/monitoring`,
          });

        expect(
          response.statusCode,
        ).toBe(
          200,
        );

        expect(
          mocks.getRunMonitoringDetail,
        ).toHaveBeenCalledWith(
          runId,
        );

        expect(
          response.json()
            .taskDocumentContext,
        ).toEqual([
          {
            source:
              "project_document",
            documentId,
            fileName:
              "requirements.md",
            documentContentHash:
              "a".repeat(64),
            chunkSequence:
              3,
            chunkContentHash:
              "b".repeat(64),
            heading:
              "Historical requirements",
          },
        ]);
      },
    );

    it(
      "keeps the monitoring collection response free of detailed context",
      async () => {
        mocks.listRunMonitoringSummaries
          .mockResolvedValue([]);

        const response =
          await app.inject({
            method:
              "GET",
            url:
              "/api/runs/monitoring",
          });

        expect(
          response.statusCode,
        ).toBe(
          200,
        );

        expect(
          response.json(),
        ).toEqual({
          runs: [],
        });

        expect(
          mocks.getRunMonitoringDetail,
        ).not.toHaveBeenCalled();
      },
    );
  },
);
