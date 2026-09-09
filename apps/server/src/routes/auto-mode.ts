import type {
  FastifyInstance,
} from "fastify";

import {
  getTeamAutomationStatuses,
} from "../services/auto-mode-service.js";

/**
 * Registers derived Team Auto Mode operator-status endpoints.
 */
export async function autoModeRoutes(
  app:
    FastifyInstance,
) {
  app.get(
    "/api/auto-mode/status",
    async () => ({
      teams:
        await getTeamAutomationStatuses(),
    }),
  );
}
