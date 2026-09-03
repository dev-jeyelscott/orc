import type {
  FastifyInstance,
} from "fastify";
import { z } from "zod";
import {
  createRunSchema,
  startAgentExecutionSchema,
  terminalClientFrameSchema,
  type TerminalFrame,
} from "@orc/shared";

import {
  AgentExecutionServiceError,
  createRun,
  getExecution,
  getLiveProcessMetrics,
  listTerminalChunks,
  resizeLiveExecution,
  sendInstructionToExecution,
  startAgentExecution,
  subscribeToExecutionTerminal,
} from "../services/agent-execution-service.js";

const executionIdParams =
  z.object({
    id:
      z.string().uuid(),
  });

const runIdParams =
  z.object({
    runId:
      z.string().uuid(),
  });

const terminalQuerySchema =
  z.object({
    afterSequence:
      z.coerce
        .number()
        .int()
        .min(0)
        .default(0),
  });

const instructionSchema =
  z
    .object({
      instruction:
        z
          .string()
          .trim()
          .min(1)
          .max(
            20_000,
          ),
    })
    .strict();

/**
 * Validates request data and converts Zod failures into service errors.
 */
function parse<T>(
  schema:
    z.ZodType<T>,
  value: unknown,
): T {
  const parsed =
    schema.safeParse(
      value,
    );

  if (
    !parsed.success
  ) {
    throw new AgentExecutionServiceError(
      parsed.error.issues
        .map(
          (issue) =>
            issue.message,
        )
        .join(", "),
      400,
    );
  }

  return parsed.data;
}

/**
 * Sends known service errors as API responses while preserving unexpected failures.
 */
function sendError(
  error: unknown,
  reply: {
    status: (
      code: number,
    ) => {
      send: (
        body: unknown,
      ) => unknown;
    };
  },
) {
  if (
    error instanceof
    AgentExecutionServiceError
  ) {
    return reply
      .status(
        error.statusCode,
      )
      .send({
        error:
          error.message,
      });
  }

  throw error;
}

/**
 * Sends one server terminal frame when the WebSocket is still open.
 */
function send(
  socket: {
    readyState:
      number;
    send: (
      data: string,
    ) => void;
  },
  frame:
    TerminalFrame,
): boolean {
  if (
    socket.readyState !==
    1
  ) {
    return false;
  }

  socket.send(
    JSON.stringify(
      frame,
    ),
  );

  return true;
}

/**
 * Returns whether an execution has reached an authoritative terminal state.
 */
function isTerminalStatus(
  status: string,
): boolean {
  return [
    "completed",
    "failed",
    "blocked",
    "cancelled",
  ].includes(
    status,
  );
}

/**
 * Registers agent execution HTTP and terminal WebSocket routes.
 */
