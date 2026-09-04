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

let app:
  ReturnType<
    typeof Fastify
  >;

beforeEach(
  async () => {
    mocks.createAndStartTask
      .mockReset();

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
      "preserves the existing POST /api/tasks create-and-immediately-start contract",
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
            source:
              "manual",
          },
          run: {
            id:
              runId,
            taskId,
          },
        });
      },
    );
  },
);
