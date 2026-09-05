import type {
  Conversation,
  OrchestratorToolCall,
  Project,
} from "@orc/shared";

import { env } from "../config/env.js";
import {
  getExecution,
  sendInstructionToExecution,
} from "./agent-execution-service.js";
import {
  listRecentRunEvents,
} from "./event-service.js";
import {
  getProjectByPath,
} from "./project-discovery.js";
import {
  cancelRun,
  createTask,
  getRunDetail,
  getTask,
  retryLastExecution,
  startTask,
} from "./workflow-service.js";

export class OrchestratorToolServiceError extends Error {
  /**
   * Creates a typed orchestrator tool error with an HTTP-compatible status.
   */
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}

export type OrchestratorToolExecution = {
  result:
    unknown;
  references?: {
    taskId?:
      | string
      | null;
    runId?:
      | string
      | null;
  };
};

/**
 * Resolves the Conversation Project through current filesystem discovery.
 */
async function requireCurrentProject(
  conversation:
    Conversation,
): Promise<Project> {
  const project =
    await getProjectByPath(
      env.WORKSPACE_ROOT,
      conversation.projectPath,
    );

  if (!project) {
    throw new OrchestratorToolServiceError(
      "The selected project is no longer available",
      404,
    );
  }

  return project;
}

/**
 * Resolves a Task and verifies that both Project and Team match the persisted Conversation scope.
 */
async function requireTask(
  conversation:
    Conversation,
  taskId:
    | string
    | null
    | undefined,
) {
  if (!taskId) {
    throw new OrchestratorToolServiceError(
      "No task is associated with this conversation",
      400,
    );
  }

  const task =
    await getTask(
      taskId,
    );

  if (!task) {
    throw new OrchestratorToolServiceError(
      "The task does not exist",
      404,
    );
  }

  if (
    task.projectPath !==
      conversation.projectPath ||
    task.teamId !==
      conversation.teamId
  ) {
    throw new OrchestratorToolServiceError(
      "The task does not belong to this conversation project and team",
      403,
    );
  }

  return task;
}

/**
 * Resolves a Run and verifies its Project, Team, and linked Task remain internally consistent with Conversation scope.
 */
async function requireRun(
  conversation:
    Conversation,
  runId:
    | string
    | null
    | undefined,
) {
  if (!runId) {
    throw new OrchestratorToolServiceError(
      "No run is associated with this conversation",
      400,
    );
  }

  const detail =
    await getRunDetail(
      runId,
    );

  if (!detail) {
    throw new OrchestratorToolServiceError(
      "The run does not exist",
      404,
    );
  }

  if (
    detail.run.projectPath !==
      conversation.projectPath ||
    detail.run.teamId !==
      conversation.teamId
  ) {
    throw new OrchestratorToolServiceError(
      "The run does not belong to this conversation project and team",
      403,
    );
  }

  if (
    detail.run.taskId &&
    !detail.task
  ) {
    throw new OrchestratorToolServiceError(
      "The run's linked task is unavailable",
      409,
    );
  }

  if (
    detail.task &&
    (
      detail.task.projectPath !==
        detail.run.projectPath ||
      detail.task.teamId !==
        detail.run.teamId
    )
  ) {
    throw new OrchestratorToolServiceError(
      "The run and linked task have inconsistent project or team scope",
      409,
    );
  }

  return detail;
}

/**
 * Resolves an execution together with its verified Project and Team scoped Run detail.
 */
async function requireExecution(
  conversation:
    Conversation,
  executionId:
    string,
) {
  const execution =
    await getExecution(
      executionId,
    );

  if (!execution) {
    throw new OrchestratorToolServiceError(
      "The agent execution does not exist",
      404,
    );
  }

  const runDetail =
    await requireRun(
      conversation,
      execution.runId,
    );

  return {
    execution,
    runDetail,
  };
}

/**
 * Executes one validated orchestrator tool call against authoritative system services.
 */
export async function executeOrchestratorTool(
  conversation:
    Conversation,
  tool:
    OrchestratorToolCall,
): Promise<OrchestratorToolExecution> {
  switch (tool.name) {
    case "get_project": {
      const project =
        await requireCurrentProject(
          conversation,
        );

      return {
        result:
          project,
      };
    }

    case "get_task": {
      const task =
        await requireTask(
          conversation,
          tool.arguments
            .taskId ??
            conversation.taskId,
        );

      return {
        result:
          task,
      };
    }

    case "create_task": {
      const project =
        await requireCurrentProject(
          conversation,
        );

      const task =
        await createTask({
          projectId:
            project.id,
          teamId:
            conversation.teamId,
          title:
            tool.arguments
              .title,
          instruction:
            tool.arguments
              .instruction,
        });

      return {
        result:
          task,
        references: {
          taskId:
            task.id,
          runId:
            null,
        },
      };
    }

    case "start_run": {
      const task =
        await requireTask(
          conversation,
          tool.arguments
            .taskId ??
            conversation.taskId,
        );

      const started =
        await startTask(
          task.id,
        );

      if (!started) {
        throw new OrchestratorToolServiceError(
          "The task no longer exists",
          404,
        );
      }

      return {
        result:
          started,
        references: {
          taskId:
            started.task.id,
          runId:
            started.run.id,
        },
      };
    }

    case "get_run": {
      const detail =
        await requireRun(
          conversation,
          tool.arguments
            .runId ??
            conversation.runId,
        );

      return {
        result:
          detail,
      };
    }

    case "get_agent_execution": {
      const {
        execution,
      } =
        await requireExecution(
          conversation,
          tool.arguments
            .executionId,
        );

      return {
        result:
          execution,
      };
    }

    case "get_recent_events": {
      const detail =
        await requireRun(
          conversation,
          tool.arguments
            .runId ??
            conversation.runId,
        );

      const events =
        await listRecentRunEvents(
          detail.run.id,
          tool.arguments
            .limit,
        );

      return {
        result: {
          runId:
            detail.run.id,
          events,
        },
      };
    }

    case "send_instruction": {
      const {
        execution,
      } =
        await requireExecution(
          conversation,
          tool.arguments
            .executionId,
        );

      const delivery =
        await sendInstructionToExecution(
          execution.id,
          tool.arguments
            .instruction,
        );

      return {
        result: {
          executionId:
            execution.id,
          ...delivery,
        },
      };
    }

    case "stop_run": {
      const detail =
        await requireRun(
          conversation,
          tool.arguments
            .runId ??
            conversation.runId,
        );

      const run =
        await cancelRun(
          detail.run.id,
        );

      if (!run) {
        throw new OrchestratorToolServiceError(
          "The run no longer exists",
          404,
        );
      }

      return {
        result:
          run,
      };
    }

    case "retry_execution": {
      const {
        execution,
        runDetail,
      } =
        await requireExecution(
          conversation,
          tool.arguments
            .executionId,
        );

      const latestExecution =
        runDetail.executions.at(
          -1,
        );

      if (
        !latestExecution ||
        latestExecution.id !==
          execution.id
      ) {
        throw new OrchestratorToolServiceError(
          "Only the latest execution of a failed or blocked run can be retried",
          409,
        );
      }

      const run =
        await retryLastExecution(
          execution.runId,
        );

      if (!run) {
        throw new OrchestratorToolServiceError(
          "The run no longer exists",
          404,
        );
      }

      return {
        result:
          run,
      };
    }
  }
}