export async function agentExecutionRoutes(
  app:
    FastifyInstance,
) {
  app.post(
    "/api/runs",
    async (
      request,
      reply,
    ) => {
      try {
        const {
          projectPath,
        } = parse(
          createRunSchema,
          request.body,
        );

        return reply
          .status(201)
          .send(
            await createRun(
              projectPath,
            ),
          );
      } catch (error) {
        return sendError(
          error,
          reply,
        );
      }
    },
  );

  app.post(
    "/api/runs/:runId/agent-executions",
    async (
      request,
      reply,
    ) => {
      try {
        const {
          runId,
        } = parse(
          runIdParams,
          request.params,
        );

        const {
          agentId,
          instruction,
        } = parse(
          startAgentExecutionSchema,
          request.body,
        );

        return reply
          .status(201)
          .send(
            await startAgentExecution(
              runId,
              agentId,
              instruction,
            ),
          );
      } catch (error) {
        return sendError(
          error,
          reply,
        );
      }
    },
  );

  app.get(
    "/api/agent-executions/:id",
    async (
      request,
      reply,
    ) => {
      const {
        id,
      } = parse(
        executionIdParams,
        request.params,
      );

      const execution =
        await getExecution(
          id,
        );

      return (
        execution ??
        reply
          .status(404)
          .send({
            error:
              "agent_execution_not_found",
          })
      );
    },
  );

  app.post(
    "/api/agent-executions/:id/instructions",
    async (
      request,
      reply,
    ) => {
      try {
        const {
          id,
        } = parse(
          executionIdParams,
          request.params,
        );

        const {
          instruction,
        } = parse(
          instructionSchema,
          request.body,
        );

        return await sendInstructionToExecution(
          id,
          instruction,
        );
      } catch (error) {
        return sendError(
          error,
          reply,
        );
      }
    },
  );

  app.get(
    "/api/agent-executions/:id/metrics",
    async (
      request,
    ) => {
      const {
        id,
      } = parse(
        executionIdParams,
        request.params,
      );

      return getLiveProcessMetrics(
        id,
      );
    },
  );

  app.get(
    "/api/agent-executions/:id/terminal",
    {
      websocket:
        true,
    },
    async (
      socket,
      request,
    ) => {
      const parsedParams =
        executionIdParams.safeParse(
          request.params,
        );

      if (
        !parsedParams.success
      ) {
        send(
          socket,
          {
            type:
              "error",
            error:
              "invalid_execution_id",
          },
        );
        socket.close(
          1008,
          "invalid_execution_id",
        );
        return;
      }

      const parsedQuery =
        terminalQuerySchema.safeParse(
          request.query,
        );

      if (
        !parsedQuery.success
      ) {
        send(
          socket,
          {
            type:
              "error",
            error:
              "invalid_terminal_cursor",
          },
        );
        socket.close(
          1008,
          "invalid_terminal_cursor",
        );
        return;
      }

      const executionId =
        parsedParams.data.id;

      const subscription: {
        unsubscribe?: () => void;
      } = {};

      socket.on(
        "close",
        () => {
          subscription.unsubscribe?.();
        },
      );

      socket.on(
        "message",
        (
          message: {
            toString(): string;
          },
        ) => {
          let payload:
            unknown;

          try {
            payload =
              JSON.parse(
                message.toString(),
              );
          } catch {
            send(
              socket,
              {
                type:
                  "error",
                error:
                  "invalid_terminal_frame",
              },
            );
            socket.close(
              1008,
              "invalid_terminal_frame",
            );
            return;
          }

          const parsedFrame =
            terminalClientFrameSchema.safeParse(
              payload,
            );

          if (
            !parsedFrame.success
          ) {
            send(
              socket,
              {
                type:
                  "error",
                error:
                  "invalid_terminal_frame",
              },
            );
            socket.close(
              1008,
              "invalid_terminal_frame",
            );
            return;
          }

          if (
            parsedFrame.data
              .type ===
            "resize"
          ) {
            resizeLiveExecution(
              executionId,
              parsedFrame.data
                .cols,
              parsedFrame.data
                .rows,
            );
          }
        },
      );

      const execution =
        await getExecution(
          executionId,
        );

      if (!execution) {
        send(
          socket,
          {
            type:
              "error",
            error:
              "execution_not_found",
          },
        );
        socket.close(
          1008,
          "execution_not_found",
        );
        return;
      }

      if (
        socket.readyState !==
        1
      ) {
        return;
      }

      const {
        afterSequence,
      } =
        parsedQuery.data;

      const bufferedFrames:
        TerminalFrame[] =
        [];

      let replaying =
        true;
      let completeSent =
        false;
      let lastSequenceSent =
        afterSequence;

      /**
       * Delivers one frame while suppressing terminal chunks already represented by the cursor.
       */
      const deliverFrame =
        (
          frame:
            TerminalFrame,
        ): void => {
          if (
            socket.readyState !==
              1 ||
            completeSent
          ) {
            return;
          }

          if (
            frame.type ===
            "chunk"
          ) {
            if (
              frame.sequence <=
              lastSequenceSent
            ) {
              return;
            }

            if (
              send(
                socket,
                frame,
              )
            ) {
              lastSequenceSent =
                frame.sequence;
            }

            return;
          }

          if (
            frame.type ===
            "complete"
          ) {
            completeSent =
              true;
            send(
              socket,
              frame,
            );
            socket.close(
              1000,
              "complete",
            );
            return;
          }

          send(
            socket,
            frame,
          );
        };

      subscription.unsubscribe =
        subscribeToExecutionTerminal(
          executionId,
          (
            frame,
          ) => {
            if (
              replaying
            ) {
              bufferedFrames.push(
                frame,
              );
              return;
            }

            deliverFrame(
              frame,
            );
          },
        );

      const chunks =
        await listTerminalChunks(
          executionId,
          afterSequence,
        );

      for (
        const chunk of chunks
      ) {
        deliverFrame({
          type:
            "chunk",
          sequence:
            chunk.sequence,
          data:
            chunk.data,
        });
      }

      replaying =
        false;

      for (
        const frame of bufferedFrames
      ) {
        deliverFrame(
          frame,
        );

        if (
          completeSent
        ) {
          break;
        }
      }

      if (
        !subscription.unsubscribe &&
        !completeSent &&
        socket.readyState ===
          1
      ) {
        const latestExecution =
          await getExecution(
            executionId,
          );

        if (
          latestExecution &&
          isTerminalStatus(
            latestExecution.status,
          )
        ) {
          deliverFrame({
            type:
              "complete",
            exitCode:
              latestExecution.exitCode,
            status:
              latestExecution.status,
          });
          return;
        }

        send(
          socket,
          {
            type:
              "error",
            error:
              "execution_not_live",
          },
        );
        socket.close(
          1011,
          "execution_not_live",
        );
      }
    },
  );
}
