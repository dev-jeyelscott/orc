import type {
  FastifyInstance,
} from "fastify";
import {
  z,
} from "zod";

import {
  teamWorkflowInputSchema,
} from "@orc/shared";

import {
  TeamWorkflowServiceError,
  getTeamWorkflow,
  replaceTeamWorkflow,
} from "../services/team-workflow-service.js";

const idParams =
  z.object({
    teamId:
      z.string().uuid(),
  });

/**
 * Parses and validates Team workflow route data with a supplied Zod schema.
 */
function parse<T>(
  schema: z.ZodType<T, z.ZodTypeDef, any>,
  value: unknown,
): T {
  const parsed = schema.safeParse(value);

  if (!parsed.success) {
    throw new TeamWorkflowServiceError(
      parsed.error.issues.map((issue) => issue.message).join(", "),
      400,
    );
  }

  return parsed.data;
}

/**
 * Converts known Team workflow service errors into stable API responses.
 */
function sendError(
  error: unknown,
  reply: {
    status: (code: number) => {
      send: (body: unknown) => unknown;
    };
  },
) {
  if (error instanceof TeamWorkflowServiceError) {
    return reply.status(error.statusCode).send({ error: error.message });
  }

  throw error;
}

/**
 * Registers the atomic Team workflow resource: the authoritative source of
 * Team composition, layer/order placement, and outcome routing.
 */
export async function teamWorkflowRoutes(app: FastifyInstance) {
  app.get("/api/teams/:teamId/workflow", async (request, reply) => {
    try {
      const { teamId } = parse(idParams, request.params);
      const workflow = await getTeamWorkflow(teamId);

      return (
        workflow ??
        reply.status(404).send({ error: "team_not_found" })
      );
    } catch (error) {
      return sendError(error, reply);
    }
  });

  app.put("/api/teams/:teamId/workflow", async (request, reply) => {
    try {
      const { teamId } = parse(idParams, request.params);
      const input = parse(
        teamWorkflowInputSchema,
        request.body,
      );

      return await replaceTeamWorkflow(teamId, input);
    } catch (error) {
      return sendError(error, reply);
    }
  });
}
