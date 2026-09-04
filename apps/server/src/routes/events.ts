import type {
  FastifyInstance,
} from "fastify";
import {
  eventListQuerySchema,
  eventListResponseSchema,
} from "@orc/shared";

import {
  listEvents,
} from "../services/event-service.js";

/**
 * Registers the bounded read-only system domain-event history endpoint.
 */
export async function eventRoutes(
  app: FastifyInstance,
) {
  app.get(
    "/api/events",
    async (
      request,
      reply,
    ) => {
      const parsed =
        eventListQuerySchema.safeParse(
          request.query,
        );

      if (
        !parsed.success
      ) {
        return reply
          .status(400)
          .send({
            error:
              parsed.error.issues
                .map(
                  (
                    issue,
                  ) =>
                    issue.message,
                )
                .join(
                  ", ",
                ),
          });
      }

      reply.header(
        "cache-control",
        "no-store",
      );

      return eventListResponseSchema.parse(
        await listEvents(
          parsed.data,
        ),
      );
    },
  );
}
