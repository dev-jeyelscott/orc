import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createRunSchema, startAgentExecutionSchema, type TerminalFrame } from "@orc/shared";

import {
  AgentExecutionServiceError,
  attachLiveSession,
  createRun,
  getExecution,
  listTerminalChunks,
  getLiveProcessMetrics,
  startAgentExecution,
} from "../services/agent-execution-service.js";

const executionIdParams = z.object({ id: z.string().uuid() });
const runIdParams = z.object({ runId: z.string().uuid() });

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new AgentExecutionServiceError(parsed.error.issues.map((issue) => issue.message).join(", "), 400);
  return parsed.data;
}

function sendError(error: unknown, reply: { status: (code: number) => { send: (body: unknown) => unknown } }) {
  if (error instanceof AgentExecutionServiceError) return reply.status(error.statusCode).send({ error: error.message });
  throw error;
}

function send(socket: { send: (data: string) => void }, frame: TerminalFrame) {
  socket.send(JSON.stringify(frame));
}

export async function agentExecutionRoutes(app: FastifyInstance) {
  // Throwaway trigger endpoints for exercising the runtime + persistence bridge end to end.
  // These will be replaced once the Phase 7 workflow engine drives execution ordering and
  // routing instead of a client explicitly starting one agent execution at a time.
  app.post("/api/runs", async (request, reply) => {
    try {
      const { projectPath } = parse(createRunSchema, request.body);
      return reply.status(201).send(await createRun(projectPath));
    } catch (error) {
      return sendError(error, reply);
    }
  });

  app.post("/api/runs/:runId/agent-executions", async (request, reply) => {
    try {
      const { runId } = parse(runIdParams, request.params);
      const { agentId, instruction } = parse(startAgentExecutionSchema, request.body);
      return reply.status(201).send(await startAgentExecution(runId, agentId, instruction));
    } catch (error) {
      return sendError(error, reply);
    }
  });

  // Not part of the throwaway trigger endpoints above -- this is a plain read used by the
  // dashboard's execution detail view to render metadata alongside the terminal stream.
  app.get("/api/agent-executions/:id", async (request, reply) => {
    const { id } = parse(executionIdParams, request.params);
    const execution = await getExecution(id);
    return execution ?? reply.status(404).send({ error: "agent_execution_not_found" });
  });
  app.get("/api/agent-executions/:id/metrics", async (request) => { const { id } = parse(executionIdParams, request.params); return getLiveProcessMetrics(id); });

  app.get("/api/agent-executions/:id/terminal", { websocket: true }, async (socket, request) => {
    const parsedParams = executionIdParams.safeParse(request.params);
    if (!parsedParams.success) {
      send(socket, { type: "error", error: "invalid_execution_id" });
      socket.close(1008, "invalid_execution_id");
      return;
    }

    const execution = await getExecution(parsedParams.data.id);
    if (!execution) {
      send(socket, { type: "error", error: "execution_not_found" });
      socket.close(1008, "execution_not_found");
      return;
    }

    const chunks = await listTerminalChunks(execution.id);
    let lastSequenceSent = 0;
    for (const chunk of chunks) {
      send(socket, { type: "chunk", sequence: chunk.sequence, data: chunk.data });
      lastSequenceSent = chunk.sequence;
    }

    const session = attachLiveSession(execution.id);
    const isLive = session && ["starting", "running", "stopping"].includes(session.metadata.state);

    let unsubscribe: (() => void) | undefined;
    if (isLive && session) {
      unsubscribe = session.subscribe((event) => {
        // Guard against re-delivering events already streamed from the persisted history above.
        if (event.sequence <= lastSequenceSent) return;
        if (event.type === "output") {
          send(socket, { type: "chunk", sequence: event.sequence, data: event.data });
        } else if (event.type === "exit") {
          send(socket, { type: "complete", exitCode: event.exitCode, status: event.exitCode === 0 ? "completed" : "failed" });
          socket.close(1000, "complete");
        }
      });
    } else {
      send(socket, { type: "complete", exitCode: execution.exitCode, status: execution.status });
      socket.close(1000, "complete");
    }

    socket.on("close", () => unsubscribe?.());

    // No client-to-server input handling yet. Keeping the message handler in place reserves the
    // dispatch shape for future `resize`/`input` frames without changing the connection contract.
    socket.on("message", () => {
      // Intentionally unhandled for now.
    });
  });
}
