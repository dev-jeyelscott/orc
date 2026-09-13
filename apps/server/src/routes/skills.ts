import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createSkillSchema, updateSkillSchema } from "@orc/shared";
import { SkillServiceError, createSkill, deleteSkill, getSkill, listSkills, updateSkill } from "../services/skill-service.js";

const idParams = z.object({ skillId: z.string().uuid() });
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new SkillServiceError(parsed.error.issues.map((issue) => issue.message).join(", "), 400);
  return parsed.data;
}
function sendError(error: unknown, reply: { status: (code: number) => { send: (body: unknown) => unknown } }) {
  if (error instanceof SkillServiceError) return reply.status(error.statusCode).send({ error: error.message });
  throw error;
}

/** Registers generic reusable Skill configuration endpoints. */
export async function skillRoutes(app: FastifyInstance) {
  app.get("/api/skills", async () => ({ skills: await listSkills() }));
  app.get("/api/skills/:skillId", async (request, reply) => (await getSkill(parse(idParams, request.params).skillId)) ?? reply.status(404).send({ error: "skill_not_found" }));
  app.post("/api/skills", async (request, reply) => { try { const input = parse(createSkillSchema, request.body); return reply.status(201).send(await createSkill({ ...input, description: input.description ?? "", enabled: input.enabled ?? true })); } catch (error) { return sendError(error, reply); } });
  app.patch("/api/skills/:skillId", async (request, reply) => { try { const skill = await updateSkill(parse(idParams, request.params).skillId, parse(updateSkillSchema, request.body)); return skill ?? reply.status(404).send({ error: "skill_not_found" }); } catch (error) { return sendError(error, reply); } });
  app.delete("/api/skills/:skillId", async (request, reply) => { try { return await deleteSkill(parse(idParams, request.params).skillId) ? reply.status(204).send() : reply.status(404).send({ error: "skill_not_found" }); } catch (error) { return sendError(error, reply); } });
}
