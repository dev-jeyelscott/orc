import type {
  FastifyInstance,
} from "fastify";

import {
  getProjectAutomationStatuses,
} from "../services/auto-mode-service.js";

import {
  requestAutoModeCycle,
} from "../services/auto-mode-signal.js";

/**
 * Registers Project-assignment Auto Mode operator-status and manual-trigger endpoints.
 */
export async function autoModeRoutes(
  app:
    FastifyInstance,
) {
  app.get(
    "/api/auto-mode/status",
    async () => ({
      projects:
        await getProjectAutomationStatuses(),
    }),
  );

  /**
   * Requests an immediate Auto Mode cycle instead of waiting for the next scheduled poll.
   * Fire-and-forget: 202 only confirms the request was registered, not that a task started.
   */
  app.post(
    "/api/auto-mode/run-now",
    async (
      _request,
      reply,
    ) => {
      requestAutoModeCycle();

      return reply
        .status(202)
        .send({
          requested: true,
        });
    },
  );
}
