import type {
  FastifyInstance,
} from "fastify";

import {
  getProjectAutomationStatuses,
} from "../services/auto-mode-service.js";

/**
 * Registers Project-assignment Auto Mode operator-status endpoints.
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
}
