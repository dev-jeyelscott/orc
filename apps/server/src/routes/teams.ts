import type {
  FastifyInstance,
} from "fastify";
import {
  z,
} from "zod";

import {
  createTeamSchema,
  updateTeamSchema,
} from "@orc/shared";

import {
  TeamServiceError,
  createTeam,
  deleteTeam,
  getTeam,
  listTeams,
  updateTeam,
} from "../services/team-service.js";

const idParams =
  z.object({
    teamId:
      z.string().uuid(),
  });

/**
 * Parses and validates Team route data with a supplied Zod schema.
 */
function parse<T>(
  schema:
    z.ZodType<T>,
  value:
    unknown,
): T {
  const parsed =
    schema.safeParse(
      value,
    );

  if (
    !parsed.success
  ) {
    throw new TeamServiceError(
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
 * Converts known Team service errors into stable API responses.
 */
function sendError(
  error:
    unknown,
  reply: {
    status:
      (
        code: number,
      ) => {
        send:
          (
            body: unknown,
          ) => unknown;
      };
  },
) {
  if (
    error instanceof
    TeamServiceError
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
 * Registers Team CRUD endpoints.
 */
export async function teamRoutes(
  app:
    FastifyInstance,
) {
  app.get(
    "/api/teams",
    async () => ({
      teams:
        await listTeams(),
    }),
  );

  app.get(
    "/api/teams/:teamId",
    async (
      request,
      reply,
    ) => {
      const {
        teamId,
      } = parse(
        idParams,
        request.params,
      );

      const team =
        await getTeam(
          teamId,
        );

      return (
        team ??
        reply
          .status(404)
          .send({
            error:
              "team_not_found",
          })
      );
    },
  );

  app.post(
    "/api/teams",
    async (
      request,
      reply,
    ) => {
      try {
        const input =
          parse(
            createTeamSchema,
            request.body,
          );

        return reply
          .status(201)
          .send(
            await createTeam({
              ...input,
              description:
                input.description ??
                "",
              enabled:
                input.enabled ??
                true,
            }),
          );
      } catch (error) {
        return sendError(
          error,
          reply,
        );
      }
    },
  );

  app.patch(
    "/api/teams/:teamId",
    async (
      request,
      reply,
    ) => {
      try {
        const {
          teamId,
        } = parse(
          idParams,
          request.params,
        );

        const team =
          await updateTeam(
            teamId,
            parse(
              updateTeamSchema,
              request.body,
            ),
          );

        return (
          team ??
          reply
            .status(404)
            .send({
              error:
                "team_not_found",
            })
        );
      } catch (error) {
        return sendError(
          error,
          reply,
        );
      }
    },
  );

  app.delete(
    "/api/teams/:teamId",
    async (
      request,
      reply,
    ) => {
      try {
        const {
          teamId,
        } = parse(
          idParams,
          request.params,
        );

        const deleted =
          await deleteTeam(
            teamId,
          );

        return deleted
          ? reply
              .status(204)
              .send()
          : reply
              .status(404)
              .send({
                error:
                  "team_not_found",
              });
      } catch (error) {
        return sendError(
          error,
          reply,
        );
      }
    },
  );
}
