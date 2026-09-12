import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  createDepartmentSchema,
  updateDepartmentSchema,
} from "@orc/shared";

import {
  DepartmentServiceError,
  createDepartment,
  deleteDepartment,
  getDepartment,
  listDepartments,
  updateDepartment,
} from "../services/department-service.js";

const idParams = z.object({ departmentId: z.string().uuid() });

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);

  if (!parsed.success) {
    throw new DepartmentServiceError(
      parsed.error.issues.map((issue) => issue.message).join(", "),
      400,
    );
  }

  return parsed.data;
}

function sendError(
  error: unknown,
  reply: { status: (code: number) => { send: (body: unknown) => unknown } },
) {
  if (error instanceof DepartmentServiceError) {
    return reply.status(error.statusCode).send({ error: error.message });
  }

  throw error;
}

/** Registers generic Department CRUD endpoints. */
export async function departmentRoutes(app: FastifyInstance) {
  app.get("/api/departments", async () => ({
    departments: await listDepartments(),
  }));

  app.get("/api/departments/:departmentId", async (request, reply) => {
    const { departmentId } = parse(idParams, request.params);
    const department = await getDepartment(departmentId);

    return department ?? reply.status(404).send({ error: "department_not_found" });
  });

  app.post("/api/departments", async (request, reply) => {
    try {
      const input = parse(createDepartmentSchema, request.body);

      return reply.status(201).send(await createDepartment({
        ...input,
        description: input.description ?? "",
        enabled: input.enabled ?? true,
        canWrite: input.canWrite ?? false,
        canRunCommands: input.canRunCommands ?? false,
        canCommit: input.canCommit ?? false,
      }));
    } catch (error) {
      return sendError(error, reply);
    }
  });

  app.patch("/api/departments/:departmentId", async (request, reply) => {
    try {
      const { departmentId } = parse(idParams, request.params);
      const department = await updateDepartment(
        departmentId,
        parse(updateDepartmentSchema, request.body),
      );

      return department ?? reply.status(404).send({ error: "department_not_found" });
    } catch (error) {
      return sendError(error, reply);
    }
  });

  app.delete("/api/departments/:departmentId", async (request, reply) => {
    try {
      const { departmentId } = parse(idParams, request.params);
      const deleted = await deleteDepartment(departmentId);

      return deleted
        ? reply.status(204).send()
        : reply.status(404).send({ error: "department_not_found" });
    } catch (error) {
      return sendError(error, reply);
    }
  });
}
