import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { teamMembershipInputSchema } from "@orc/shared";

import {
  TeamMembershipServiceError,
  getTeamMembers,
  replaceTeamMembers,
} from "../services/team-membership.js";

const idParams = z.object({ teamId: z.string().uuid() });

function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, value: unknown): T {
  const parsed = schema.safeParse(value);

  if (!parsed.success) {
    throw new TeamMembershipServiceError(parsed.error.issues.map((issue) => issue.message).join(", "), 400);
  }

  return parsed.data;
}

function sendError(
  error: unknown,
  reply: { status: (code: number) => { send: (body: unknown) => unknown } },
) {
  if (error instanceof TeamMembershipServiceError) {
    return reply.status(error.statusCode).send({ error: error.message });
  }

  throw error;
}

/**
 * Registers the membership-only Team resource (Agent IDs only, no graph
 * placement/routing) alongside the legacy `GET`/`PUT /api/teams/:teamId/workflow`
 * resource, which stays live until the dashboard's Agents tab cuts over.
 */
export async function teamMembershipRoutes(app: FastifyInstance) {
  app.get("/api/teams/:teamId/members", async (request, reply) => {
    try {
      const { teamId } = parse(idParams, request.params);
      const membership = await getTeamMembers(teamId);

      return membership ?? reply.status(404).send({ error: "team_not_found" });
    } catch (error) {
      return sendError(error, reply);
    }
  });

  app.put("/api/teams/:teamId/members", async (request, reply) => {
    try {
      const { teamId } = parse(idParams, request.params);
      const input = parse(teamMembershipInputSchema, request.body);

      return await replaceTeamMembers(teamId, input.agentIds);
    } catch (error) {
      return sendError(error, reply);
    }
  });
}
