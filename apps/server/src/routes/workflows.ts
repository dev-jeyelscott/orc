import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createTaskSchema, retryRunSchema } from "@orc/shared";

import { WorkflowServiceError, cancelRun, createAndStartTask, getRunDetail, listRuns, listTasks, retryLastExecution } from "../services/workflow-service.js";

const idParams = z.object({ id: z.string().uuid() });

function sendError(error: unknown, reply: { status: (code: number) => { send: (body: unknown) => unknown } }) {
  if (error instanceof WorkflowServiceError) return reply.status(error.statusCode).send({ error: error.message });
  throw error;
}

export async function workflowRoutes(app: FastifyInstance) {
  app.post("/api/tasks", async (request, reply) => {
    const parsed = createTaskSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues.map((issue) => issue.message).join(", ") });
    try { return reply.status(201).send(await createAndStartTask(parsed.data)); } catch (error) { return sendError(error, reply); }
  });
  app.get("/api/tasks", async () => ({ tasks: await listTasks() }));
  app.get("/api/runs", async () => ({ runs: await listRuns() }));
  app.get("/api/runs/:id", async (request, reply) => {
    const parsed = idParams.safeParse(request.params);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_run_id" });
    const result = await getRunDetail(parsed.data.id);
    return result ?? reply.status(404).send({ error: "run_not_found" });
  });
  app.post("/api/runs/:id/cancel", async (request, reply) => {
    const parsed = idParams.safeParse(request.params);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_run_id" });
    try {
      const run = await cancelRun(parsed.data.id);
      return run ?? reply.status(404).send({ error: "run_not_found" });
    } catch (error) { return sendError(error, reply); }
  });
  app.post("/api/runs/:id/retry", async (request, reply) => {
    const parsed = idParams.safeParse(request.params);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_run_id" });
    const body = retryRunSchema.safeParse(request.body ?? {});
    if (!body.success) return reply.status(400).send({ error: body.error.issues.map((issue) => issue.message).join(", ") });
    try {
      const run = await retryLastExecution(parsed.data.id, body.data);
      return run ?? reply.status(404).send({ error: "run_not_found" });
    } catch (error) { return sendError(error, reply); }
  });
}
