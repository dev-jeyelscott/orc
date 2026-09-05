import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type {
  AgentExecution,
  Conversation,
  Project,
  RunDetail,
  Task,
} from "@orc/shared";

import {
  DEVELOPMENT_TEAM_ID,
  RESOLUTION_TEAM_ID,
} from "../db/seed-ids.js";

const mocks =
  vi.hoisted(
    () => ({
      getProjectByPath:
        vi.fn(),
      createTask:
        vi.fn(),
      getTask:
        vi.fn(),
      startTask:
        vi.fn(),
      getRunDetail:
        vi.fn(),
      cancelRun:
        vi.fn(),
      retryLastExecution:
        vi.fn(),
      getExecution:
        vi.fn(),
      sendInstructionToExecution:
        vi.fn(),
      listRecentRunEvents:
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
  "./workflow-service.js",
  () => ({
    createTask:
      mocks.createTask,
    getTask:
      mocks.getTask,
    startTask:
      mocks.startTask,
    getRunDetail:
      mocks.getRunDetail,
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
      mocks.getExecution,
    sendInstructionToExecution:
      mocks.sendInstructionToExecution,
  }),
);

vi.mock(
  "./event-service.js",
  () => ({
    listRecentRunEvents:
      mocks.listRecentRunEvents,
  }),
);

const {
  OrchestratorToolServiceError,
  executeOrchestratorTool,
} =
  await import(
    "./orchestrator-tool-service.js"
  );

/**
 * Creates the Project used by dispatcher tests.
 */
function project(): Project {
  return {
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
}

/**
 * Creates a persisted Team-scoped Conversation context for dispatcher tests.
 */
function conversation(
  teamId:
    string = RESOLUTION_TEAM_ID,
): Conversation {
  return {
    id:
      crypto.randomUUID(),
    teamId,
    projectPath:
      "/workspace/orc",
    taskId:
      null,
    runId:
      null,
    createdAt:
      new Date().toISOString(),
    updatedAt:
      new Date().toISOString(),
  };
}

/**
 * Creates one manual Task tied to a specified Project and Team.
 */
function task(
  id:
    string = crypto.randomUUID(),
  teamId:
    string = RESOLUTION_TEAM_ID,
  projectPath:
    string = "/workspace/orc",
): Task {
  return {
    id,
    teamId,
    projectPath,
    title:
      "Test task",
    instruction:
      "Implement test",
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
      new Date().toISOString(),
    updatedAt:
      new Date().toISOString(),
  };
}

/**
 * Creates a persisted execution used by execution-oriented tool tests.
 */
function execution(
  runId:
    string,
): AgentExecution {
  return {
    id:
      crypto.randomUUID(),
    runId,
    agentId:
      crypto.randomUUID(),
    agentName:
      "Builder",
    agentRole:
      "Implementation",
    layer:
      2,
    executionOrder:
      1,
    harness:
      "claude",
    model:
      "default",
    reasoning:
      "medium",
    status:
      "failed",
    pid:
      null,
    startedAt:
      new Date().toISOString(),
    completedAt:
      new Date().toISOString(),
    exitCode:
      1,
    resultStatus:
      "failed",
    resultPayload: {
      status:
        "failed",
      summary:
        "Validation failed",
      details: {},
      findings: [],
      filesChanged: [],
      commandsRun: [],
      validation: {},
      commit:
        null,
    },
    tokenUsage:
      null,
    contextUsage:
      null,
    commitHash:
      null,
    failureReason:
      "Validation failed",
    repairAttempted:
      false,
    createdAt:
      new Date().toISOString(),
    updatedAt:
      new Date().toISOString(),
  };
}

/**
 * Creates minimal Team-scoped Run detail used by dispatcher authorization checks.
 */
function runDetail(
  runId:
    string,
  executions:
    AgentExecution[] = [],
  projectPath:
    string = "/workspace/orc",
  teamId:
    string = RESOLUTION_TEAM_ID,
  linkedTask:
    Task | null = null,
): RunDetail {
  return {
    run: {
      id:
        runId,
      teamId,
      projectPath,
      taskId:
        linkedTask?.id ??
        null,
      status:
        "failed",
      currentAgentId:
        null,
      executionCount:
        executions.length,
      terminalReason:
        "Failed",
      createdAt:
        new Date().toISOString(),
      updatedAt:
        new Date().toISOString(),
    },
    task:
      linkedTask,
    executions,
    events: [],
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

    mocks.getProjectByPath.mockResolvedValue(
      project(),
    );
  },
);

describe(
  "orchestrator-tool-service",
  () => {
    it(
      "creates a pending Task using the persisted Conversation Team without exposing Team to the model",
      async () => {
        const created =
          task();

        mocks.createTask.mockResolvedValue(
          created,
        );

        const current =
          conversation();

        const result =
          await executeOrchestratorTool(
            current,
            {
              name:
                "create_task",
              arguments: {
                title:
                  "Test task",
                instruction:
                  "Implement test",
              },
            },
          );

        expect(
          mocks.createTask,
        ).toHaveBeenCalledWith({
          projectId:
            "project-id",
          teamId:
            current.teamId,
          title:
            "Test task",
          instruction:
            "Implement test",
        });

        expect(
          mocks.startTask,
        ).not.toHaveBeenCalled();

        expect(
          result.references,
        ).toEqual({
          taskId:
            created.id,
          runId:
            null,
        });
      },
    );

    it(
      "rejects a Task from the same Project but a different Team",
      async () => {
        const persistedTask =
          task(
            crypto.randomUUID(),
            DEVELOPMENT_TEAM_ID,
          );

        mocks.getTask.mockResolvedValue(
          persistedTask,
        );

        await expect(
          executeOrchestratorTool(
            conversation(),
            {
              name:
                "get_task",
              arguments: {
                taskId:
                  persistedTask.id,
              },
            },
          ),
        ).rejects.toMatchObject({
          statusCode:
            403,
        });
      },
    );

    it(
      "starts an existing same-Team pending Task through the workflow service",
      async () => {
        const persistedTask =
          task();

        const runId =
          crypto.randomUUID();

        mocks.getTask.mockResolvedValue(
          persistedTask,
        );

        mocks.startTask.mockResolvedValue({
          task: {
            ...persistedTask,
            status:
              "running",
          },
          run: {
            id:
              runId,
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
              new Date().toISOString(),
            updatedAt:
              new Date().toISOString(),
          },
        });

        const current =
          conversation();

        current.taskId =
          persistedTask.id;

        const result =
          await executeOrchestratorTool(
            current,
            {
              name:
                "start_run",
              arguments: {},
            },
          );

        expect(
          mocks.startTask,
        ).toHaveBeenCalledWith(
          persistedTask.id,
        );

        expect(
          result.references,
        ).toEqual({
          taskId:
            persistedTask.id,
          runId,
        });
      },
    );

    it(
      "rejects a Run from the same Project but a different Team",
      async () => {
        const runId =
          crypto.randomUUID();

        mocks.getRunDetail.mockResolvedValue(
          runDetail(
            runId,
            [],
            "/workspace/orc",
            DEVELOPMENT_TEAM_ID,
          ),
        );

        await expect(
          executeOrchestratorTool(
            conversation(),
            {
              name:
                "get_run",
              arguments: {
                runId,
              },
            },
          ),
        ).rejects.toMatchObject({
          statusCode:
            403,
        });
      },
    );

    it(
      "rejects a Run whose linked Task has inconsistent Project or Team scope",
      async () => {
        const runId =
          crypto.randomUUID();

        const linkedTask =
          task(
            crypto.randomUUID(),
            DEVELOPMENT_TEAM_ID,
          );

        mocks.getRunDetail.mockResolvedValue(
          runDetail(
            runId,
            [],
            "/workspace/orc",
            RESOLUTION_TEAM_ID,
            linkedTask,
          ),
        );

        await expect(
          executeOrchestratorTool(
            conversation(),
            {
              name:
                "get_run",
              arguments: {
                runId,
              },
            },
          ),
        ).rejects.toMatchObject({
          statusCode:
            409,
        });
      },
    );

    it(
      "returns structured execution results without reading terminal data",
      async () => {
        const runId =
          crypto.randomUUID();

        const persistedExecution =
          execution(
            runId,
          );

        mocks.getExecution.mockResolvedValue(
          persistedExecution,
        );

        mocks.getRunDetail.mockResolvedValue(
          runDetail(
            runId,
            [
              persistedExecution,
            ],
          ),
        );

        const result =
          await executeOrchestratorTool(
            conversation(),
            {
              name:
                "get_agent_execution",
              arguments: {
                executionId:
                  persistedExecution.id,
              },
            },
          );

        expect(
          result.result,
        ).toEqual(
          persistedExecution,
        );
      },
    );

    it(
      "returns recent events only for the verified Conversation Run",
      async () => {
        const runId =
          crypto.randomUUID();

        mocks.getRunDetail.mockResolvedValue(
          runDetail(
            runId,
          ),
        );

        mocks.listRecentRunEvents.mockResolvedValue(
          [],
        );

        await executeOrchestratorTool(
          conversation(),
          {
            name:
              "get_recent_events",
            arguments: {
              runId,
              limit:
                10,
            },
          },
        );

        expect(
          mocks.listRecentRunEvents,
        ).toHaveBeenCalledWith(
          runId,
          10,
        );
      },
    );

    it(
      "rejects execution access when its Run belongs to another Project",
      async () => {
        const runId =
          crypto.randomUUID();

        const persistedExecution =
          execution(
            runId,
          );

        mocks.getExecution.mockResolvedValue(
          persistedExecution,
        );

        mocks.getRunDetail.mockResolvedValue(
          runDetail(
            runId,
            [
              persistedExecution,
            ],
            "/workspace/other",
          ),
        );

        await expect(
          executeOrchestratorTool(
            conversation(),
            {
              name:
                "get_agent_execution",
              arguments: {
                executionId:
                  persistedExecution.id,
              },
            },
          ),
        ).rejects.toBeInstanceOf(
          OrchestratorToolServiceError,
        );
      },
    );

    it(
      "delegates Stop through the existing verified workflow cancellation service",
      async () => {
        const runId =
          crypto.randomUUID();

        const detail =
          runDetail(
            runId,
          );

        mocks.getRunDetail.mockResolvedValue(
          detail,
        );

        mocks.cancelRun.mockResolvedValue(
          detail.run,
        );

        await executeOrchestratorTool(
          conversation(),
          {
            name:
              "stop_run",
            arguments: {
              runId,
            },
          },
        );

        expect(
          mocks.cancelRun,
        ).toHaveBeenCalledWith(
          runId,
        );
      },
    );

    it(
      "retries only the execution that is latest for its verified failed or blocked Run",
      async () => {
        const runId =
          crypto.randomUUID();

        const persistedExecution =
          execution(
            runId,
          );

        mocks.getExecution.mockResolvedValue(
          persistedExecution,
        );

        const detail =
          runDetail(
            runId,
            [
              persistedExecution,
            ],
          );

        mocks.getRunDetail.mockResolvedValue(
          detail,
        );

        mocks.retryLastExecution.mockResolvedValue(
          detail.run,
        );

        await executeOrchestratorTool(
          conversation(),
          {
            name:
              "retry_execution",
            arguments: {
              executionId:
                persistedExecution.id,
            },
          },
        );

        expect(
          mocks.retryLastExecution,
        ).toHaveBeenCalledWith(
          runId,
        );
      },
    );

    it(
      "returns an explicit unsupported instruction result without pretending delivery succeeded",
      async () => {
        const runId =
          crypto.randomUUID();

        const persistedExecution =
          execution(
            runId,
          );

        mocks.getExecution.mockResolvedValue(
          persistedExecution,
        );

        mocks.getRunDetail.mockResolvedValue(
          runDetail(
            runId,
            [
              persistedExecution,
            ],
          ),
        );

        mocks.sendInstructionToExecution.mockResolvedValue({
          supported:
            false,
          delivered:
            false,
          reason:
            "The active harness invocation does not support additional instructions.",
        });

        const result =
          await executeOrchestratorTool(
            conversation(),
            {
              name:
                "send_instruction",
              arguments: {
                executionId:
                  persistedExecution.id,
                instruction:
                  "Please run the focused test.",
              },
            },
          );

        expect(
          result.result,
        ).toMatchObject({
          supported:
            false,
          delivered:
            false,
        });
      },
    );
  },
);
